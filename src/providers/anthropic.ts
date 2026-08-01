import Anthropic from "@anthropic-ai/sdk";
import { BaseModelProvider } from "./base.js";
import { Message, ModelProviderOptions, ModelResponse, ToolCall } from "../types/index.js";
import { zodToJsonSchema } from "../utils/schema.js";

export class AnthropicProvider extends BaseModelProvider {
  name = "anthropic";
  private client: Anthropic;

  constructor(config?: string | { apiKey?: string; baseURL?: string }) {
    super();
    if (typeof config === "string") {
      this.client = new Anthropic({
        apiKey: config,
      });
    } else {
      this.client = new Anthropic({
        apiKey: config?.apiKey || process.env.ANTHROPIC_API_KEY,
        baseURL: config?.baseURL || process.env.ANTHROPIC_BASE_URL,
      });
    }
  }

  private mapTools(options: ModelProviderOptions) {
    if (!options.tools || options.tools.length === 0) return undefined;
    return options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.parameters),
    }));
  }

  private mapMessages(messages: Message[]): { system?: string; mappedMessages: any[] } {
    const nonSystem = messages.filter((m) => m.role !== "system");
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .filter(Boolean)
      .join("\n");

    const mappedMessages: any[] = [];

    for (const msg of nonSystem) {
      if (msg.role === "user") {
        mappedMessages.push({
          role: "user",
          content: msg.content || "",
        });
      } else if (msg.role === "assistant") {
        const content: any[] = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          msg.toolCalls.forEach((tc) => {
            let input = {};
            try {
              input = JSON.parse(tc.arguments);
            } catch (e) {
              // Ignore parse error, pass raw or empty
            }
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input,
            });
          });
        }
        mappedMessages.push({
          role: "assistant",
          content: content.length > 0 ? content : "",
        });
      } else if (msg.role === "tool") {
        // Find if the last message was a user message containing tool results, if so we can group them
        const lastMsg = mappedMessages[mappedMessages.length - 1];
        const isError = msg.content?.includes("Error:") || false;
        
        const toolResultBlock = {
          type: "tool_result" as const,
          tool_use_id: msg.toolCallId || "",
          content: msg.content || "",
          is_error: isError,
        };

        if (lastMsg && lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
          lastMsg.content.push(toolResultBlock);
        } else {
          mappedMessages.push({
            role: "user",
            content: [toolResultBlock],
          });
        }
      }
    }

    // Anthropic requires messages to alternate role. Let's merge consecutive roles if any.
    const strictAlternating: any[] = [];
    for (const msg of mappedMessages) {
      if (strictAlternating.length === 0) {
        strictAlternating.push(msg);
        continue;
      }
      
      const last = strictAlternating[strictAlternating.length - 1];
      if (last.role === msg.role) {
        // Merge contents
        const lastContent = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
        const currentContent = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];
        last.content = [...lastContent, ...currentContent];
      } else {
        strictAlternating.push(msg);
      }
    }

    return {
      system: system || undefined,
      mappedMessages: strictAlternating,
    };
  }

  async generate(
    messages: Message[],
    options: ModelProviderOptions
  ): Promise<ModelResponse> {
    const { system, mappedMessages } = this.mapMessages(messages);
    const anthropicTools = this.mapTools(options);

    const body: Anthropic.MessageCreateParamsNonStreaming = {
      model: options.model,
      messages: mappedMessages,
      system,
      tools: anthropicTools,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature,
    };

    const response = await this.client.messages.create(body);

    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      content: textContent || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
          }
        : undefined,
    };
  }

  async generateStream(
    messages: Message[],
    options: ModelProviderOptions,
    onChunk: (text: string) => void
  ): Promise<ModelResponse> {
    const { system, mappedMessages } = this.mapMessages(messages);
    const anthropicTools = this.mapTools(options);

    const stream = await this.client.messages.create({
      model: options.model,
      messages: mappedMessages,
      system,
      tools: anthropicTools,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature,
      stream: true,
    });

    let fullText = "";
    const toolCalls: ToolCall[] = [];
    let currentToolCall: { id: string; name: string; arguments: string } | null = null;

    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        currentToolCall = {
          id: event.content_block.id,
          name: event.content_block.name,
          arguments: "",
        };
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          fullText += event.delta.text;
          onChunk(event.delta.text);
        } else if (event.delta.type === "input_json_delta") {
          if (currentToolCall) {
            currentToolCall.arguments += event.delta.partial_json;
          }
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolCall) {
          toolCalls.push(currentToolCall);
          currentToolCall = null;
        }
      }
    }

    return {
      content: fullText || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
