# JarvisAgentSDK (J.A.R.V.I.S.)

> **Just A Rather Very Intelligent System** — A transparent, type-safe, developer-first AI Agent SDK built in raw TypeScript.

[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/Tests-Passing-green.svg)](#)

---



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

---

## 📦 Installation

Initialize your project and install the SDK along with its dependencies:

```bash
npm install jarvis-agent-sdk
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
```

### 2. Vibranium Shields (Guardrails)
Vibranium Shields protect system flows by inspecting inputs/outputs and prompting for manual execution authorization.

```typescript
const defenseAgent = new JarvisAgent({
  name: "DefenseSystem",
  instructions: "Coordinate defensive subsystems.",
  model: "gpt-4o",
  guardrails: {
    // 🛡️ Input validation shield
    beforeInput: (input) => {
      if (input.includes("unauthorized override")) {
        throw new Error("Breach attempt blocked by Stark protocol.");
      }
      return input;
    },
    // 🛡️ Output scrubbing shield
    afterOutput: (output) => {
      // Redact credit cards, keys, or passwords
      return output.replace(/\d{4}-\d{4}-\d{4}-\d{4}/g, "[REDACTED_DATA]");
    },
    // 🛡️ Tool confirmation approval gate
    beforeToolExecute: async (toolCall) => {
      if (toolCall.name === "launch_missiles") {
        console.log(`[Jarvis Shield]: Manual approval required to run tool: ${toolCall.name}`);
        // Prompt user, wait for CLI input, etc.
        const userApproved = true; 
        return { approved: userApproved, reason: "Command authorized by Tony Stark." };
      }
      return true;
    }
  }
});
```

### 3. House Party Protocol (Handoffs)
When multiple agents are registered in the `JarvisRuntime`, the system **automatically injects delegation tools** into each agent's active scope. This allows agents to hand off tasks to specialized protocols dynamically.

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

// The runtime generates tool 'transfer_to_ReportProtocol' dynamically
// If ResearchProtocol invokes it, context is transferred and active execution switches to ReportProtocol.
const result = await runtime.run({
  sessionId: "element-creation-session",
  input: "Search for Vibranium atomic numbers and compile a blueprint report on it.",
});
```

### 4. Self-Repairing Structured Outputs
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
```

### 5. Pluggable MemoryBanks (Sessions)
Keep track of multi-turn conversation states. The SDK supports:
- `InMemoryMemoryBank`: Default memory store.
- `FileMemoryBank`: JSON file-backed persistence.
- `SqliteMemoryBank`: Database storage adapter utilizing `better-sqlite3`.

```typescript
import { SqliteMemoryBank } from "jarvis-agent-sdk";

const runtime = new JarvisRuntime({
  agents: [jarvisCore],
  defaultAgent: "JarvisCore",
  memoryBank: new SqliteMemoryBank("stark_systems.db"), // Saves and loads sessions here
  providers: { "openai": new OpenAIProvider() },
});
```

### 6. Streaming & Comms Persona
Listen to streaming events in real-time. Bind `JarvisComms` to print live logs using J.A.R.V.I.S.'s polite, helpful personality.

```typescript
import { JarvisComms } from "jarvis-agent-sdk";

// Attach live voice logs to runtime console
JarvisComms.attachToRuntime(runtime);

const result = await runtime.run({
  sessionId: "session-42",
  input: "Flares status check",
});
```

---

## 📊 Arc Reactor Diagnostics (Telemetry Tracing)

Every execution run yields detailed diagnostic reports summarizing token consumption, path logs, errors, and latencies.

```typescript
const { content, diagnostics } = await runtime.run({
  sessionId: "flight-trace",
  input: "Calculate flight path to Stark Tower",
});

// Access properties
console.log(`Latency: ${diagnostics.latencyMs}ms`);
console.log(`Total Tokens: ${diagnostics.tokenUsage.totalTokens}`);

// Format standard console report
console.log(diagnostics.formatReport());
```

---

## 🛡️ Model Providers and Redundancy

Build multi-provider structures and fallbacks to prevent rate-limit blocks:

```typescript
import { FallbackProvider, OpenAIProvider, GeminiProvider } from "jarvis-agent-sdk";

const fallbackChain = new FallbackProvider([
  { provider: new OpenAIProvider(), model: "gpt-4o" },
  { provider: new GeminiProvider(), model: "gemini-2.5-flash" },
]);

const runtime = new JarvisRuntime({
  agents: [jarvisCore],
  defaultAgent: "JarvisCore",
  providers: { "fallback-system": fallbackChain },
  defaultProvider: "fallback-system",
});
```

---

## 📜 License

MIT License. Designed with ❤️ by the Google DeepMind Antigravity Pair Programming team.
