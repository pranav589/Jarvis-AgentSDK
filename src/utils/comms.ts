import { JarvisEvent, ToolCall } from "../types/index.js";

export class JarvisComms {
  static log(message: string) {
    console.log(`[J.A.R.V.I.S.]: ${message}`);
  }

  static warn(message: string) {
    console.warn(`[J.A.R.V.I.S. Warning]: ${message}`);
  }

  static error(message: string) {
    console.error(`[J.A.R.V.I.S. Alert]: ${message}`);
  }

  /**
   * Translates events into console messages with a JARVIS persona.
   */
  static handleEvent(event: JarvisEvent) {
    switch (event.type) {
      case "run:start":
        this.log(`Protocol '${event.agentName}' initialized. Initializing systems. [Run ID: ${event.runId}]`);
        break;

      case "text:chunk":
        // Print streaming chunks directly to stdout
        process.stdout.write(event.chunk);
        break;

      case "tool:start":
        this.log(`Initiating suit subsystem: '${event.toolCall.name}' with input: ${event.toolCall.arguments}`);
        break;

      case "tool:end":
        if (event.error) {
          this.error(`Subsystem '${event.toolCall.name}' returned an execution error: "${event.error}"`);
        } else {
          this.log(`Subsystem '${event.toolCall.name}' execution completed successfully.`);
        }
        break;

      case "handoff:start":
        this.log(`Delegation protocol initiated: Handing control over from '${event.from}' to '${event.to}'.`);
        break;

      case "shield:blocked":
        this.error(`Vibranium Shield active: Blocked ${event.direction} flow. Reason: "${event.reason}"`);
        break;

      case "run:complete":
        this.log(`Task completed successfully, sir. Run Latency: ${event.diagnostics.latencyMs}ms. Energy (tokens) used: ${event.diagnostics.tokenUsage.totalTokens}.`);
        break;

      case "run:failed":
        this.error(`Critical systems failure. Execution aborted: "${event.error}"`);
        break;

      default:
        break;
    }
  }

  /**
   * Bind comms output to a JarvisRuntime's event stream.
   */
  static attachToRuntime(runtime: any) {
    runtime.on("run:start", (e: any) => this.handleEvent({ type: "run:start", ...e }));
    runtime.on("text:chunk", (e: any) => this.handleEvent({ type: "text:chunk", ...e }));
    runtime.on("tool:start", (e: any) => this.handleEvent({ type: "tool:start", ...e }));
    runtime.on("tool:end", (e: any) => this.handleEvent({ type: "tool:end", ...e }));
    runtime.on("handoff:start", (e: any) => this.handleEvent({ type: "handoff:start", ...e }));
    runtime.on("shield:blocked", (e: any) => this.handleEvent({ type: "shield:blocked", ...e }));
    runtime.on("run:complete", (e: any) => this.handleEvent({ type: "run:complete", ...e }));
    runtime.on("run:failed", (e: any) => this.handleEvent({ type: "run:failed", ...e }));
  }
}
