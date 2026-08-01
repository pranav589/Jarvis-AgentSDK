import { z } from "zod";
import { JarvisAgentConfig, JarvisToolDefinition, VibraniumShieldConfig, ModelProvider } from "../types/index.js";

export class JarvisAgent implements JarvisAgentConfig {
  name: string;
  instructions: string | ((context: any) => Promise<string> | string);
  model: string;
  provider?: string | ModelProvider;
  tools: JarvisToolDefinition<any>[];
  guardrails?: VibraniumShieldConfig;
  outputSchema?: z.ZodType<any>;
  hitl?: boolean | string[];

  constructor(config: JarvisAgentConfig) {
    if (!config.name || !/^[a-zA-Z0-9_-]+$/.test(config.name)) {
      throw new Error(`Invalid protocol name: "${config.name}". Must be alphanumeric, dashes, or underscores.`);
    }
    this.name = config.name;
    this.instructions = config.instructions;
    this.model = config.model;
    this.provider = config.provider;
    this.tools = config.tools || [];
    this.guardrails = config.guardrails;
    this.outputSchema = config.outputSchema;
    this.hitl = config.hitl;
  }

  async getInstructions(context?: any): Promise<string> {
    if (typeof this.instructions === "function") {
      return this.instructions(context);
    }
    return this.instructions;
  }

  addTool(tool: JarvisToolDefinition<any>): void {
    this.tools.push(tool);
  }
}
