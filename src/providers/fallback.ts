import { BaseModelProvider } from "./base.js";
import { Message, ModelProvider, ModelProviderOptions, ModelResponse } from "../types/index.js";

export interface FallbackConfig {
  provider: ModelProvider;
  model: string;
}

export class FallbackProvider extends BaseModelProvider {
  name = "fallback";
  private fallbacks: FallbackConfig[];

  constructor(fallbacks: FallbackConfig[]) {
    super();
    if (fallbacks.length === 0) {
      throw new Error("FallbackProvider requires at least one fallback configuration.");
    }
    this.fallbacks = fallbacks;
  }

  async generate(
    messages: Message[],
    options: ModelProviderOptions
  ): Promise<ModelResponse> {
    const errors: Error[] = [];

    for (const config of this.fallbacks) {
      try {
        // Run with the fallback provider and model
        const response = await config.provider.generate(messages, {
          ...options,
          model: config.model,
        });
        return response;
      } catch (err: any) {
        errors.push(err);
        console.warn(
          `[Jarvis Backup Protocol] Active system failure on provider '${config.provider.name}' with model '${config.model}'. Attempting next redundant system. Error: ${err.message}`
        );
      }
    }

    throw new Error(
      `All fallback systems failed. Diagnostics:\n${errors
        .map((e, idx) => `[System ${idx + 1}]: ${e.message}`)
        .join("\n")}`
    );
  }

  async generateStream(
    messages: Message[],
    options: ModelProviderOptions,
    onChunk: (text: string) => void
  ): Promise<ModelResponse> {
    const errors: Error[] = [];

    for (const config of this.fallbacks) {
      try {
        if (config.provider.generateStream) {
          const response = await config.provider.generateStream(
            messages,
            {
              ...options,
              model: config.model,
            },
            onChunk
          );
          return response;
        } else {
          // Fallback to non-streaming if stream is not supported on this provider
          const response = await config.provider.generate(messages, {
            ...options,
            model: config.model,
          });
          onChunk(response.content || "");
          return response;
        }
      } catch (err: any) {
        errors.push(err);
        console.warn(
          `[Jarvis Backup Protocol] Active system failure on streaming provider '${config.provider.name}' with model '${config.model}'. Attempting next redundant system. Error: ${err.message}`
        );
      }
    }

    throw new Error(
      `All fallback streaming systems failed. Diagnostics:\n${errors
        .map((e, idx) => `[System ${idx + 1}]: ${e.message}`)
        .join("\n")}`
    );
  }
}
