import { z } from "zod";
import { JarvisToolDefinition } from "../types/index.js";

export class JarvisTool<T extends z.ZodObject<any> = z.ZodObject<any>> implements JarvisToolDefinition<T> {
  name: string;
  description: string;
  parameters: T;
  execute: (args: z.infer<T>, context?: any) => Promise<any> | any;

  constructor(config: JarvisToolDefinition<T>) {
    // Suit validation
    if (!config.name || !/^[a-zA-Z0-9_-]+$/.test(config.name)) {
      throw new Error(`Invalid tool name: "${config.name}". Names must be alphanumeric with underscores or dashes.`);
    }
    this.name = config.name;
    this.description = config.description;
    this.parameters = config.parameters;
    this.execute = config.execute;
  }

  async run(args: any, context?: any): Promise<any> {
    // Pre-execution parameter validation checks
    const result = this.parameters.safeParse(args);
    if (!result.success) {
      const errorMsg = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      throw new Error(`Subsystem parameter validation failed for '${this.name}': ${errorMsg}`);
    }
    return this.execute(result.data, context);
  }
}

export function createTool<T extends z.ZodObject<any>>(
  config: JarvisToolDefinition<T>
): JarvisTool<T> {
  return new JarvisTool(config);
}
