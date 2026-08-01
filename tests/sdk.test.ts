import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  JarvisAgent,
  createTool,
  JarvisRuntime,
  BaseModelProvider,
  InMemoryMemoryBank,
  Message,
  ModelProviderOptions,
  ModelResponse,
  ToolCall,
} from "../src/index.js";

// Mock Provider for testing
class MockModelProvider extends BaseModelProvider {
  name = "mock-provider";
  
  // Callback we can override per test
  generateHandler: (messages: Message[], options: ModelProviderOptions) => Promise<ModelResponse> = 
    async () => ({ content: "Hello, sir. System status is normal." });

  async generate(
    messages: Message[],
    options: ModelProviderOptions
  ): Promise<ModelResponse> {
    return this.generateHandler(messages, options);
  }
}

describe("JarvisAgentSDK Core Verification", () => {
  let mockProvider: MockModelProvider;
  let memoryBank: InMemoryMemoryBank;

  beforeEach(() => {
    mockProvider = new MockModelProvider();
    memoryBank = new InMemoryMemoryBank();
  });

  // 1. Core Loop & Basic Response
  it("should execute a simple agent loop and return final content", async () => {
    const agent = new JarvisAgent({
      name: "MarkI",
      instructions: "You are the Mark I assistant.",
      model: "mock-model",
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "MarkI",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    mockProvider.generateHandler = async () => ({
      content: "System diagnostics: Mark I armor status is fully functional.",
      usage: { promptTokens: 10, completionTokens: 15 },
    });

    const result = await runtime.run({
      sessionId: "session-1",
      input: "Check status",
    });

    expect(result.content).toBe("System diagnostics: Mark I armor status is fully functional.");
    expect(result.diagnostics.tokenUsage.totalTokens).toBe(25);
    expect(result.diagnostics.steps.length).toBe(2); // User input step + Assistant response step
  });

  // 2. Input Guardrail
  it("should trigger input guardrails (Vibranium Shield) and block dangerous input", async () => {
    const agent = new JarvisAgent({
      name: "SecuritySystem",
      instructions: "Manage security protocols.",
      model: "mock-model",
      guardrails: {
        beforeInput: (input) => {
          if (input.includes("overwrite core system")) {
            throw new Error("Security Alert: System breach detected. Lock down active.");
          }
          return input;
        },
      },
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "SecuritySystem",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    await expect(
      runtime.run({
        sessionId: "session-2",
        input: "overwrite core system",
      })
    ).rejects.toThrow("Input blocked by Vibranium Shield: Security Alert: System breach detected.");
  });

  // 3. Output Guardrail (Sensitive data scrubbing)
  it("should trigger output guardrails and scrub sensitive numbers", async () => {
    const agent = new JarvisAgent({
      name: "FinanceAssistant",
      instructions: "Report financial data.",
      model: "mock-model",
      guardrails: {
        afterOutput: (output) => {
          // Scrub card formats
          return output.replace(/\d{4}-\d{4}-\d{4}-\d{4}/g, "[REDACTED_CARD]");
        },
      },
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "FinanceAssistant",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    mockProvider.generateHandler = async () => ({
      content: "Payment processed on card: 1234-5678-9012-3456.",
    });

    const result = await runtime.run({
      sessionId: "session-3",
      input: "Show my payment receipt",
    });

    expect(result.content).toBe("Payment processed on card: [REDACTED_CARD].");
  });

  // 4. Tools validation & execution
  it("should validate parameters and execute custom tools", async () => {
    let toolExecutedWith = "";
    
    const thrusterTool = createTool({
      name: "fire_thrusters",
      description: "Fires the armor thrusters.",
      parameters: z.object({
        powerLevel: z.number().min(1).max(100),
      }),
      execute: async ({ powerLevel }) => {
        toolExecutedWith = `thrusters-fired-at-${powerLevel}%`;
        return "Thrusters active.";
      },
    });

    const agent = new JarvisAgent({
      name: "Pilot",
      instructions: "Control flight subsystems.",
      model: "mock-model",
      tools: [thrusterTool],
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "Pilot",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    // Step 1: LLM returns tool call
    // Step 2: LLM processes tool result and answers
    let callsCount = 0;
    mockProvider.generateHandler = async (messages) => {
      callsCount++;
      if (callsCount === 1) {
        return {
          content: null,
          toolCalls: [
            {
              id: "call-1",
              name: "fire_thrusters",
              arguments: JSON.stringify({ powerLevel: 85 }),
            },
          ],
        };
      }
      return {
        content: "Thrusters fired successfully, sir.",
      };
    };

    const result = await runtime.run({
      sessionId: "session-4",
      input: "Initiate takeoff",
    });

    expect(toolExecutedWith).toBe("thrusters-fired-at-85%");
    expect(result.content).toBe("Thrusters fired successfully, sir.");
    expect(callsCount).toBe(2);
  });

  // 5. Tool execution guardrails (Manual approval check)
  it("should trigger beforeToolExecute guardrail and allow blocking", async () => {
    const launchMissiles = createTool({
      name: "launch_missiles",
      description: "Fires weapons systems.",
      parameters: z.object({ target: z.string() }),
      execute: async () => "Missiles launched.",
    });

    let beforeToolChecked = false;

    const agent = new JarvisAgent({
      name: "DefenseSystem",
      instructions: "Engage targets.",
      model: "mock-model",
      tools: [launchMissiles],
      guardrails: {
        beforeToolExecute: async (toolCall) => {
          beforeToolChecked = true;
          if (toolCall.name === "launch_missiles") {
            return { approved: false, reason: "Manual authorization rejected by Command." };
          }
          return true;
        },
      },
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "DefenseSystem",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    let callsCount = 0;
    mockProvider.generateHandler = async () => {
      callsCount++;
      if (callsCount === 1) {
        return {
          content: null,
          toolCalls: [{ id: "call-weapons", name: "launch_missiles", arguments: JSON.stringify({ target: "Drone" }) }],
        };
      }
      return { content: "Subsystem report received." };
    };

    const result = await runtime.run({
      sessionId: "session-5",
      input: "Fire weapons",
    });

    expect(beforeToolChecked).toBe(true);
    // Should pass the blocked tool error string back to history and LLM replies with final text
    expect(result.content).toBe("Subsystem report received.");
    
    // Check if the history recorded the block error
    const history = await memoryBank.getMessages("session-5");
    const toolMsg = history.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("Error: Manual authorization rejected by Command.");
  });

  // 6. Multi-agent Handoff
  it("should execute handoff from one protocol to another, preserving context", async () => {
    const researcher = new JarvisAgent({
      name: "ResearchProtocol",
      instructions: "Search database context.",
      model: "mock-model",
    });

    const writer = new JarvisAgent({
      name: "WriterProtocol",
      instructions: "Generate reports.",
      model: "mock-model",
    });

    const runtime = new JarvisRuntime({
      agents: [researcher, writer],
      defaultAgent: "ResearchProtocol",
      memoryBank,
      providers: { "mock-provider": mockProvider },
      // String auto-routing: Researcher always hands off to Writer after completing
      handOff: { ResearchProtocol: "WriterProtocol" },
    });

    // Step 1: Researcher completes and auto-routes to Writer
    // Step 2: Writer receives context and writes final answer
    let callIndex = 0;
    const seenSystemPrompts: string[] = [];
    mockProvider.generateHandler = async (messages, options) => {
      callIndex++;
      const sys = messages.find(m => m.role === "system")?.content ?? "";
      seenSystemPrompts.push(sys);
      expect(options.model).toBe("mock-model");
      if (callIndex === 1) {
        // Researcher outputs research findings
        return { content: "Research complete: Vibranium data is ready." };
      }
      // Writer produces the final report
      return {
        content: "Report: Vibranium is a rare metal from Wakanda.",
      };
    };

    const result = await runtime.run({
      sessionId: "session-6",
      input: "Analyze Vibranium metal",
    });

    expect(result.content).toBe("Report: Vibranium is a rare metal from Wakanda.");
    // Verify correct agent sequence: Researcher first, then Writer
    expect(seenSystemPrompts[0]).toContain("Search database context.");
    expect(seenSystemPrompts[1]).toContain("Generate reports.");
    // Diagnostics should record the auto-handoff
    expect(result.diagnostics.handoffs.length).toBe(1);
    expect(result.diagnostics.handoffs[0].from).toBe("ResearchProtocol");
    expect(result.diagnostics.handoffs[0].to).toBe("WriterProtocol");
  });

  // 7. Structured Output Self-Repair Loop
  it("should self-repair JSON output if it fails validation against schema", async () => {
    const userSchema = z.object({
      suitName: z.string(),
      mark: z.number().min(1),
    });

    const agent = new JarvisAgent({
      name: "StarkInventory",
      instructions: "Report inventory details.",
      model: "mock-model",
      outputSchema: userSchema,
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "StarkInventory",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    let callCount = 0;
    mockProvider.generateHandler = async (messages) => {
      callCount++;
      if (callCount === 1) {
        // Return INVALID JSON response (missing 'mark' property and invalid format)
        return { content: '{"suitName": "Bleeding Edge"}' };
      }
      // Return VALID JSON conforming to the schema on retry/repair
      return { content: '{"suitName": "Bleeding Edge", "mark": 50}' };
    };

    const result = await runtime.run({
      sessionId: "session-7",
      input: "Show active armor specs",
    });

    expect(result.content).toBe('{"suitName":"Bleeding Edge","mark":50}');
    expect(callCount).toBe(2); // First failed call, followed by self-repair request call
  });

  // 8. Fallback Provider Redundancy
  it("should fall back to backup provider if the primary provider throws error", async () => {
    const primaryProvider = new MockModelProvider();
    const backupProvider = new MockModelProvider();
    
    // Primary provider throws rate-limit errors
    primaryProvider.generateHandler = vi.fn().mockRejectedValue(new Error("Rate limit exceeded."));
    
    // Backup provider handles successfully
    backupProvider.generateHandler = vi.fn().mockResolvedValue({
      content: "Redundant system response active.",
    });

    const agent = new JarvisAgent({
      name: "StarkOS",
      instructions: "Manage system operations.",
      model: "stark-model",
    });

    // Setup fallback provider chain
    const { FallbackProvider } = await import("../src/providers/fallback.js");
    const fallbackProvider = new FallbackProvider([
      { provider: primaryProvider, model: "primary-model" },
      { provider: backupProvider, model: "backup-model" },
    ]);

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "StarkOS",
      memoryBank,
      providers: { "fallback": fallbackProvider },
      defaultProvider: "fallback",
    });

    const result = await runtime.run({
      sessionId: "session-8",
      input: "Run system diagnosis",
    });

    expect(result.content).toBe("Redundant system response active.");
    expect(primaryProvider.generateHandler).toHaveBeenCalled();
    expect(backupProvider.generateHandler).toHaveBeenCalled();
  });

  // 9. Cognitive Memory Fact Storage
  it("should allow storing and recalling facts using cognitive memory tools", async () => {
    const { InMemoryCognitiveMemory, createMemoryTools } = await import("../src/index.js");
    const cognitiveMemory = new InMemoryCognitiveMemory();
    const memoryTools = createMemoryTools(cognitiveMemory);

    const agent = new JarvisAgent({
      name: "CognitiveAgent",
      instructions: "Store facts.",
      model: "mock-model",
      tools: [...memoryTools],
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "CognitiveAgent",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    let callCount = 0;
    mockProvider.generateHandler = async (messages) => {
      callCount++;
      if (callCount === 1) {
        return {
          content: null,
          toolCalls: [
            {
              id: "mem-1",
              name: "store_fact",
              arguments: JSON.stringify({ key: "pilotName", value: "Tony Stark" }),
            },
          ],
        };
      }
      return { content: "Fact stored successfully." };
    };

    const result = await runtime.run({
      sessionId: "session-9",
      input: "Remember that my name is Tony Stark",
    });

    expect(result.content).toBe("Fact stored successfully.");
    const pilotName = await cognitiveMemory.get("pilotName");
    expect(pilotName).toBe("Tony Stark");
  });

  // 10. Asynchronous HITL Suspension and Resume
  it("should suspend execution with JarvisSuspensionError and resume correctly", async () => {
    const { JarvisSuspensionError } = await import("../src/index.js");
    const dangerousTool = createTool({
      name: "self_destruct",
      description: "Trigger self destruct.",
      parameters: z.object({ code: z.string() }),
      execute: async () => "Exploded.",
    });

    const agent = new JarvisAgent({
      name: "SystemCore",
      instructions: "Run system.",
      model: "mock-model",
      tools: [dangerousTool],
      guardrails: {
        beforeToolExecute: async (toolCall) => {
          if (toolCall.name === "self_destruct") {
            return { approved: false, suspend: true, reason: "Requires supervisor validation." };
          }
          return true;
        },
      },
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "SystemCore",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    let callCount = 0;
    mockProvider.generateHandler = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: null,
          toolCalls: [
            {
              id: "self-destruct-call",
              name: "self_destruct",
              arguments: JSON.stringify({ code: "12345" }),
            },
          ],
        };
      }
      return { content: "Destruction sequence completed." };
    };

    let caughtSuspension: any = null;
    try {
      await runtime.run({
        sessionId: "session-10",
        input: "Trigger self destruct code 12345",
      });
    } catch (err: any) {
      if (err instanceof JarvisSuspensionError) {
        caughtSuspension = err;
      }
    }

    expect(caughtSuspension).not.toBeNull();
    expect(caughtSuspension.pendingToolCall.name).toBe("self_destruct");

    // Resume with approved = true
    const resumeResult = await runtime.resume("session-10", true);
    expect(resumeResult.content).toBe("Destruction sequence completed.");
    expect(callCount).toBe(2);
  });

  // 11. File Cognitive Memory Fact Storage
  it("should persist cognitive facts in a JSON file alongside message bank histories", async () => {
    const { FileCognitiveMemory, FileMemoryBank } = await import("../src/index.js");
    const testFile = "scratch/test_hybrid_store.json";
    
    // Clean up if it exists
    const fs = await import("fs/promises");
    try {
      await fs.unlink(testFile);
    } catch {}

    const fileMemoryBank = new FileMemoryBank(testFile);
    const fileCognitiveMemory = new FileCognitiveMemory(testFile);

    // Save a message history session
    await fileMemoryBank.saveMessages("session-a", [{ role: "user", content: "Hello message" }]);

    // Save cognitive facts
    await fileCognitiveMemory.set("location", "Wakanda");
    await fileCognitiveMemory.set("metal", "Vibranium");

    // Read message history back
    const messages = await fileMemoryBank.getMessages("session-a");
    expect(messages[0].content).toBe("Hello message");

    // Read cognitive facts back
    const location = await fileCognitiveMemory.get("location");
    const metal = await fileCognitiveMemory.get("metal");
    expect(location).toBe("Wakanda");
    expect(metal).toBe("Vibranium");

    // Clean up
    try {
      await fs.unlink(testFile);
    } catch {}
  });

  // ─────────────────────────────────────────────────────────────────
  // COMBINATION INTEGRATION TESTS — Section II
  // ─────────────────────────────────────────────────────────────────

  // 13. Multi-Agent Handoff: Direct String Target (Auto-Routing)
  it("1.1 — should auto-route via handOff string target without transfer tool injection", async () => {
    const coder = new JarvisAgent({ name: "Coder", instructions: "Write code.", model: "mock-model" });
    const reviewer = new JarvisAgent({ name: "Reviewer", instructions: "Review code.", model: "mock-model" });

    const runtime = new JarvisRuntime({
      agents: [coder, reviewer],
      defaultAgent: "Coder",
      memoryBank,
      providers: { "mock-provider": mockProvider },
      handOff: { Coder: "Reviewer" }, // Direct string target — auto-routing without transfer tool
    });

    let callIndex = 0;
    const seenSystems: string[] = [];
    mockProvider.generateHandler = async (messages) => {
      callIndex++;
      const sys = messages.find((m) => m.role === "system")?.content ?? "";
      seenSystems.push(sys);
      // Coder completes, then Reviewer picks up
      if (callIndex === 1) return { content: "Here is the code: console.log('hi');" };
      return { content: "Code review: Looks good!" };
    };

    const result = await runtime.run({ sessionId: "combo-1", input: "Write a hello-world program" });

    // Final output should come from the Reviewer
    expect(result.content).toBe("Code review: Looks good!");
    expect(callIndex).toBe(2);
    // Verify agent switching: first call used Coder instructions, second used Reviewer instructions
    expect(seenSystems[0]).toContain("Write code.");
    expect(seenSystems[1]).toContain("Review code.");
    // Diagnostics should record the auto-handoff
    expect(result.diagnostics.handoffs.length).toBe(1);
    expect(result.diagnostics.handoffs[0].from).toBe("Coder");
    expect(result.diagnostics.handoffs[0].to).toBe("Reviewer");
  });

  // 14. Multi-Agent Handoff: Array Target — Inject Transfer Tools for LLM Selection
  it("1.2 — should inject transfer tools when handOff is an array of 2+ targets", async () => {
    const triage = new JarvisAgent({ name: "Triage", instructions: "Route user requests.", model: "mock-model" });
    const billing = new JarvisAgent({ name: "BillingAgent", instructions: "Handle billing.", model: "mock-model" });
    const support = new JarvisAgent({ name: "SupportAgent", instructions: "Handle support.", model: "mock-model" });

    const runtime = new JarvisRuntime({
      agents: [triage, billing, support],
      defaultAgent: "Triage",
      memoryBank,
      providers: { "mock-provider": mockProvider },
      handOff: { Triage: ["BillingAgent", "SupportAgent"] },
    });

    let callIndex = 0;
    let transferToolsInOptions: string[] = [];
    mockProvider.generateHandler = async (messages, options) => {
      callIndex++;
      if (callIndex === 1) {
        // Capture which transfer tools were injected
        transferToolsInOptions = (options.tools ?? []).map((t: any) => t.name);
        // LLM decides to transfer to BillingAgent
        return {
          content: null,
          toolCalls: [{
            id: "triage-to-billing",
            name: "transfer_to_BillingAgent",
            arguments: JSON.stringify({ contextTransferMessage: "User has a billing question." }),
          }],
        };
      }
      // BillingAgent responds
      return { content: "Billing inquiry resolved." };
    };

    const result = await runtime.run({ sessionId: "combo-2", input: "I have a billing issue" });

    // Transfer tools must have been injected
    expect(transferToolsInOptions).toContain("transfer_to_BillingAgent");
    expect(transferToolsInOptions).toContain("transfer_to_SupportAgent");
    // Should have ended with BillingAgent's response
    expect(result.content).toBe("Billing inquiry resolved.");
    expect(result.diagnostics.handoffs[0].from).toBe("Triage");
    expect(result.diagnostics.handoffs[0].to).toBe("BillingAgent");
  });

  // 15. Conditional Edge Function — Case A: loops back (isOptimal: false)
  it("1.3a — conditional function selector should loop back when output is not optimal", async () => {
    const coder = new JarvisAgent({ name: "Coder13", instructions: "Write code.", model: "mock-model" });
    const reviewer = new JarvisAgent({ name: "Reviewer13", instructions: "Review and produce JSON.", model: "mock-model" });

    let reviewCallCount = 0;
    const runtime = new JarvisRuntime({
      agents: [coder, reviewer],
      defaultAgent: "Coder13",
      memoryBank,
      providers: { "mock-provider": mockProvider },
      allowFeedbackLoop: true,
      maxHandoffs: 10,
      handOff: {
        Coder13: "Reviewer13",
        // Reviewer routes back to Coder if code is not optimal, or terminates
        Reviewer13: (output: string) => {
          try {
            const parsed = JSON.parse(output);
            return parsed.isOptimal ? null : "Coder13";
          } catch {
            return "Coder13";
          }
        },
      },
    });

    let callIndex = 0;
    mockProvider.generateHandler = async (messages) => {
      callIndex++;
      const sys = messages.find((m) => m.role === "system")?.content ?? "";
      if (sys.includes("Review")) {
        reviewCallCount++;
        // First review: not optimal → routes back
        if (reviewCallCount === 1) return { content: '{"isOptimal": false, "feedback": "Add error handling."}' };
        // Second review: optimal → terminates
        return { content: '{"isOptimal": true, "feedback": "All good!"}' };
      }
      return { content: "Here is the improved code." };
    };

    const result = await runtime.run({ sessionId: "combo-3a", input: "Write a function." });

    // Should have looped: Coder → Reviewer(not optimal) → Coder → Reviewer(optimal) → done
    expect(reviewCallCount).toBe(2);
    expect(result.content).toBe('{"isOptimal": true, "feedback": "All good!"}');
    // At least 2 handoffs recorded (Coder→Reviewer and Reviewer→Coder→Reviewer)
    expect(result.diagnostics.handoffs.length).toBeGreaterThanOrEqual(2);
  });

  // 16. Conditional Edge Function — Case B: terminates on null
  it("1.3b — conditional function selector should terminate pipeline when function returns null", async () => {
    const coder = new JarvisAgent({ name: "CoderB", instructions: "Write code.", model: "mock-model" });
    const reviewer = new JarvisAgent({ name: "ReviewerB", instructions: "Review.", model: "mock-model" });

    const runtime = new JarvisRuntime({
      agents: [coder, reviewer],
      defaultAgent: "CoderB",
      memoryBank,
      providers: { "mock-provider": mockProvider },
      handOff: {
        CoderB: "ReviewerB",
        // Always optimal — returns null to terminate
        ReviewerB: () => null,
      },
    });

    let callIndex = 0;
    mockProvider.generateHandler = async () => {
      callIndex++;
      if (callIndex === 1) return { content: "Here is the code." };
      return { content: "Review complete. Approved." };
    };

    const result = await runtime.run({ sessionId: "combo-3b", input: "Write a function." });

    expect(result.content).toBe("Review complete. Approved.");
    expect(callIndex).toBe(2); // Exactly 2 calls: Coder + Reviewer
    // Exactly 1 handoff: CoderB → ReviewerB — then terminated
    expect(result.diagnostics.handoffs.length).toBe(1);
  });

  // 17. maxHandoffs Loop Limit Enforcement
  it("1.4 — should abort pipeline when handoff count exceeds maxHandoffs", async () => {
    const agentA = new JarvisAgent({ name: "AgentA", instructions: "Ping.", model: "mock-model" });
    const agentB = new JarvisAgent({ name: "AgentB", instructions: "Pong.", model: "mock-model" });

    const runtime = new JarvisRuntime({
      agents: [agentA, agentB],
      defaultAgent: "AgentA",
      memoryBank,
      providers: { "mock-provider": mockProvider },
      allowFeedbackLoop: true,
      maxHandoffs: 3, // Deliberately low limit
      // Infinite loop: A→B→A→B...
      handOff: {
        AgentA: "AgentB",
        AgentB: "AgentA",
      },
    });

    mockProvider.generateHandler = async () => ({ content: "Still running..." });

    await expect(
      runtime.run({ sessionId: "combo-4", input: "Start the loop" })
    ).rejects.toThrow("Execution aborted. Delegation loop detected: exceeded maximum allowed handoffs (3).");
  });

  // 18. HITL: hitl: true — all tools suspended
  it("2.1 — hitl: true should suspend execution on ANY tool call", async () => {
    const { JarvisSuspensionError } = await import("../src/index.js");
    const toolA = createTool({
      name: "toolA",
      description: "Tool A",
      parameters: z.object({ x: z.string() }),
      execute: async () => "Tool A result.",
    });
    const toolB = createTool({
      name: "toolB",
      description: "Tool B",
      parameters: z.object({ y: z.string() }),
      execute: async () => "Tool B result.",
    });

    const agent = new JarvisAgent({
      name: "HitlAll",
      instructions: "Use tools.",
      model: "mock-model",
      tools: [toolA, toolB],
      hitl: true, // ALL tools require human review
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "HitlAll",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    // LLM calls toolA first
    mockProvider.generateHandler = async () => ({
      content: null,
      toolCalls: [{ id: "tc-a", name: "toolA", arguments: JSON.stringify({ x: "hello" }) }],
    });

    let suspension: any = null;
    try {
      await runtime.run({ sessionId: "combo-5", input: "Run tool A" });
    } catch (err) {
      if (err instanceof JarvisSuspensionError) suspension = err;
    }

    expect(suspension).not.toBeNull();
    expect(suspension.pendingToolCall.name).toBe("toolA");
  });

  // 19. HITL: hitl: ["toolA"] — selective suspension
  it("2.2 — hitl: [\"toolA\"] should suspend on toolA but auto-execute toolB", async () => {
    const { JarvisSuspensionError } = await import("../src/index.js");
    let toolAExecuted = false;
    let toolBExecuted = false;

    const toolA = createTool({
      name: "secure_op",
      description: "Secure operation.",
      parameters: z.object({ cmd: z.string() }),
      execute: async () => { toolAExecuted = true; return "Secure result."; },
    });
    const toolB = createTool({
      name: "public_op",
      description: "Public operation.",
      parameters: z.object({ val: z.string() }),
      execute: async () => { toolBExecuted = true; return "Public result."; },
    });

    const agent = new JarvisAgent({
      name: "HitlSelective",
      instructions: "Use tools.",
      model: "mock-model",
      tools: [toolA, toolB],
      hitl: ["secure_op"], // Only secure_op needs review
    });

    const hitlRuntime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "HitlSelective",
      memoryBank: new InMemoryMemoryBank(),
      providers: { "mock-provider": mockProvider },
    });

    let callCount = 0;
    mockProvider.generateHandler = async () => {
      callCount++;
      if (callCount === 1) {
        // Call public_op first — should run automatically
        return {
          content: null,
          toolCalls: [{ id: "tc-pub", name: "public_op", arguments: JSON.stringify({ val: "data" }) }],
        };
      }
      if (callCount === 2) {
        // After public_op completes, call secure_op — should suspend
        return {
          content: null,
          toolCalls: [{ id: "tc-sec", name: "secure_op", arguments: JSON.stringify({ cmd: "delete" }) }],
        };
      }
      return { content: "Done." };
    };

    let suspension: any = null;
    try {
      await hitlRuntime.run({ sessionId: "combo-6", input: "Run both tools" });
    } catch (err) {
      if (err instanceof JarvisSuspensionError) suspension = err;
    }

    // public_op ran automatically, secure_op was suspended
    expect(toolBExecuted).toBe(true);
    expect(toolAExecuted).toBe(false); // Suspended, not executed
    expect(suspension).not.toBeNull();
    expect(suspension.pendingToolCall.name).toBe("secure_op");
  });

  // 20. HITL Rejection: resume(sessionId, false) injects error and continues
  it("2.3 — HITL resume with approved=false should inject error message and continue execution", async () => {
    const { JarvisSuspensionError } = await import("../src/index.js");
    const dangerousTool = createTool({
      name: "risky_op",
      description: "Risky operation.",
      parameters: z.object({ target: z.string() }),
      execute: async () => "Risky completed.",
    });

    const agent = new JarvisAgent({
      name: "RiskyAgent",
      instructions: "Run operations.",
      model: "mock-model",
      tools: [dangerousTool],
      hitl: ["risky_op"],
    });

    const hitlMem = new InMemoryMemoryBank();
    const hitlRuntime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "RiskyAgent",
      memoryBank: hitlMem,
      providers: { "mock-provider": mockProvider },
    });

    let callCount = 0;
    mockProvider.generateHandler = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: null,
          toolCalls: [{ id: "risky-call", name: "risky_op", arguments: JSON.stringify({ target: "prod-db" }) }],
        };
      }
      return { content: "Acknowledged. Operation was blocked by authorization gate." };
    };

    // Trigger suspension
    let suspension: any = null;
    try {
      await hitlRuntime.run({ sessionId: "combo-7", input: "Execute risky operation" });
    } catch (err) {
      if (err instanceof JarvisSuspensionError) suspension = err;
    }

    expect(suspension).not.toBeNull();

    // Resume with rejection
    const resumeResult = await hitlRuntime.resume("combo-7", false);

    // Should recover gracefully
    expect(resumeResult.content).toBe("Acknowledged. Operation was blocked by authorization gate.");
    // Check that a tool error message was pushed to history
    const history = await hitlMem.getMessages("combo-7");
    const toolMsg = history.find((m) => m.role === "tool" && m.name === "risky_op");
    expect(toolMsg?.content).toContain("Error:");
    expect(toolMsg?.content).toContain("blocked by supervisor");
  });

  // 21. Output Schema + Tool Execution Coexistence
  it("3.1 — agent with outputSchema and tools: tools execute on turn 1, schema validated on turn 2", async () => {
    const inventorySchema = z.object({ item: z.string(), count: z.number() });

    const lookupTool = createTool({
      name: "lookup_inventory",
      description: "Look up inventory item count.",
      parameters: z.object({ sku: z.string() }),
      execute: async ({ sku }) => `Found 42 units of ${sku}.`,
    });

    const agent = new JarvisAgent({
      name: "Inventory",
      instructions: "Report inventory as structured JSON.",
      model: "mock-model",
      tools: [lookupTool],
      outputSchema: inventorySchema,
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "Inventory",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    let callCount = 0;
    let toolsOnCall: string[] | undefined;
    mockProvider.generateHandler = async (messages, options) => {
      callCount++;
      if (callCount === 1) {
        // Turn 1: call the tool — tools should be in scope
        toolsOnCall = (options.tools ?? []).map((t: any) => t.name);
        return {
          content: null,
          toolCalls: [{ id: "inv-1", name: "lookup_inventory", arguments: JSON.stringify({ sku: "SKU-001" }) }],
        };
      }
      // Turn 2: tools stripped, produce schema-conformant JSON
      return { content: '{"item": "SKU-001", "count": 42}' };
    };

    const result = await runtime.run({ sessionId: "combo-8", input: "How many SKU-001 in stock?" });

    // Tool was available on turn 1
    expect(toolsOnCall).toContain("lookup_inventory");
    // Schema output was validated and returned
    expect(result.content).toBe('{"item":"SKU-001","count":42}');
    expect(callCount).toBe(2);
  });

  // 22. extractFirstJson: fenced markdown and prose-wrapped JSON parsing
  it("4.1 — extractFirstJson should parse JSON wrapped in markdown fences or prose", async () => {
    const statusSchema = z.object({ status: z.string(), code: z.number() });

    const agent = new JarvisAgent({
      name: "CompatAgent",
      instructions: "Return system status as JSON.",
      model: "mock-model",
      outputSchema: statusSchema,
    });

    const runtime = new JarvisRuntime({
      agents: [agent],
      defaultAgent: "CompatAgent",
      memoryBank,
      providers: { "mock-provider": mockProvider },
    });

    // Simulate a compat-mode model that wraps JSON in markdown fences
    mockProvider.generateHandler = async () => ({
      content: "Sure! Here is the result:\n```json\n{\"status\": \"active\", \"code\": 200}\n```",
    });

    const result = await runtime.run({ sessionId: "combo-9", input: "System status?" });

    // Should have extracted and validated the JSON cleanly
    expect(result.content).toBe('{"status":"active","code":200}');
  });

  // 23. Code fence stripping in write_code_file tool (markdown code block input)
  it("4.2 — write_code_file tool should strip markdown code fences from written content", async () => {
    const fsModule = await import("fs/promises");
    const pathModule = await import("path");
    const testOutPath = "scratch/fence_test_output.ts";
    try { await fsModule.unlink(testOutPath); } catch {}

    // Recreate the write_code_file tool (as defined in the SDK demo) inline for testing
    const writeCodeFile = createTool({
      name: "write_code_file",
      description: "Write code content to a file.",
      parameters: z.object({
        filePath: z.string(),
        codeContent: z.string(),
      }),
      execute: async ({ filePath, codeContent }) => {
        // Strip markdown code fences (same logic as in the SDK demo tool)
        const stripped = codeContent.replace(/^```[^\n]*\n([\s\S]*?)```\s*$/m, "$1").trim();
        const fullPath = pathModule.resolve(filePath);
        await fsModule.mkdir(pathModule.dirname(fullPath), { recursive: true });
        await fsModule.writeFile(fullPath, stripped + "\n", "utf-8");
        return `Saved to '${filePath}'.`;
      },
    });

    const rawContent = "```typescript\nconst x = 42;\nexport { x };\n```";
    await writeCodeFile.execute({ filePath: testOutPath, codeContent: rawContent });

    const written = await fsModule.readFile(testOutPath, "utf-8");
    // Fences should be stripped — only clean TypeScript remains
    expect(written).not.toContain("```");
    expect(written).toContain("const x = 42;");
    expect(written).toContain("export { x };");

    try { await fsModule.unlink(testOutPath); } catch {}
  });

  // ─────────────────────────────────────────────────────────────────
  // END OF COMBINATION TESTS — Section II
  // ─────────────────────────────────────────────────────────────────

  // 12. Sqlite Cognitive Memory Fact Storage (Session Partitioning)
  it("should persist cognitive facts in a SQLite database and partition them by session ID", async () => {
    const { SqliteCognitiveMemory } = await import("../src/index.js");
    const testDb = "scratch/test_hybrid_store.db";
    
    // Clean up if it exists
    const fs = await import("fs/promises");
    try {
      await fs.unlink(testDb);
    } catch {}

    const memoryOne = new SqliteCognitiveMemory(testDb, "session-one");
    const memoryTwo = new SqliteCognitiveMemory(testDb, "session-two");

    // Save facts in session-one
    await memoryOne.set("pilotName", "Tony Stark");
    await memoryOne.set("suitModel", "Mark 85");

    // Save facts in session-two
    await memoryTwo.set("pilotName", "War Machine");

    // Verify session-one facts
    const nameOne = await memoryOne.get("pilotName");
    const modelOne = await memoryOne.get("suitModel");
    expect(nameOne).toBe("Tony Stark");
    expect(modelOne).toBe("Mark 85");

    // Verify session-two facts (should be isolated)
    const nameTwo = await memoryTwo.get("pilotName");
    const modelTwo = await memoryTwo.get("suitModel");
    expect(nameTwo).toBe("War Machine");
    expect(modelTwo).toBeUndefined(); // Isolated!

    // Verify listing
    const listOne = await memoryOne.list();
    expect(listOne).toEqual({ pilotName: "Tony Stark", suitModel: "Mark 85" });

    // Verify clear
    await memoryOne.clear();
    const clearedOne = await memoryOne.list();
    expect(clearedOne).toEqual({});
    
    const listTwo = await memoryTwo.list();
    expect(listTwo).toEqual({ pilotName: "War Machine" }); // session-two remains intact!

    // Clean up
    try {
      await fs.unlink(testDb);
    } catch {}
  });
});
