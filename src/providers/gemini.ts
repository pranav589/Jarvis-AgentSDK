import { GoogleGenAI } from "@google/genai";
import { BaseModelProvider } from "./base.js";
import { Message, ModelProviderOptions, ModelResponse, ToolCall } from "../types/index.js";
import { zodToJsonSchema } from "../utils/schema.js";

export class GeminiProvider extends BaseModelProvider {
  name = "gemini";
  private client: GoogleGenAI;

  constructor(config?: string | { apiKey?: string; baseURL?: string }) {
    super();
    // Initialize Google Gen AI
    if (typeof config === "string") {
      this.client = new GoogleGenAI({
        apiKey: config,
      });
    } else {
      const baseUrl = config?.baseURL || process.env.GEMINI_BASE_URL;
      this.client = new GoogleGenAI({
        apiKey: config?.apiKey || process.env.GEMINI_API_KEY,
        ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
      });
    }
  }

  private mapTools(options: ModelProviderOptions) {
    if (!options.tools || options.tools.length === 0) return undefined;
    return [
      {
        functionDeclarations: options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: zodToJsonSchema(t.parameters),
        })),
      },
    ];
  }

  private mapMessages(messages: Message[]): { systemInstruction?: string; contents: any[] } {
    const nonSystem = messages.filter((m) => m.role !== "system");
    const systemInstruction = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .filter(Boolean)
      .join("\n");

    const contents = nonSystem.map((m) => {
      if (m.role === "user") {
        return {
          role: "user",
          parts: [{ text: m.content || "" }],
        };
      } else if (m.role === "assistant") {
        const parts: any[] = [];
        if (m.content) {
          parts.push({ text: m.content });
        }
        if (m.toolCalls && m.toolCalls.length > 0) {
          m.toolCalls.forEach((tc) => {
            let args = {};
            try {
              args = JSON.parse(tc.arguments);
            } catch (e) {
              // Ignore
            }
            parts.push({
              functionCall: {
                name: tc.name,
                args,
              },
            });
          });
        }
        return {
          role: "model",
          parts,
        };
      } else if (m.role === "tool") {
        let responseObj = { result: m.content };
        try {
          if (m.content && (m.content.startsWith("{") || m.content.startsWith("["))) {
            responseObj = JSON.parse(m.content);
          }
        } catch (e) {
          // Keep default string wrapper
        }
        return {
          role: "tool",
          parts: [
            {
              functionResponse: {
                name: m.name || "",
                response: responseObj,
              },
            },
          ],
        };
      }
      return {
        role: "user",
        parts: [{ text: m.content || "" }],
      };
    });

    return {
      systemInstruction: systemInstruction || undefined,
      contents,
    };
  }

  async generate(
    messages: Message[],
    options: ModelProviderOptions
  ): Promise<ModelResponse> {
    const { systemInstruction, contents } = this.mapMessages(messages);
    const geminiTools = this.mapTools(options);
    const hasTools = geminiTools && geminiTools.length > 0;

    let finalSystemInstruction = systemInstruction;
    if (hasTools && options.outputSchema) {
      const schemaStr = JSON.stringify(zodToJsonSchema(options.outputSchema));
      finalSystemInstruction = (finalSystemInstruction ? finalSystemInstruction + "\n\n" : "") +
        `IMPORTANT: When you return your final text response, you MUST format it as a valid JSON object matching the following JSON Schema:\n${schemaStr}\nReturn ONLY the raw JSON string without any explanation or markdown formatting code blocks.`;
    }

    const config: any = {
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
      systemInstruction: finalSystemInstruction || undefined,
      tools: geminiTools,
    };

    if (options.outputSchema && !hasTools) {
      config.responseMimeType = "application/json";
      config.responseSchema = zodToJsonSchema(options.outputSchema);
    }

    const response = await this.client.models.generateContent({
      model: options.model,
      contents,
      config,
    });

    const responseText = response.text || null;
    const toolCalls: ToolCall[] = [];

    if (response.functionCalls) {
      response.functionCalls.forEach((fc, idx) => {
        toolCalls.push({
          id: `gemini-call-${Date.now()}-${idx}`,
          name: fc.name || "unknown",
          arguments: JSON.stringify(fc.args),
        });
      });
    }

    return {
      content: responseText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
          }
        : undefined,
    };
  }

  async generateStream(
    messages: Message[],
    options: ModelProviderOptions,
    onChunk: (text: string) => void
  ): Promise<ModelResponse> {
    const { systemInstruction, contents } = this.mapMessages(messages);
    const geminiTools = this.mapTools(options);
    const hasTools = geminiTools && geminiTools.length > 0;

    let finalSystemInstruction = systemInstruction;
    if (hasTools && options.outputSchema) {
      const schemaStr = JSON.stringify(zodToJsonSchema(options.outputSchema));
      finalSystemInstruction = (finalSystemInstruction ? finalSystemInstruction + "\n\n" : "") +
        `IMPORTANT: When you return your final text response, you MUST format it as a valid JSON object matching the following JSON Schema:\n${schemaStr}\nReturn ONLY the raw JSON string without any explanation or markdown formatting code blocks.`;
    }

    const config: any = {
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
      systemInstruction: finalSystemInstruction || undefined,
      tools: geminiTools,
    };

    if (options.outputSchema && !hasTools) {
      config.responseMimeType = "application/json";
      config.responseSchema = zodToJsonSchema(options.outputSchema);
    }

    const responseStream = await this.client.models.generateContentStream({
      model: options.model,
      contents,
      config,
    });

    let fullText = "";
    const toolCalls: ToolCall[] = [];
    let usage: { promptTokens: number; completionTokens: number } | undefined = undefined;

    for await (const chunk of responseStream) {
      if (chunk.usageMetadata) {
        usage = {
          promptTokens: chunk.usageMetadata.promptTokenCount || 0,
          completionTokens: chunk.usageMetadata.candidatesTokenCount || 0,
        };
      }

      if (chunk.text) {
        fullText += chunk.text;
        onChunk(chunk.text);
      }
      
      if (chunk.functionCalls) {
        chunk.functionCalls.forEach((fc, idx) => {
          toolCalls.push({
            id: `gemini-call-${Date.now()}-${idx}`,
            name: fc.name || "unknown",
            arguments: JSON.stringify(fc.args),
          });
        });
      }
    }

    return {
      content: fullText || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }
}
