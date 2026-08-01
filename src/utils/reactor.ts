import { ArcReactorDiagnostics, TraceStep, Role, ToolCall } from "../types/index.js";

export class ArcReactor {
  private runId: string;
  private sessionId: string;
  private startTime: number;
  private steps: TraceStep[] = [];
  private tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private handoffs: Array<{ from: string; to: string; stepIndex: number; timestamp: number }> = [];
  private errors: string[] = [];

  constructor(runId: string, sessionId: string) {
    this.runId = runId;
    this.sessionId = sessionId;
    this.startTime = Date.now();
  }

  addStep(step: Omit<TraceStep, "stepIndex" | "timestamp">) {
    const stepIndex = this.steps.length;
    this.steps.push({
      ...step,
      stepIndex,
      timestamp: Date.now(),
    });
  }

  recordHandoff(from: string, to: string) {
    this.handoffs.push({
      from,
      to,
      stepIndex: this.steps.length,
      timestamp: Date.now(),
    });
  }

  recordTokens(prompt: number, completion: number) {
    this.tokenUsage.promptTokens += prompt;
    this.tokenUsage.completionTokens += completion;
    this.tokenUsage.totalTokens = this.tokenUsage.promptTokens + this.tokenUsage.completionTokens;
  }

  recordError(errorMsg: string) {
    this.errors.push(errorMsg);
  }

  getDiagnostics(): ArcReactorDiagnostics {
    const endTime = Date.now();
    return {
      runId: this.runId,
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime,
      steps: this.steps,
      tokenUsage: { ...this.tokenUsage },
      handoffs: [...this.handoffs],
      errors: [...this.errors],
      latencyMs: endTime - this.startTime,
    };
  }

  formatReport(): string {
    return ArcReactor.formatReport(this.getDiagnostics());
  }

  static formatReport(diag: ArcReactorDiagnostics): string {
    let report = `========================================\n`;
    report += `ARC REACTOR DIAGNOSTICS [RUN: ${diag.runId}]\n`;
    report += `========================================\n`;
    report += `Session: ${diag.sessionId}\n`;
    report += `Latency: ${diag.latencyMs}ms\n`;
    report += `Energy (Tokens) Consumed:\n`;
    report += `  - Prompt: ${diag.tokenUsage.promptTokens}\n`;
    report += `  - Completion: ${diag.tokenUsage.completionTokens}\n`;
    report += `  - Total: ${diag.tokenUsage.totalTokens}\n`;
    report += `Handoff count: ${diag.handoffs.length}\n`;
    if (diag.handoffs.length > 0) {
      diag.handoffs.forEach((h, idx) => {
        report += `  - [Handoff #${idx + 1}] ${h.from} -> ${h.to} (Step ${h.stepIndex})\n`;
      });
    }
    report += `Steps Executed: ${diag.steps.length}\n`;
    diag.steps.forEach((s) => {
      report += `  [Step ${s.stepIndex}] [${s.agentName}] [${s.role.toUpperCase()}]`;
      if (s.content) {
        const preview = s.content.length > 60 ? `${s.content.slice(0, 60)}...` : s.content;
        report += `: "${preview.replace(/\n/g, " ")}"`;
      }
      if (s.toolCalls && s.toolCalls.length > 0) {
        report += ` - Called: ${s.toolCalls.map((tc) => tc.name).join(", ")}`;
      }
      report += `\n`;
    });
    if (diag.errors.length > 0) {
      report += `System Failures:\n`;
      diag.errors.forEach((err) => {
        report += `  - [Error] ${err}\n`;
      });
    }
    report += `========================================`;
    return report;
  }
}
