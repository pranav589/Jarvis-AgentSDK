import { Message, ModelProvider, ModelProviderOptions, ModelResponse } from "../types/index.js";

export abstract class BaseModelProvider implements ModelProvider {
  abstract name: string;
  
  abstract generate(
    messages: Message[],
    options: ModelProviderOptions
  ): Promise<ModelResponse>;
  
  // Implementers can optionally support streaming
  generateStream?(
    messages: Message[],
    options: ModelProviderOptions,
    onChunk: (text: string) => void
  ): Promise<ModelResponse>;
}
