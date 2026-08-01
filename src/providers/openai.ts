import OpenAI from "openai";
import { BaseModelProvider } from "./base.js";
import { Message, ModelProviderOptions, ModelResponse, ToolCall } from "../types/index.js";
import { zodToJsonSchema } from "../utils/schema.js";

export class OpenAIProvider extends BaseModelProvider {
  name = "openai";
  private client: OpenAI;
  /** True when pointing at a non-OpenAI OpenAI-compatible endpoint (e.g. Mistral, Together). */
  private readonly isCompatMode: boolean;

  constructor(config?: string | { apiKey?: string; baseURL?: string }) {
    super();
    if (typeof config === "string") {
      this.client = new OpenAI({ apiKey: config });
      this.isCompatMode = false;
    } else {
      this.client = new OpenAI({
        apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
        baseURL: config?.baseURL || process.env.OPENAI_BASE_URL,
      });
      // Any custom baseURL means we're talking to a compat provider — disable OpenAI-only features.
      this.isCompatMode = !!(config?.baseURL || process.env.OPENAI_BASE_URL);
    }
  }

  private mapMessages(messages: Message[]) {
    return messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content || "",
          tool_call_id: m.toolCallId || "",
        };
      }

      const mapped: any = {
        role: m.role,
        content: (m.content === null || m.content === undefined) ? "" : m.content,
      };

      if (m.name) {
        mapped.name = m.name;
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        mapped.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      return mapped;
    });
  }

  private mapTools(options: ModelProviderOptions) {
    if (!options.tools || options.tools.length === 0) return undefined;
    return options.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.parameters),
      },
    }));
  }

  /**
   * Injects a JSON schema constraint into the system message when the provider
   * does not support `response_format: json_schema` natively (compat mode, or
   * when tools are also present — which OpenAI itself doesn't allow together).
   */
  private injectSchemaIntoSystemMessage(
    messages: ReturnType<typeof this.mapMessages>,
    options: ModelProviderOptions
  ): ReturnType<typeof this.mapMessages> {
    const schema = zodToJsonSchema(options.outputSchema!);
    const schemaInstruction = `\n\nYou MUST respond with a single valid JSON object that strictly matches this JSON Schema. Do NOT include any extra text, markdown, or code fences:\n${JSON.stringify(schema, null, 2)}`;

    const systemIdx = messages.findIndex((m) => m.role === "system");
    if (systemIdx !== -1) {
      const sys = { ...messages[systemIdx] };
      sys.content = (sys.content || "") + schemaInstruction;
      return [...messages.slice(0, systemIdx), sys, ...messages.slice(systemIdx + 1)];
    }
    return [{ role: "system" as const, content: schemaInstruction }, ...messages];
  }

  async generate(
    messages: Message[],
    options: ModelProviderOptions
  ): Promise<ModelResponse> {
    let formattedMessages = this.mapMessages(messages);
    const formattedTools = this.mapTools(options);
    const hasTools = formattedTools && formattedTools.length > 0;

    // Use json_schema only when on real OpenAI AND no tools conflict.
    const useNativeSchema = options.outputSchema && !this.isCompatMode && !hasTools;
    // Fall back to system-prompt injection for compat providers or when tools are present.
    const useSchemaInjection = options.outputSchema && (this.isCompatMode || hasTools);

    if (useSchemaInjection) {
      formattedMessages = this.injectSchemaIntoSystemMessage(formattedMessages, options);
    }

    const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: options.model,
      messages: formattedMessages,
      tools: formattedTools,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };

    if (useNativeSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          strict: true,
          schema: zodToJsonSchema(options.outputSchema!),
        },
      };
    } else if (useSchemaInjection) {
      // Tell the model to return JSON without using the OpenAI-only json_schema format.
      body.response_format = { type: "json_object" };
    }

    const response = await this.client.chat.completions.create(body);
    const choice = response.choices[0];

    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content: choice.message.content,
      toolCalls,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }

  async generateStream(
    messages: Message[],
    options: ModelProviderOptions,
    onChunk: (text: string) => void
  ): Promise<ModelResponse> {
    let formattedMessages = this.mapMessages(messages);
    const formattedTools = this.mapTools(options);
    const hasTools = formattedTools && formattedTools.length > 0;

    const useNativeSchema = options.outputSchema && !this.isCompatMode && !hasTools;
    const useSchemaInjection = options.outputSchema && (this.isCompatMode || hasTools);

    if (useSchemaInjection) {
      formattedMessages = this.injectSchemaIntoSystemMessage(formattedMessages, options);
    }

    const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: options.model,
      messages: formattedMessages,
      tools: formattedTools,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
    };

    if (useNativeSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          strict: true,
          schema: zodToJsonSchema(options.outputSchema!),
        },
      };
    } else if (useSchemaInjection) {
      body.response_format = { type: "json_object" };
    }

    const stream = await this.client.chat.completions.create(body);
    let fullText = "";
    let usage: { promptTokens: number; completionTokens: number } | undefined = undefined;

    // Track partial tool calls by index
    const toolCallBuilders: Record<number, { id?: string; name?: string; arguments: string }> = {};

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
        };
      }

      const choice = chunk.choices[0];
      if (!choice) continue;

      if (choice.delta.content) {
        fullText += choice.delta.content;
        onChunk(choice.delta.content);
      }

      if (choice.delta.tool_calls) {
        for (const tcChunk of choice.delta.tool_calls) {
          const index = tcChunk.index;
          if (!toolCallBuilders[index]) {
            toolCallBuilders[index] = { arguments: "" };
          }
          if (tcChunk.id) {
            toolCallBuilders[index].id = tcChunk.id;
          }
          if (tcChunk.function?.name) {
            toolCallBuilders[index].name = tcChunk.function.name;
          }
          if (tcChunk.function?.arguments) {
            toolCallBuilders[index].arguments += tcChunk.function.arguments;
          }
        }
      }
    }

    const toolCalls: ToolCall[] = Object.values(toolCallBuilders)
      .filter((tc) => tc.id && tc.name)
      .map((tc) => ({
        id: tc.id!,
        name: tc.name!,
        arguments: tc.arguments,
      }));

    return {
      content: fullText || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }
}
