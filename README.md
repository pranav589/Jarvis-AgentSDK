# JarvisAgentSDK (J.A.R.V.I.S.)

> **Just A Rather Very Intelligent System** — A transparent, type-safe, developer-first AI Agent SDK built in raw TypeScript.

[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/Tests-Passing-green.svg)](#)

---

## Table of Contents

- [Jarvis AgentSDK](#-jarvis-agent-sdk)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Core Capabilities](#️-advanced-core-capabilities)
- [Model Providers & Fallbacks](#️-model-providers-and-redundancy)
- [Memory Systems](#-memory-systems)
- [Security & Guardrails](#-vibranium-shields-guardrails)
- [Agent Handoffs](#-house-party-protocol-handoffs)
- [Diagnostics & Telemetry](#-arc-reactor-diagnostics-telemetry-tracing)
- [Streaming & Events](#-streaming--comms-persona)
- [Type Safety](#-type-system--interfaces)
- [Advanced Features](#-advanced-features)
- [API Reference](#-api-reference)
- [License](#-license)

---

## 🚀 Jarvis AgentSDK

### Who it is for
Developers building autonomous LLM agents or multi-agent coordinator networks who need **production-grade execution control, deterministic tracing, and zero-magic architectures**.

### The Problem
Existing frameworks (e.g., LangChain, CrewAI) wrap the agent loop inside complex, opinionated black-box abstractions. When a tool fails, a model gets stuck in an infinite loop, or structured outputs violate formatting rules, debugging is painful. Adding custom tool guardrails, rate-limit fallback models, or multi-agent delegation requires writing massive, non-standard boilerplates.

### The Jarvis Solution
`JarvisAgentSDK` brings Tony Stark's command center to every developer's IDE:
- **House Party Protocol (Handoffs)**: Fully transparent, context-preserving handoffs between specialized agents, auto-generating delegation tools on the fly and creating a clear trace DAG of the chain of command.
- **ArcReactor Diagnostics (Tracing)**: Detailed runtime telemetry logging token consumption (energy), latency, step histories, and execution paths.
- **Vibranium Shields (Guardrails)**: Declarative pre-input validation, post-output scrubbing (PII redaction), and pre-execution tool checks (e.g., prompting for user confirmation before executing write actions).
- **Self-Repairing Outputs**: Automated structured output verification and self-healing LLM feedback loops.
- **Redundancy Systems (Fallbacks)**: Auto-recovery chains that switch model providers or API keys on rate-limits or service outages.
- **Cognitive Memory**: Long-term fact storage agents can autonomously store and recall.
- **Human-in-the-Loop (HITL)**: Suspension points for manual approval workflows.

---

## 📦 Installation

```bash
npm install jarvis-agent-sdk
```

### Peer Dependencies
The SDK requires the following peer dependencies based on your provider choices:

```bash
# For OpenAI
npm install openai

# For Anthropic Claude
npm install @anthropic-ai/sdk

# For Google Gemini
npm install @google/genai

# For SQLite memory storage
npm install better-sqlite3

# For Zod schemas (required)
npm install zod
```

---

## ⚡ Quick Start

Configure your environment variables in `.env`:

```env
OPENAI_API_KEY=your-openai-api-key
GEMINI_API_KEY=your-google-gemini-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

Write your first agent script:

```typescript
import { JarvisAgent, JarvisRuntime, OpenAIProvider } from "jarvis-agent-sdk";

// 1. Define the protocol (agent)
const jarvisCore = new JarvisAgent({
  name: "JarvisCore",
  instructions: "You are the central JARVIS assistant. Assist the user politely.",
  model: "gpt-4o",
});

// 2. Initialize provider and runtime
const provider = new OpenAIProvider();
const runtime = new JarvisRuntime({
  agents: [jarvisCore],
  defaultAgent: "JarvisCore",
  providers: { "openai": provider },
  defaultProvider: "openai",
});

// 3. Execute query
const response = await runtime.run({
  sessionId: "stark-lab-1",
  input: "Jarvis, is the Arc Reactor fully charged?",
});

console.log(response.content);
// Output: "Yes, sir. All core systems are operational at 100% capacity."
```

---

## 🛠️ Advanced Core Capabilities

### 1. Custom Tools (Subsystems)

Define subsystems with strict, type-safe validation schemas using `zod`. Inputs are automatically verified before execution.

```typescript
import { createTool } from "jarvis-agent-sdk";
import { z } from "zod";

const fireThrusters = createTool({
  name: "fire_thrusters",
  description: "Fires flight thrusters to change suit speed.",
  parameters: z.object({
    powerLevel: z.number().min(1).max(100).describe("Percentage power of thrusters"),
  }),
  execute: async ({ powerLevel }) => {
    // Perform flight calculations
    return `Thrusters fired at ${powerLevel}% capacity. Speed adjusted.`;
  },
});

// Register with agent
const agent = new JarvisAgent({
  name: "FlightControl",
  instructions: "Manage suit flight systems.",
  model: "gpt-4o",
  tools: [fireThrusters],
});
```

**Tool Features:**
- Automatic parameter validation with detailed error messages
- Async-first execution (sync functions also supported)
- Context injection for accessing global runtime state
- Alphanumeric naming with dash/underscore support

### 2. Dynamic Instructions

Agents can have static strings or callable instruction generators for context-aware prompts:

```typescript
const contextAwareAgent = new JarvisAgent({
  name: "ContextAgent",
  instructions: (context) => {
    return `You are assisting ${context.user?.name || "a user"}. Current time: ${new Date().toISOString()}`;
  },
  model: "gpt-4o",
});
```

---

## 🛡️ Vibranium Shields (Guardrails)

Vibranium Shields protect system flows by inspecting inputs/outputs and prompting for manual execution authorization.

### Input Validation

```typescript
const defenseAgent = new JarvisAgent({
  name: "DefenseSystem",
  instructions: "Coordinate defensive subsystems.",
  model: "gpt-4o",
  guardrails: {
    // Pre-input validation
    beforeInput: (input) => {
      if (input.includes("unauthorized override")) {
        throw new Error("Breach attempt blocked by Stark protocol.");
      }
      return input;
    },
  }
});
```

### Output Scrubbing (PII Redaction)

```typescript
const secureAgent = new JarvisAgent({
  name: "SecureChannel",
  instructions: "Process sensitive data securely.",
  model: "gpt-4o",
  guardrails: {
    // Post-output scrubbing
    afterOutput: (output) => {
      // Redact credit cards, SSNs, API keys
      return output
        .replace(/\d{4}-\d{4}-\d{4}-\d{4}/g, "[REDACTED_CARD]")
        .replace(/\d{3}-\d{2}-\d{4}/g, "[REDACTED_SSN]")
        .replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED_KEY]");
    },
  }
});
```

### Tool Execution Guards

```typescript
const approvalAgent = new JarvisAgent({
  name: "WeaponSystem",
  instructions: "Manage defensive weaponry.",
  model: "gpt-4o",
  guardrails: {
    beforeToolExecute: async (toolCall) => {
      if (toolCall.name === "launch_missiles") {
        console.log(`[Shield]: Manual approval required for: ${toolCall.name}`);
        const userApproved = await askUserApproval(toolCall);
        return { 
          approved: userApproved, 
          reason: userApproved ? "Authorized" : "Denied by operator"
        };
      }
      return { approved: true };
    }
  }
});
```

### Human-in-the-Loop (HITL)

Suspend execution for manual approval:

```typescript
import { cliApprovalGate, JarvisSuspensionError } from "jarvis-agent-sdk";

const hitlAgent = new JarvisAgent({
  name: "CriticalSystem",
  instructions: "Handle critical operations.",
  model: "gpt-4o",
  hitl: true, // Enable HITL for all tools
  // OR: hitl: ["delete_database", "deploy_production"] // Specific tools only
  guardrails: {
    beforeToolExecute: async (toolCall) => {
      if (toolCall.name === "dangerous_operation") {
        const approved = await cliApprovalGate(toolCall);
        return { approved, suspend: !approved };
      }
      return { approved: true };
    }
  }
});

// Handle suspension
try {
  const result = await runtime.run({ sessionId: "ops", input: "Execute critical task" });
} catch (err) {
  if (err instanceof JarvisSuspensionError) {
    console.log(`Suspended at tool: ${err.pendingToolCall.name}`);
    console.log(`Run ID: ${err.runId}`);
    // Later: resume with approval
    const resumed = await runtime.resume({
      runId: err.runId,
      sessionId: err.sessionId,
      approved: true
    });
  }
}
```

---

## 🎭 House Party Protocol (Handoffs)

When multiple agents are registered in the `JarvisRuntime`, the system **automatically injects delegation tools** into each agent's active scope. This allows agents to hand off tasks to specialized protocols dynamically.

### Basic Handoff

```typescript
const researcher = new JarvisAgent({
  name: "ResearchProtocol",
  instructions: "Search databases for materials and element details.",
  model: "gpt-4o",
});

const writer = new JarvisAgent({
  name: "ReportProtocol",
  instructions: "Synthesize findings into highly-detailed engineering blueprints.",
  model: "gpt-4o",
});

const runtime = new JarvisRuntime({
  agents: [researcher, writer],
  defaultAgent: "ResearchProtocol",
  providers: { "openai": new OpenAIProvider() },
});

// Runtime auto-generates 'transfer_to_ReportProtocol' tool
const result = await runtime.run({
  sessionId: "element-creation-session",
  input: "Search for Vibranium atomic numbers and compile a blueprint report.",
});
```

### Conditional Handoff Routing

```typescript
const runtime = new JarvisRuntime({
  agents: [researcher, writer, reviewer],
  defaultAgent: "ResearchProtocol",
  providers: { "openai": new OpenAIProvider() },
  handOff: {
    // Static routing
    "ResearchProtocol": ["ReportProtocol", "Reviewer"],
    
    // Dynamic routing based on output
    "ReportProtocol": (result, context) => {
      if (result.includes("urgent")) return "Reviewer";
      return null; // No handoff
    }
  }
});
```

### Handoff Features

- **Automatic tool generation**: `transfer_to_<AgentName>` tools created dynamically
- **Context preservation**: All conversation history transferred
- **Chain tracking**: Complete delegation DAG in diagnostics
- **Loop prevention**: Configurable `maxHandoffs` (default: 5)

---

## 📊 Arc Reactor Diagnostics (Telemetry Tracing)

Every execution run yields detailed diagnostic reports summarizing token consumption, path logs, errors, and latencies.

### Basic Usage

```typescript
const { content, diagnostics } = await runtime.run({
  sessionId: "flight-trace",
  input: "Calculate flight path to Stark Tower",
});

console.log(`Latency: ${diagnostics.latencyMs}ms`);
console.log(`Total Tokens: ${diagnostics.tokenUsage.totalTokens}`);
console.log(diagnostics.formatReport());
```

### Diagnostic Output Example

```
========================================
ARC REACTOR DIAGNOSTICS [RUN: abc123]
========================================
Session: flight-trace
Latency: 3420ms
Energy (Tokens) Consumed:
  - Prompt: 245
  - Completion: 128
  - Total: 373
Handoff count: 1
  - [Handoff #1] ResearchProtocol -> ReportProtocol (Step 3)
Steps Executed: 5
  [Step 0] [ResearchProtocol] [USER]: "Calculate flight path..."
  [Step 1] [ResearchProtocol] [ASSISTANT] - Called: search_database
  [Step 2] [ResearchProtocol] [TOOL]: "Found: Vibranium..."
  [Step 3] [ResearchProtocol] [ASSISTANT]: "Transferring to ReportProtocol..."
  [Step 4] [ReportProtocol] [ASSISTANT]: "Blueprint completed..."
========================================
```

### Diagnostic Properties

```typescript
interface ArcReactorDiagnostics {
  runId: string;
  sessionId: string;
  startTime: number;
  endTime: number;
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
  latencyMs: number;
}
```

---

## 🔌 Model Providers and Redundancy

### Supported Providers

#### OpenAI (GPT-4, GPT-4o, GPT-3.5-turbo)

```typescript
import { OpenAIProvider } from "jarvis-agent-sdk";

const provider = new OpenAIProvider();
// Or with custom config:
const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1" // or custom endpoint
});
```

**Features:**
- Native JSON schema validation (`json_schema` mode)
- Streaming with tool calls
- Compatible with OpenAI-compatible APIs (Mistral, Together, etc.)
- Automatic compat-mode detection for non-OpenAI endpoints

#### Anthropic (Claude 3 Family)

```typescript
import { AnthropicProvider } from "jarvis-agent-sdk";

const provider = new AnthropicProvider();
```

**Features:**
- Native tool use support
- Automatic message role alternation
- Tool result grouping
- Streaming tool calls

#### Google Gemini

```typescript
import { GeminiProvider } from "jarvis-agent-sdk";

const provider = new GeminiProvider();
```

**Features:**
- Native function calling
- Response schema validation
- Streaming support
- System instruction injection

### Fallback Provider Chain

Build multi-provider structures and fallbacks to prevent rate-limit blocks:

```typescript
import { FallbackProvider, OpenAIProvider, GeminiProvider } from "jarvis-agent-sdk";

const fallbackChain = new FallbackProvider([
  { provider: new OpenAIProvider(), model: "gpt-4o" },
  { provider: new GeminiProvider(), model: "gemini-2.5-flash" },
  { provider: new AnthropicProvider(), model: "claude-3-5-sonnet-20241022" },
]);

const runtime = new JarvisRuntime({
  agents: [jarvisCore],
  defaultAgent: "JarvisCore",
  providers: { "fallback-system": fallbackChain },
  defaultProvider: "fallback-system",
});
```

When one provider fails, the system automatically tries the next in the chain with transparent error logging.

---

## 💾 Memory Systems

### Session Memory Banks

Keep track of multi-turn conversation states.

#### InMemoryMemoryBank

Default, runtime-only storage:

```typescript
import { InMemoryMemoryBank } from "jarvis-agent-sdk";

const runtime = new JarvisRuntime({
  agents: [agent],
  defaultAgent: "JarvisCore",
  memoryBank: new InMemoryMemoryBank(),
});
```

#### FileMemoryBank

JSON file-backed persistence:

```typescript
import { FileMemoryBank } from "jarvis-agent-sdk";

const runtime = new JarvisRuntime({
  agents: [agent],
  defaultAgent: "JarvisCore",
  memoryBank: new FileMemoryBank("stark_sessions.json"),
});
```

#### SqliteMemoryBank

Database-backed storage:

```typescript
import { SqliteMemoryBank } from "jarvis-agent-sdk";

const runtime = new JarvisRuntime({
  agents: [agent],
  defaultAgent: "JarvisCore",
  memoryBank: new SqliteMemoryBank("stark_systems.db"),
});
```

### Cognitive Memory (Long-Term Facts)

Agents can autonomously store and recall facts across sessions:

```typescript
import { SqliteCognitiveMemory, createMemoryTools } from "jarvis-agent-sdk";

const cognitiveMemory = new SqliteCognitiveMemory("jarvis_facts.db", "user-123");
const memoryTools = createMemoryTools(cognitiveMemory);

const agent = new JarvisAgent({
  name: "Jarvis",
  instructions: "You are JARVIS. Remember important facts about the user.",
  model: "gpt-4o",
  tools: memoryTools, // Adds 'store_fact' and 'recall_facts' tools
});
```

**Memory Tools:**
- `store_fact`: Store a key-value fact in long-term memory
- `recall_facts`: Recall specific facts or list all stored memories

---

## 🔧 Streaming & Comms Persona

### Event-Based Architecture

Listen to streaming events in real-time:

```typescript
import { JarvisComms } from "jarvis-agent-sdk";

// Attach live voice logs to runtime console
JarvisComms.attachToRuntime(runtime);

const result = await runtime.run({
  sessionId: "session-42",
  input: "Flares status check",
});
```

### Manual Event Handling

```typescript
runtime.on("run:start", (e) => console.log(`Starting: ${e.agentName}`));
runtime.on("text:chunk", (e) => process.stdout.write(e.chunk));
runtime.on("tool:start", (e) => console.log(`Tool: ${e.toolCall.name}`));
runtime.on("handoff:start", (e) => console.log(`${e.from} -> ${e.to}`));
runtime.on("run:complete", (e) => console.log(`Done: ${e.diagnostics.latencyMs}ms`));
runtime.on("shield:blocked", (e) => console.log(`Blocked: ${e.reason}`));
```

### Event Types

```typescript
type JarvisEvent =
  | { type: "run:start"; runId: string; agentName: string }
  | { type: "text:chunk"; chunk: string }
  | { type: "tool:start"; toolCall: ToolCall }
  | { type: "tool:end"; toolCall: ToolCall; result: any; error?: string }
  | { type: "handoff:start"; from: string; to: string }
  | { type: "shield:blocked"; direction: "input" | "output" | "tool"; reason: string }
  | { type: "run:complete"; diagnostics: ArcReactorDiagnostics; result: string }
  | { type: "run:failed"; diagnostics: ArcReactorDiagnostics; error: string };
```

---

## 🎯 Self-Repairing Structured Outputs

Enforce responses matching a Zod validation schema. If the model output violates the schema format, the runtime loop intercepts the error, provides feedback to the LLM, and retries up to 3 times to self-repair the JSON structure.

```typescript
const suitSpecsSchema = z.object({
  suitName: z.string(),
  flightSpeed: z.number().describe("Mach speed limit"),
  weaponsArmed: z.boolean(),
});

const diagnosticAgent = new JarvisAgent({
  name: "SpecsAnalyzer",
  instructions: "Analyze suit properties and output JSON conforming to the schema.",
  model: "gpt-4o",
  outputSchema: suitSpecsSchema,
});

const result = await runtime.run({
  sessionId: "specs-check",
  input: "Analyze the Mark III suit specifications",
});

// result.content is validated against suitSpecsSchema
const specs = JSON.parse(result.content);
```

**Features:**
- Native JSON schema validation on supported providers
- Markdown code fence extraction (````json...````)
- Self-repair loop with LLM feedback
- Max 3 retry attempts

---

## 🔐 Execution Control & Safety

### Step Limits

Prevent infinite loops:

```typescript
const runtime = new JarvisRuntime({
  agents: [agent],
  defaultAgent: "JarvisCore",
  maxSteps: 20,        // Default: 10
  maxHandoffs: 3,     // Default: 5
});
```

### Context Injection

Pass global context to all tools and guardrails:

```typescript
const runtime = new JarvisRuntime({
  agents: [agent],
  defaultAgent: "JarvisCore",
  context: {
    userId: "stark-001",
    permissions: ["read", "write"],
    environment: "production"
  }
});
```

Access in tools:

```typescript
const tool = createTool({
  name: "check_permissions",
  parameters: z.object({}),
  execute: async (_, context) => {
    return `User ${context.userId} has permissions: ${context.permissions.join(", ")}`;
  }
});
```

---

## 📚 Type System & Interfaces

### Core Types

```typescript
// Message structure
interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

// Tool call
interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

// Agent configuration
interface JarvisAgentConfig {
  name: string;
  instructions: string | ((context: any) => Promise<string> | string);
  model: string;
  provider?: string | ModelProvider;
  tools?: JarvisToolDefinition<any>[];
  guardrails?: VibraniumShieldConfig;
  outputSchema?: z.ZodType<any>;
  hitl?: boolean | string[];
}

// Runtime configuration
interface JarvisRuntimeConfig {
  agents: JarvisAgentConfig[];
  defaultAgent: string;
  memoryBank?: MemoryBank;
  providers?: Record<string, ModelProvider>;
  defaultProvider?: string;
  maxSteps?: number;
  maxHandoffs?: number;
  context?: any;
  handOff?: Record<string, HandoffTarget>;
}
```

---

## 🚀 Advanced Features

### Zod to JSON Schema Conversion

Convert Zod schemas to provider-compatible formats:

```typescript
import { zodToJsonSchema } from "jarvis-agent-sdk";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number().optional()
});

const jsonSchema = zodToJsonSchema(schema);
// {
//   type: "object",
//   properties: {
//     name: { type: "string" },
//     age: { type: "number" }
//   },
//   required: ["name"]
// }
```

### Custom Provider Implementation

Extend the base provider for custom backends:

```typescript
import { BaseModelProvider, Message, ModelProviderOptions, ModelResponse } from "jarvis-agent-sdk";

class CustomProvider extends BaseModelProvider {
  name = "custom";
  
  async generate(
    messages: Message[],
    options: ModelProviderOptions
  ): Promise<ModelResponse> {
    // Implement your custom LLM integration
    return {
      content: "Response from custom provider",
      usage: { promptTokens: 0, completionTokens: 0 }
    };
  }
  
  // Optional: implement generateStream for streaming support
}
```

### Custom Memory Backend

Extend base memory for any persistence layer:

```typescript
import { BaseMemoryBank, Message } from "jarvis-agent-sdk";

class RedisMemoryBank extends BaseMemoryBank {
  async getMessages(sessionId: string): Promise<Message[]> {
    // Redis implementation
  }
  
  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    // Redis implementation
  }
  
  async clear(sessionId: string): Promise<void> {
    // Redis implementation
  }
}
```

---

## 📖 API Reference

### Classes

| Class | Description |
|-------|-------------|
| `JarvisAgent` | Protocol definition for an AI agent |
| `JarvisRuntime` | Execution engine for multi-agent orchestration |
| `JarvisTool` | Type-safe tool with Zod validation |
| `VibraniumShield` | Guardrail system for input/output/tool validation |
| `ArcReactor` | Telemetry and diagnostics collector |
| `JarvisComms` | Event-to-console logger with JARVIS persona |

### Providers

| Provider | Description |
|----------|-------------|
| `OpenAIProvider` | GPT-4, GPT-4o, and compatible APIs |
| `AnthropicProvider` | Claude 3 family |
| `GeminiProvider` | Google Gemini models |
| `FallbackProvider` | Multi-provider failover chain |

### Memory

| Class | Description |
|-------|-------------|
| `InMemoryMemoryBank` | Runtime-only session storage |
| `FileMemoryBank` | JSON file-backed persistence |
| `SqliteMemoryBank` | Database-backed sessions |
| `InMemoryCognitiveMemory` | Runtime fact storage |
| `FileCognitiveMemory` | JSON file fact storage |
| `SqliteCognitiveMemory` | Database fact storage |

### Functions

| Function | Description |
|----------|-------------|
| `createTool(config)` | Create a type-safe tool |
| `createMemoryTools(memory)` | Generate store/recall tools |
| `zodToJsonSchema(schema)` | Convert Zod to JSON Schema |
| `cliApprovalGate(toolCall)` | HITL CLI approval prompt |

---

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to the main repository.

---

## 📜 License

MIT License. Designed with ❤️ by the Jarvis SDK Team.

---

## 🔗 Links

- [GitHub Repository](https://github.com/your-username/jarvis-agent-sdk)
- [npm Package](https://www.npmjs.com/package/jarvis-agent-sdk)
- [Issue Tracker](https://github.com/your-username/jarvis-agent-sdk/issues)
- [Documentation](https://github.com/your-username/jarvis-agent-sdk#readme)
