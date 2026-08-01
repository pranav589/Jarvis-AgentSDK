import { z } from "zod";

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface Message {
  role: Role;
  content: string | null;
  name?: string; // Optional: identifies the tool or agent
  toolCalls?: ToolCall[];
  toolCallId?: string; // For role: "tool", matches the ToolCall.id
}

export interface JarvisToolDefinition<T extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  parameters: T;
  execute: (args: z.infer<T>, context?: any) => Promise<any> | any;
}

export interface VibraniumShieldConfig {
  /**
   * Pre-execution input validation. Return string to continue (optionally modifying), or throw/return null to block.
   */
  beforeInput?: (input: string, context?: any) => Promise<string> | string;
  
  /**
   * Post-execution output validation or scrubbing. Return modified string.
   */
  afterOutput?: (output: string, context?: any) => Promise<string> | string;
  
  /**
   * Pre-execution tool validation. Return true to proceed, false or throw to block. Can be used for manual approval.
   */
  beforeToolExecute?: (
    toolCall: ToolCall, 
    context?: any
  ) => Promise<{ approved: boolean; reason?: string; suspend?: boolean } | boolean> | ({ approved: boolean; reason?: string; suspend?: boolean } | boolean);
}

export class JarvisSuspensionError extends Error {
  runId: string;
  sessionId: string;
  pendingToolCall: ToolCall;
  diagnostics: ArcReactorDiagnostics;

  constructor(
    runId: string,
    sessionId: string,
    pendingToolCall: ToolCall,
    diagnostics: ArcReactorDiagnostics
  ) {
    super(`Execution suspended. Tool '${pendingToolCall.name}' requires authorization.`);
    this.name = "JarvisSuspensionError";
    this.runId = runId;
    this.sessionId = sessionId;
    this.pendingToolCall = pendingToolCall;
    this.diagnostics = diagnostics;
  }
}

export interface JarvisAgentConfig {
  name: string;
  instructions: string | ((context: any) => Promise<string> | string);
  model: string;
  provider?: string | ModelProvider; // Explicit provider key or provider instance
  tools?: JarvisToolDefinition<any>[];
  guardrails?: VibraniumShieldConfig;
  outputSchema?: z.ZodType<any>;
  hitl?: boolean | string[]; // Triggers Human-In-The-Loop review for tools
}

export interface TraceStep {
  stepIndex: number;
  agentName: string;
  role: Role;
  content?: string | null;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ toolCallId: string; name: string; result: any; error?: string }>;
  timestamp: number;
  latencyMs?: number;
}

export interface ArcReactorDiagnostics {
  runId: string;
  sessionId: string;
  startTime: number;
  endTime?: number;
  steps: TraceStep[];
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  handoffs: Array<{
    from: string;
    to: string;
    stepIndex: number;
    timestamp: number;
  }>;
  errors: string[];
  latencyMs?: number;
}

export interface ModelResponse {
  content: string | null;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface ModelProviderOptions {
  model: string;
  outputSchema?: z.ZodType<any>;
  temperature?: number;
  maxTokens?: number;
  tools?: JarvisToolDefinition<any>[];
}

export interface ModelProvider {
  name: string;
  generate(
    messages: Message[],
    options: ModelProviderOptions
  ): Promise<ModelResponse>;
  
  generateStream?(
    messages: Message[],
    options: ModelProviderOptions,
    onChunk: (text: string) => void
  ): Promise<ModelResponse>;
}

export interface MemoryBank {
  getMessages(sessionId: string): Promise<Message[]>;
  saveMessages(sessionId: string, messages: Message[]): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

export type HandoffTarget = 
  | string 
  | string[] 
  | ((result: string, context?: any) => string | null | undefined | Promise<string | null | undefined>);

// Runtime Configuration
export interface JarvisRuntimeConfig {
  agents: JarvisAgentConfig[];
  defaultAgent: string;
  memoryBank?: MemoryBank;
  providers?: Record<string, ModelProvider>;
  defaultProvider?: string;
  maxSteps?: number;
  maxHandoffs?: number; // Maximum allowed delegation handoffs to prevent infinite loops
  context?: any; // Global context passed to tools and guardrails
  handOff?: Record<string, HandoffTarget>; // Map of agent names to allowed handoff targets or conditional handoff functions
  allowFeedbackLoop?: boolean; // Enable or disable feedback loopbacks between agents
}

// Streaming and Event-Based Interface
export type JarvisEvent =
  | { type: "text:chunk"; chunk: string }
  | { type: "tool:start"; toolCall: ToolCall }
  | { type: "tool:end"; toolCall: ToolCall; result: any; error?: string }
  | { type: "handoff:start"; from: string; to: string }
  | { type: "shield:blocked"; direction: "input" | "output" | "tool"; reason: string }
  | { type: "run:start"; runId: string; agentName: string }
  | { type: "run:step"; step: TraceStep }
  | { type: "run:complete"; diagnostics: ArcReactorDiagnostics; result: string }
  | { type: "run:failed"; diagnostics: ArcReactorDiagnostics; error: string };

export type JarvisEventListener = (event: JarvisEvent) => void;
