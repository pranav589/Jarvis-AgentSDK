import { EventEmitter } from "events";
import { z } from "zod";
import {
  Message,
  ModelProvider,
  ModelResponse,
  Role,
  ToolCall,
  JarvisEvent,
  JarvisRuntimeConfig,
  JarvisAgentConfig,
  JarvisToolDefinition,
  MemoryBank,
  ArcReactorDiagnostics,
  JarvisSuspensionError,
  HandoffTarget,
} from "../types/index.js";
import { JarvisAgent } from "./protocol.js";
import { JarvisTool, createTool } from "./subsystem.js";
import { InMemoryMemoryBank } from "../memory/in-memory.js";
import { VibraniumShield } from "../utils/shield.js";
import { ArcReactor } from "../utils/reactor.js";

/**
 * Strips markdown code fences and extracts the first valid JSON object or array
 * from a string. Handles models (e.g. Mistral) that wrap JSON in ```json...``` blocks
 * or prepend/append prose text to the JSON payload.
 */
function extractFirstJson(raw: string): string {
  // 1. Strip markdown fences: ```json ... ``` or ``` ... ```
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // 2. Find the first '{' or '[' and slice from there to the matching closer
  const start = raw.search(/[{[]/);
  if (start === -1) return raw; // No JSON found — return as-is and let JSON.parse throw

  const opener = raw[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === opener) depth++;
    else if (raw[i] === closer) {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  return raw.slice(start); // Fallback: slice from first opener
}

interface SuspendedRun {
  runId: string;
  sessionId: string;
  activeAgentName: string;
  history: Message[];
  stepCount: number;
  pendingToolCall: ToolCall;
  toolCallsList: ToolCall[];
  toolResults: Array<{ toolCallId: string; name: string; result: any; error?: string }>;
  currentToolIndex: number;
  outputSchema?: z.ZodType<any>;
  reactor: ArcReactor;
}

export class JarvisRuntime {
  private agents = new Map<string, JarvisAgent>();
  private defaultAgent: string;
  private memoryBank: MemoryBank;
  private providers: Record<string, ModelProvider>;
  private defaultProvider?: string;
  private maxSteps: number;
  private maxHandoffs: number;
  private allowFeedbackLoop: boolean;
  private context: any;
  private emitter = new EventEmitter();
  private handOffMap?: Record<string, HandoffTarget>;

  // Suspended executions cache for Human-in-the-loop validation resumes
  private suspendedRuns = new Map<string, SuspendedRun>();

  constructor(config: JarvisRuntimeConfig) {
    if (config.agents.length === 0) {
      throw new Error("JarvisRuntime requires at least one registered JarvisAgent/Protocol.");
    }

    config.agents.forEach((agentConfig) => {
      const agent = agentConfig instanceof JarvisAgent ? agentConfig : new JarvisAgent(agentConfig);
      this.agents.set(agent.name, agent);
    });

    this.defaultAgent = config.defaultAgent;
    if (!this.agents.has(this.defaultAgent)) {
      throw new Error(`Default agent "${this.defaultAgent}" is not in the registered agents list.`);
    }

    this.memoryBank = config.memoryBank || new InMemoryMemoryBank();
    this.providers = config.providers || {};
    this.defaultProvider = config.defaultProvider || (config.providers ? Object.keys(config.providers)[0] : undefined);
    this.maxSteps = config.maxSteps || 10;
    this.maxHandoffs = config.maxHandoffs || 5;
    this.allowFeedbackLoop = config.allowFeedbackLoop ?? false;
    this.context = config.context || {};
    this.handOffMap = config.handOff;
  }

  // Subscribe to runtime events
  on(event: string, listener: (...args: any[]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  emit(event: JarvisEvent["type"], payload: Omit<JarvisEvent, "type">) {
    this.emitter.emit(event, { type: event, ...payload });
    this.emitter.emit("*", { type: event, ...payload }); // Universal listener
  }

  private getProvider(agent: JarvisAgent): ModelProvider {
    if (agent.provider && typeof agent.provider !== "string") {
      return agent.provider;
    }
    const providerName = (agent.provider as string) || this.defaultProvider;
    if (!providerName || !this.providers[providerName]) {
      throw new Error(`No model provider configured or found matching provider key "${providerName}".`);
    }
    return this.providers[providerName];
  }

  /**
   * Automatically generates handoff tools for agents with explicit array target handoffs or tool-based routing.
   */
  private getHandoffTools(currentAgentName: string): JarvisTool<any>[] {
    const rawTarget = this.handOffMap?.[currentAgentName];
    if (!rawTarget) return [];

    // Only inject tools if the handoff target is explicitly an array of 2+ target names
    if (!Array.isArray(rawTarget) || rawTarget.length < 2) return [];

    const handoffTools: JarvisTool<any>[] = [];

    for (const [name, targetAgent] of this.agents.entries()) {
      if (name === currentAgentName) continue;
      if (!rawTarget.includes(name)) continue;

      const handoffTool = createTool({
        name: `transfer_to_${name}`,
        description: `Transfer tasks to the ${name} protocol. Use this tool when the task fits ${name}'s instructions: "${typeof targetAgent.instructions === 'string' ? targetAgent.instructions.slice(0, 100) : 'Dynamic instructions'}".`,
        parameters: z.object({
          contextTransferMessage: z.string().describe("A summary of findings and the task you want the agent to perform."),
        }),
        execute: async ({ contextTransferMessage }) => {
          return {
            __handoff__: true,
            targetAgent: name,
            message: contextTransferMessage,
          };
        },
      });

      handoffTools.push(handoffTool);
    }

    return handoffTools;
  }

  /**
   * Resolves the next handoff target agent name (if any) based on String, Array, or Function configuration.
   */
  private async resolveHandoffTarget(agentName: string, output: string): Promise<string | null> {
    const rawTarget = this.handOffMap?.[agentName];
    if (!rawTarget) return null;

    if (typeof rawTarget === "function") {
      const target = await rawTarget(output, this.context);
      return target || null;
    }

    if (typeof rawTarget === "string") {
      return rawTarget;
    }

    if (Array.isArray(rawTarget) && rawTarget.length === 1) {
      return rawTarget[0];
    }

    return null;
  }

  /**
   * Run the Jarvis Runtime loop for a session.
   */
  async run(options: {
    sessionId: string;
    input: string;
    agentName?: string;
    outputSchema?: z.ZodType<any>;
  }): Promise<{ content: string; diagnostics: ArcReactorDiagnostics }> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const sessionId = options.sessionId;
    let activeAgentName = options.agentName || this.defaultAgent;
    let handoffCount = 0;
    
    const reactor = new ArcReactor(runId, sessionId);
    this.emit("run:start", { runId, agentName: activeAgentName });

    try {
      let activeAgent = this.agents.get(activeAgentName);
      if (!activeAgent) {
        throw new Error(`Active agent '${activeAgentName}' is not registered in the runtime.`);
      }

      // 1. Input Guardrail checks
      const shield = new VibraniumShield(activeAgent.guardrails);
      let sanitizedInput: string;
      try {
        sanitizedInput = await shield.shieldInput(options.input, this.context);
      } catch (err: any) {
        this.emit("shield:blocked", { direction: "input", reason: err.message });
        throw err;
      }

      // Load session history
      const history = await this.memoryBank.getMessages(sessionId);
      
      // Append user input
      const userMessage: Message = { role: "user", content: sanitizedInput };
      history.push(userMessage);
      reactor.addStep({
        agentName: activeAgent.name,
        role: "user",
        content: sanitizedInput,
      });

      return this.continueRunLoop({
        runId,
        sessionId,
        activeAgentName,
        history,
        stepCount: 0,
        handoffCount,
        reactor,
        outputSchema: options.outputSchema,
      });
    } catch (err: any) {
      if (err instanceof JarvisSuspensionError) {
        throw err; // bubble up HITL suspensions directly
      }
      const errorMsg = err.message || "Unknown execution error";
      reactor.recordError(errorMsg);
      const diagnostics = reactor.getDiagnostics();
      this.emit("run:failed", { diagnostics, error: errorMsg });
      throw err;
    }
  }

  /**
   * Resumes a suspended execution.
   */
  async resume(
    sessionId: string,
    approved: boolean
  ): Promise<{ content: string; diagnostics: ArcReactorDiagnostics }> {
    const suspended = this.suspendedRuns.get(sessionId);
    if (!suspended) {
      throw new Error(`No suspended execution found for session ID: "${sessionId}"`);
    }

    this.suspendedRuns.delete(sessionId);

    const {
      runId,
      activeAgentName,
      history,
      stepCount,
      pendingToolCall,
      toolCallsList,
      toolResults,
      currentToolIndex,
      outputSchema,
      reactor,
    } = suspended;

    let activeAgent = this.agents.get(activeAgentName)!;
    const agentTools = [...(activeAgent.tools || [])];
    const handoffTools = this.getHandoffTools(activeAgent.name);
    const allAvailableTools = [...agentTools, ...handoffTools];

    const tc = pendingToolCall;

    this.emit("run:start", { runId, agentName: activeAgentName });

    try {
      if (!approved) {
        const errorMsg = `Tool execution blocked by supervisor.`;
        this.emit("shield:blocked", { direction: "tool", reason: errorMsg });

        const toolMessage: Message = {
          role: "tool",
          name: tc.name,
          content: `Error: ${errorMsg}`,
          toolCallId: tc.id,
        };
        history.push(toolMessage);
        toolResults.push({ toolCallId: tc.id, name: tc.name, result: null, error: errorMsg });
        this.emit("tool:end", { toolCall: tc, result: null, error: errorMsg });
      } else {
        const tool = allAvailableTools.find((t) => t.name === tc.name);
        if (!tool) {
          const errorMsg = `Tool '${tc.name}' not found during resume.`;
          const toolMessage: Message = {
            role: "tool",
            name: tc.name,
            content: `Error: ${errorMsg}`,
            toolCallId: tc.id,
          };
          history.push(toolMessage);
          toolResults.push({ toolCallId: tc.id, name: tc.name, result: null, error: errorMsg });
          this.emit("tool:end", { toolCall: tc, result: null, error: errorMsg });
        } else {
          try {
            let parsedArgs = {};
            try {
              parsedArgs = JSON.parse(tc.arguments);
            } catch (e) {
              parsedArgs = tc.arguments;
            }

            const result = await tool.execute(parsedArgs, this.context);

            if (result && typeof result === "object" && result.__handoff__) {
              const target = result.targetAgent;
              const handoffMsg = result.message;

              this.emit("handoff:start", { from: activeAgent.name, to: target });
              reactor.recordHandoff(activeAgent.name, target);

              const toolResponse: Message = {
                role: "tool",
                name: tc.name,
                content: `Handoff command executed. Control transferred to agent: ${target}.`,
                toolCallId: tc.id,
              };
              history.push(toolResponse);

              // Cancel remaining tool calls in this step's execution queue
              const currentIdx = toolCallsList.indexOf(tc);
              const remainingToolCalls = toolCallsList.slice(currentIdx + 1);
              for (const remainingTc of remainingToolCalls) {
                const cancelMessage: Message = {
                  role: "tool",
                  name: remainingTc.name,
                  content: `Cancelled due to agent handoff.`,
                  toolCallId: remainingTc.id,
                };
                history.push(cancelMessage);
              }

              const handoffNotice: Message = {
                role: "user",
                content: `[System Handoff: Control transferred to '${target}'. Mission context from previous agent: "${handoffMsg}"]`,
              };
              history.push(handoffNotice);

              toolResults.push({
                toolCallId: tc.id,
                name: tc.name,
                result: `Transferring control to ${target}.`,
              });
              this.emit("tool:end", { toolCall: tc, result: `Transferred to ${target}` });

              return this.continueRunLoop({
                runId,
                sessionId,
                activeAgentName: target,
                history,
                stepCount: stepCount + 1,
                handoffCount: 1, // Reset or increment handoff count
                reactor,
                outputSchema,
              });
            }

            const resultStr = typeof result === "string" ? result : JSON.stringify(result);
            const toolMessage: Message = {
              role: "tool",
              name: tc.name,
              content: resultStr,
              toolCallId: tc.id,
            };
            history.push(toolMessage);
            toolResults.push({ toolCallId: tc.id, name: tc.name, result: resultStr });
            this.emit("tool:end", { toolCall: tc, result: resultStr });

          } catch (err: any) {
            const errorMsg = err.message || "Unknown error";
            const toolMessage: Message = {
              role: "tool",
              name: tc.name,
              content: `Error: ${errorMsg}`,
              toolCallId: tc.id,
            };
            history.push(toolMessage);
            toolResults.push({ toolCallId: tc.id, name: tc.name, result: null, error: errorMsg });
            this.emit("tool:end", { toolCall: tc, result: null, error: errorMsg });
            reactor.recordError(`Tool '${tc.name}' execution failed: ${errorMsg}`);
          }
        }
      }

      // Process any remaining tools in the current step
      const remainingTools = toolCallsList.slice(currentToolIndex + 1);
      for (const nextTc of remainingTools) {
        this.emit("tool:start", { toolCall: nextTc });
        const currentShield = new VibraniumShield(activeAgent.guardrails);
        
        let hitlRequired = false;
        if (activeAgent.hitl === true) {
          hitlRequired = true;
        } else if (Array.isArray(activeAgent.hitl) && activeAgent.hitl.includes(nextTc.name)) {
          hitlRequired = true;
        }

        const check = hitlRequired
          ? { approved: false, suspend: true, reason: `Requires human review (agent-level HITL config triggered for '${nextTc.name}')` }
          : await currentShield.checkTool(nextTc, this.context);

        if (!check.approved) {
          if (check.suspend) {
            this.suspendedRuns.set(sessionId, {
              runId,
              sessionId,
              activeAgentName,
              history: [...history],
              stepCount,
              pendingToolCall: nextTc,
              toolCallsList,
              toolResults: [...toolResults],
              currentToolIndex: toolCallsList.indexOf(nextTc),
              outputSchema,
              reactor,
            });
            const diagnostics = reactor.getDiagnostics();
            throw new JarvisSuspensionError(runId, sessionId, nextTc, diagnostics);
          }

          const errorMsg = check.reason || `Tool execution blocked for '${nextTc.name}'`;
          this.emit("shield:blocked", { direction: "tool", reason: errorMsg });

          const toolMessage: Message = {
            role: "tool",
            name: nextTc.name,
            content: `Error: ${errorMsg}`,
            toolCallId: nextTc.id,
          };
          history.push(toolMessage);
          toolResults.push({ toolCallId: nextTc.id, name: nextTc.name, result: null, error: errorMsg });
          this.emit("tool:end", { toolCall: nextTc, result: null, error: errorMsg });
          continue;
        }

        const tool = allAvailableTools.find((t) => t.name === nextTc.name);
        if (!tool) {
          const errorMsg = `Tool '${nextTc.name}' not found.`;
          const toolMessage: Message = {
            role: "tool",
            name: nextTc.name,
            content: `Error: ${errorMsg}`,
            toolCallId: nextTc.id,
          };
          history.push(toolMessage);
          toolResults.push({ toolCallId: nextTc.id, name: nextTc.name, result: null, error: errorMsg });
          this.emit("tool:end", { toolCall: nextTc, result: null, error: errorMsg });
          continue;
        }

        try {
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(nextTc.arguments);
          } catch (e) {
            parsedArgs = nextTc.arguments;
          }

          const result = await tool.execute(parsedArgs, this.context);

          if (result && typeof result === "object" && result.__handoff__) {
            const target = result.targetAgent;
            const handoffMsg = result.message;

            this.emit("handoff:start", { from: activeAgent.name, to: target });
            reactor.recordHandoff(activeAgent.name, target);

            const toolResponse: Message = {
              role: "tool",
              name: nextTc.name,
              content: `Handoff command executed. Control transferred to agent: ${target}.`,
              toolCallId: nextTc.id,
            };
            history.push(toolResponse);

            // Cancel remaining tool calls in this step's execution queue
            const currentIdx = toolCallsList.indexOf(nextTc);
            const remainingToolCalls = toolCallsList.slice(currentIdx + 1);
            for (const remainingTc of remainingToolCalls) {
              const cancelMessage: Message = {
                role: "tool",
                name: remainingTc.name,
                content: `Cancelled due to agent handoff.`,
                toolCallId: remainingTc.id,
              };
              history.push(cancelMessage);
            }

            const handoffNotice: Message = {
              role: "user",
              content: `[System Handoff: Control transferred to '${target}'. Mission context from previous agent: "${handoffMsg}"]`,
            };
            history.push(handoffNotice);

            toolResults.push({
              toolCallId: nextTc.id,
              name: nextTc.name,
              result: `Transferring control to ${target}.`,
            });
            this.emit("tool:end", { toolCall: nextTc, result: `Transferred to ${target}` });

            return this.continueRunLoop({
              runId,
              sessionId,
              activeAgentName: target,
              history,
              stepCount: stepCount + 1,
              handoffCount: 1,
              reactor,
              outputSchema,
            });
          }

          const resultStr = typeof result === "string" ? result : JSON.stringify(result);
          const toolMessage: Message = {
            role: "tool",
            name: nextTc.name,
            content: resultStr,
            toolCallId: nextTc.id,
          };
          history.push(toolMessage);
          toolResults.push({ toolCallId: nextTc.id, name: nextTc.name, result: resultStr });
          this.emit("tool:end", { toolCall: nextTc, result: resultStr });

        } catch (err: any) {
          const errorMsg = err.message || "Unknown error";
          const toolMessage: Message = {
            role: "tool",
            name: nextTc.name,
            content: `Error: ${errorMsg}`,
            toolCallId: nextTc.id,
          };
          history.push(toolMessage);
          toolResults.push({ toolCallId: nextTc.id, name: nextTc.name, result: null, error: errorMsg });
          this.emit("tool:end", { toolCall: nextTc, result: null, error: errorMsg });
          reactor.recordError(`Tool '${nextTc.name}' execution failed: ${errorMsg}`);
        }
      }

      reactor.addStep({
        agentName: activeAgent.name,
        role: "tool",
        content: "Tools execution completed",
        toolResults,
      });

      return this.continueRunLoop({
        runId,
        sessionId,
        activeAgentName,
        history,
        stepCount: stepCount + 1,
        handoffCount: 0,
        reactor,
        outputSchema,
      });
    } catch (err: any) {
      if (err instanceof JarvisSuspensionError) {
        throw err;
      }
      const errorMsg = err.message || "Unknown execution error";
      reactor.recordError(errorMsg);
      const diagnostics = reactor.getDiagnostics();
      this.emit("run:failed", { diagnostics, error: errorMsg });
      throw err;
    }
  }

  /**
   * Internal execution loop processor.
   */
  private async continueRunLoop(params: {
    runId: string;
    sessionId: string;
    activeAgentName: string;
    history: Message[];
    stepCount: number;
    handoffCount: number;
    reactor: ArcReactor;
    outputSchema?: z.ZodType<any>;
  }): Promise<{ content: string; diagnostics: ArcReactorDiagnostics }> {
    const { runId, sessionId, history, reactor, outputSchema } = params;
    let activeAgentName = params.activeAgentName;
    let stepCount = params.stepCount;
    let handoffCount = params.handoffCount;

    let finalContent = "";
    let lastLLMContent: string | null = null;
    // Track whether the current agent has executed any tool calls yet.
    // Used to strip tools on schema agents' final "produce JSON" turn.
    let hasCalledTools = false;
    // Track the active agent name at the start of each iteration to detect agent switches
    let lastActiveAgentName = activeAgentName;

    try {
      while (stepCount < this.maxSteps) {
        const activeAgent = this.agents.get(activeAgentName)!;
        const currentShield = new VibraniumShield(activeAgent.guardrails);
        const provider = this.getProvider(activeAgent);

        // Reset tool-call tracker when the active agent changes (after a handoff)
        if (activeAgentName !== lastActiveAgentName) {
          hasCalledTools = false;
          lastActiveAgentName = activeAgentName;
        }

        const agentTools = [...(activeAgent.tools || [])];
        const handoffTools = this.getHandoffTools(activeAgent.name);
        const allAvailableTools = [...agentTools, ...handoffTools];

        // Schema-agent tool stripping: once this agent has already made at least one
        // tool call, remove all tools from the next LLM request to force a JSON text
        // response rather than more tool calls.
        const toolsForThisCall = (activeAgent.outputSchema && hasCalledTools)
          ? undefined
          : allAvailableTools;

        const systemPrompt = await activeAgent.getInstructions(this.context);

        const promptPayload: Message[] = [
          { role: "system", content: systemPrompt },
          ...history,
        ];

        let response;
        if (provider.generateStream) {
          response = await provider.generateStream(
            promptPayload,
            {
              model: activeAgent.model,
              outputSchema: activeAgent.outputSchema,
              tools: toolsForThisCall,
              temperature: 0.1,
            },
            (chunk) => {
              this.emit("text:chunk", { chunk });
            }
          );
        } else {
          response = await provider.generate(promptPayload, {
            model: activeAgent.model,
            outputSchema: activeAgent.outputSchema,
            tools: toolsForThisCall,
            temperature: 0.1,
          });
        }

        if (response.usage) {
          reactor.recordTokens(response.usage.promptTokens, response.usage.completionTokens);
        }

        const assistantMessage: Message = {
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
        };
        history.push(assistantMessage);

        reactor.addStep({
          agentName: activeAgent.name,
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
        });

        this.emit("run:step", {
          step: {
            stepIndex: stepCount,
            agentName: activeAgent.name,
            role: "assistant",
            content: response.content,
            toolCalls: response.toolCalls,
            timestamp: Date.now(),
          },
        });

        // 2. Handle Tool Calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          hasCalledTools = true; // Mark that this agent has executed tool calls
          const toolResults: Array<{ toolCallId: string; name: string; result: any; error?: string }> = [];

          for (const tc of response.toolCalls) {
            this.emit("tool:start", { toolCall: tc });

            // Check Tool Guardrails
            let hitlRequired = false;
            if (activeAgent.hitl === true) {
              hitlRequired = true;
            } else if (Array.isArray(activeAgent.hitl) && activeAgent.hitl.includes(tc.name)) {
              hitlRequired = true;
            }

            const check = hitlRequired
              ? { approved: false, suspend: true, reason: `Requires human review (agent-level HITL config triggered for '${tc.name}')` }
              : await currentShield.checkTool(tc, this.context);

            if (!check.approved) {
              if (check.suspend) {
                // Save suspension state to resume later
                this.suspendedRuns.set(sessionId, {
                  runId,
                  sessionId,
                  activeAgentName,
                  history: [...history],
                  stepCount,
                  pendingToolCall: tc,
                  toolCallsList: response.toolCalls,
                  toolResults: [...toolResults],
                  currentToolIndex: response.toolCalls.indexOf(tc),
                  outputSchema,
                  reactor,
                });

                const diagnostics = reactor.getDiagnostics();
                throw new JarvisSuspensionError(runId, sessionId, tc, diagnostics);
              }

              const errorMsg = check.reason || `Tool execution blocked for '${tc.name}'`;
              this.emit("shield:blocked", { direction: "tool", reason: errorMsg });
              
              const toolMessage: Message = {
                role: "tool",
                name: tc.name,
                content: `Error: ${errorMsg}`,
                toolCallId: tc.id,
              };
              history.push(toolMessage);
              toolResults.push({ toolCallId: tc.id, name: tc.name, result: null, error: errorMsg });
              this.emit("tool:end", { toolCall: tc, result: null, error: errorMsg });
              continue;
            }

            const tool = allAvailableTools.find((t) => t.name === tc.name);
            if (!tool) {
              const errorMsg = `Tool '${tc.name}' not found.`;
              const toolMessage: Message = {
                role: "tool",
                name: tc.name,
                content: `Error: ${errorMsg}`,
                toolCallId: tc.id,
              };
              history.push(toolMessage);
              toolResults.push({ toolCallId: tc.id, name: tc.name, result: null, error: errorMsg });
              this.emit("tool:end", { toolCall: tc, result: null, error: errorMsg });
              continue;
            }

            try {
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(tc.arguments);
              } catch (e) {
                parsedArgs = tc.arguments;
              }

              const result = await tool.execute(parsedArgs, this.context);

              if (result && typeof result === "object" && result.__handoff__) {
                const target = result.targetAgent;
                const handoffMsg = result.message;

                handoffCount++;
                if (handoffCount > this.maxHandoffs) {
                  throw new Error(`Execution aborted. Delegation loop detected: exceeded maximum allowed handoffs (${this.maxHandoffs}).`);
                }

                this.emit("handoff:start", { from: activeAgent.name, to: target });
                reactor.recordHandoff(activeAgent.name, target);

                activeAgentName = target;

                const toolResponse: Message = {
                  role: "tool",
                  name: tc.name,
                  content: `Handoff command executed. Control transferred to agent: ${target}.`,
                  toolCallId: tc.id,
                };
                history.push(toolResponse);

                // Cancel remaining tool calls in this step's execution queue
                const currentIdx = response.toolCalls.indexOf(tc);
                const remainingToolCalls = response.toolCalls.slice(currentIdx + 1);
                for (const remainingTc of remainingToolCalls) {
                  const cancelMessage: Message = {
                    role: "tool",
                    name: remainingTc.name,
                    content: `Cancelled due to agent handoff.`,
                    toolCallId: remainingTc.id,
                  };
                  history.push(cancelMessage);
                }

                const handoffNotice: Message = {
                  role: "user",
                  content: `[System Handoff: Control transferred to '${target}'. Mission context from previous agent: "${handoffMsg}"]`,
                };
                history.push(handoffNotice);

                toolResults.push({
                  toolCallId: tc.id,
                  name: tc.name,
                  result: `Transferring control to ${target}.`,
                });
                this.emit("tool:end", { toolCall: tc, result: `Transferred to ${target}` });
                break; // Exit tool loop to restart run with new active agent
              }

              const resultStr = typeof result === "string" ? result : JSON.stringify(result);
              const toolMessage: Message = {
                role: "tool",
                name: tc.name,
                content: resultStr,
                toolCallId: tc.id,
              };
              history.push(toolMessage);
              toolResults.push({ toolCallId: tc.id, name: tc.name, result: resultStr });
              this.emit("tool:end", { toolCall: tc, result: resultStr });

            } catch (err: any) {
              const errorMsg = err.message || "Unknown error";
              const toolMessage: Message = {
                role: "tool",
                name: tc.name,
                content: `Error: ${errorMsg}`,
                toolCallId: tc.id,
              };
              history.push(toolMessage);
              toolResults.push({ toolCallId: tc.id, name: tc.name, result: null, error: errorMsg });
              this.emit("tool:end", { toolCall: tc, result: null, error: errorMsg });
              reactor.recordError(`Tool '${tc.name}' execution failed: ${errorMsg}`);
            }
          }

          reactor.addStep({
            agentName: activeAgent.name,
            role: "tool",
            content: "Tools execution completed",
            toolResults,
          });

          stepCount++;

          // Early-exit: if this agent has an outputSchema and the LLM already produced
          // valid JSON content alongside the tool calls, finalize now — do not loop again.
          // This prevents models (e.g. Mistral) from looping with fictional stop-tools after
          // they have already generated the correct structured output.
          if (activeAgent.outputSchema && response.content) {
            try {
              const earlyJson = JSON.parse(extractFirstJson(response.content));
              const earlyParsed = activeAgent.outputSchema.parse(earlyJson);
              finalContent = JSON.stringify(earlyParsed);
              break; // Schema validated — exit the run loop immediately
            } catch {
              // JSON not valid yet — continue the loop so the model can try again
            }
          }

          continue; // Run next step in runtime loop
        }

        // 3. Output validation & Self-Repair Loops
        lastLLMContent = response.content;
        if (activeAgent.outputSchema && lastLLMContent) {
          try {
            const parsedJson = JSON.parse(extractFirstJson(lastLLMContent));
            const parsedData = activeAgent.outputSchema.parse(parsedJson);
            finalContent = JSON.stringify(parsedData);
          } catch (err: any) {
            const repairAttempts = 3;
            let repaired = false;
            
            for (let attempt = 1; attempt <= repairAttempts; attempt++) {
              this.emit("text:chunk", { chunk: `\n[System self-repair attempt ${attempt}/3...]` });
              
              const repairPrompt = `Your previous response failed structural verification checks. 
Error: ${err.message}. 
Please correct the response and return a valid JSON object matching the requested schema. Do not output conversational filler.`;
              
              const repairPayload: Message[] = [
                { role: "system", content: systemPrompt },
                ...history,
                { role: "user", content: repairPrompt },
              ];

              try {
                const repairResponse = await provider.generate(repairPayload, {
                  model: activeAgent.model,
                  outputSchema: activeAgent.outputSchema,
                  temperature: 0.1,
                });

                if (repairResponse.content) {
                  const repairJson = JSON.parse(extractFirstJson(repairResponse.content));
                  const parsedData = activeAgent.outputSchema.parse(repairJson);
                  finalContent = JSON.stringify(parsedData);
                  repaired = true;
                  
                  history.push({
                    role: "assistant",
                    content: repairResponse.content,
                  });
                  break;
                }
              } catch (retryErr) {
                // Continue
              }
            }

            if (!repaired) {
              throw new Error(`Self-repair protocol failed. Responses violate output schema validation checks: ${err.message}`);
            }
          }
        } else {
          finalContent = lastLLMContent || "";
        }

        // 4. Output Guardrail (Shield Check)
        try {
          finalContent = await currentShield.shieldOutput(finalContent, this.context);
        } catch (err: any) {
          this.emit("shield:blocked", { direction: "output", reason: err.message });
          throw err;
        }

        // 5. Handoff Evaluation (String, Array, or Conditional Function)
        const nextTarget = await this.resolveHandoffTarget(activeAgentName, finalContent || lastLLMContent || "");
        if (nextTarget) {
          handoffCount++;
          if (handoffCount > this.maxHandoffs) {
            throw new Error(`Execution aborted. Delegation loop detected: exceeded maximum allowed handoffs (${this.maxHandoffs}).`);
          }
          this.emit("handoff:start", { from: activeAgentName, to: nextTarget });
          reactor.recordHandoff(activeAgentName, nextTarget);
          const handoffNotice: Message = {
            role: "user",
            content: `[System: Agent '${activeAgentName}' has completed its task. Passing control to '${nextTarget}'. Context from previous agent: "${finalContent || lastLLMContent || 'No output.'}"]`,
          };
          history.push(handoffNotice);
          activeAgentName = nextTarget;
          lastActiveAgentName = "";
          hasCalledTools = false;
          stepCount++;
          continue; // Restart loop with next target agent
        }

        break; // Loop completed successfully — no auto-handoff target
      }

      if (stepCount >= this.maxSteps) {
        throw new Error(`Runtime loops aborted. Active system hit maximum iteration limits (${this.maxSteps} steps).`);
      }

      // 4. Runtime-level Output validation & Self-Repair
      const finalSchema = outputSchema;
      if (finalSchema) {
        try {
          const parsedJson = JSON.parse(finalContent);
          const parsedData = finalSchema.parse(parsedJson);
          finalContent = JSON.stringify(parsedData);
        } catch (err: any) {
          const activeAgent = this.agents.get(activeAgentName)!;
          const provider = this.getProvider(activeAgent);
          const systemPrompt = await activeAgent.getInstructions(this.context);
          const repairAttempts = 3;
          let repaired = false;
          
          for (let attempt = 1; attempt <= repairAttempts; attempt++) {
            this.emit("text:chunk", { chunk: `\n[Runtime self-repair attempt ${attempt}/3...]` });
            
            const repairPrompt = `Your previous response failed final structural verification checks. 
Error: ${err.message}. 
Please correct the final output and return a valid JSON object matching the requested schema. Do not output conversational filler.`;
            
            const repairPayload: Message[] = [
              { role: "system", content: systemPrompt },
              ...history,
              { role: "user", content: repairPrompt },
            ];

            try {
              const repairResponse = await provider.generate(repairPayload, {
                model: activeAgent.model,
                outputSchema: finalSchema,
                temperature: 0.1,
              });

              if (repairResponse.content) {
                const repairJson = JSON.parse(repairResponse.content);
                const parsedData = finalSchema.parse(repairJson);
                finalContent = JSON.stringify(parsedData);
                repaired = true;
                
                history.push({
                  role: "assistant",
                  content: repairResponse.content,
                });
                break;
              }
            } catch (retryErr) {
              // Continue
            }
          }

          if (!repaired) {
            throw new Error(`Runtime self-repair failed. Final response violates output schema: ${err.message}`);
          }
        }
      }

      // Save updated history back to session MemoryBank
      await this.memoryBank.saveMessages(sessionId, history);

      const diagnostics = reactor.getDiagnostics();
      this.emit("run:complete", { diagnostics, result: finalContent });
      return { content: finalContent, diagnostics };
    } catch (err: any) {
      if (err instanceof JarvisSuspensionError) {
        throw err;
      }
      const errorMsg = err.message || "Unknown execution error";
      reactor.recordError(errorMsg);
      const diagnostics = reactor.getDiagnostics();
      this.emit("run:failed", { diagnostics, error: errorMsg });
      throw err;
    }
  }
}
