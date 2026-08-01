import * as readline from "readline";
import { ToolCall, VibraniumShieldConfig } from "../types/index.js";

export class VibraniumShield {
  private config?: VibraniumShieldConfig;

  constructor(config?: VibraniumShieldConfig) {
    this.config = config;
  }

  async shieldInput(input: string, context?: any): Promise<string> {
    if (this.config?.beforeInput) {
      try {
        return await this.config.beforeInput(input, context);
      } catch (err: any) {
        throw new Error(`Input blocked by Vibranium Shield: ${err.message}`);
      }
    }
    return input;
  }

  async shieldOutput(output: string, context?: any): Promise<string> {
    if (this.config?.afterOutput) {
      try {
        return await this.config.afterOutput(output, context);
      } catch (err: any) {
        throw new Error(`Output blocked by Vibranium Shield validation: ${err.message}`);
      }
    }
    return output;
  }

  async checkTool(
    toolCall: ToolCall,
    context?: any
  ): Promise<{ approved: boolean; reason?: string; suspend?: boolean }> {
    if (this.config?.beforeToolExecute) {
      try {
        const result = await this.config.beforeToolExecute(toolCall, context);
        if (typeof result === "boolean") {
          return {
            approved: result,
            reason: result ? undefined : `Tool '${toolCall.name}' blocked by Vibranium Shield.`,
          };
        }
        return result;
      } catch (err: any) {
        return {
          approved: false,
          reason: `Tool execution failed Vibranium Shield checks: ${err.message}`,
        };
      }
    }
    return { approved: true };
  }
}

/**
 * Built-in Human-in-the-Loop CLI approval gate.
 * Suspends execution in local CLI sessions and prompts the developer for permission.
 */
export async function cliApprovalGate(toolCall: ToolCall): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `\n🚨 [J.A.R.V.I.S. HITL ALERT]: Authorize subsystem execution for '${toolCall.name}' with arguments: ${toolCall.arguments}? (y/n): `,
      (answer) => {
        rl.close();
        const approved = answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
        resolve(approved);
      }
    );
  });
}
