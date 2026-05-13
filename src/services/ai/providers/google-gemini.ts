import { BaseAIProvider, type ToolCallResult } from "./base-provider.js";
import { AISessionManager } from "../session/ai-session-manager.js";
import type { ChatCompletionTool } from "../tools/tool-schema.js";
import { log } from "../../logger.js";
import { UserProfileValidator } from "../validators/user-profile-validator.js";

/**
 * Google Gemini Provider
 * Supports Google's Gemini models (e.g. gemini-1.5-flash) via Google AI Studio API.
 */
export class GoogleGeminiProvider extends BaseAIProvider {
  private readonly aiSessionManager: AISessionManager;

  constructor(config: any, aiSessionManager: AISessionManager) {
    super(config);
    this.aiSessionManager = aiSessionManager;
  }

  getProviderName(): string {
    return "google-gemini";
  }

  supportsSession(): boolean {
    return true;
  }

  private addToolResponse(
    sessionId: string,
    messages: any[],
    toolCallId: string,
    content: string
  ): void {
    this.aiSessionManager.addMessageAtomic({
      aiSessionId: sessionId,
      role: "tool",
      content,
      toolCallId,
    });
    let response: any;
    try {
      response = JSON.parse(content);
    } catch {
      log("Gemini: failed to parse tool response content in addToolResponse", { content });
      response = { raw: content };
    }
    // Gemini tool response format
    messages.push({
      role: "function",
      parts: [
        {
          functionResponse: {
            name: toolCallId.split(":")[0], // Gemini expects the name of the function
            response,
          },
        },
      ],
    });
  }

  private _buildGeminiContents(
    existingMessages: any[],
    userPrompt: string,
    sessionId: string
  ): any[] {
    const contents: any[] = [];
    for (const msg of existingMessages) {
      if (msg.role === "system") continue;

      const role = msg.role === "assistant" ? "model" : "user";
      const parts: any[] = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          let args: any;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            log("Gemini: failed to parse tool call arguments", {
              arguments: tc.function.arguments,
            });
            args = {};
          }
          parts.push({
            functionCall: {
              name: tc.function.name,
              args,
            },
          });
        }
      }

      if (msg.role === "tool") {
        let response: any;
        try {
          response = JSON.parse(msg.content);
        } catch {
          log("Gemini: failed to parse tool response content", { content: msg.content });
          response = { raw: msg.content };
        }
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: (msg.toolCallId || "").split(":")[0],
                response,
              },
            },
          ],
        });
        continue;
      }

      contents.push({ role, parts });
    }

    if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
      this.aiSessionManager.addMessageAtomic({
        aiSessionId: sessionId,
        role: "user",
        content: userPrompt,
      });
      contents.push({ role: "user", parts: [{ text: userPrompt }] });
    }

    return contents;
  }

  private _buildGeminiRequestBody(
    contents: any[],
    systemPrompt: string,
    toolSchema: ChatCompletionTool
  ): any {
    return {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      tools: [
        {
          functionDeclarations: [
            {
              name: toolSchema.function.name,
              description: toolSchema.function.description,
              parameters: toolSchema.function.parameters,
            },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [toolSchema.function.name],
        },
      },
      generationConfig: {
        ...(this.config.memoryTemperature !== false
          ? { temperature: this.config.memoryTemperature ?? 0.3 }
          : {}),
      },
    };
  }

  private _handleGeminiResponse(
    data: any,
    session: any,
    contents: any[],
    toolSchema: ChatCompletionTool,
    iterations: number
  ): ToolCallResult | null {
    const candidate = data.candidates?.[0];
    if (!candidate?.content) {
      return { success: false, error: "Invalid Gemini API response format", iterations };
    }

    const modelMsg = candidate.content;
    const assistantMsg: any = {
      aiSessionId: session.id,
      role: "assistant",
      content: "",
      toolCalls: [],
    };

    for (const part of modelMsg.parts) {
      if (part.text) assistantMsg.content += part.text;
      if (part.functionCall) {
        assistantMsg.toolCalls.push({
          id: `${part.functionCall.name}:${Date.now()}`,
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }

    this.aiSessionManager.addMessageAtomic(assistantMsg);
    contents.push(modelMsg);

    if (assistantMsg.toolCalls.length > 0) {
      for (const toolCall of assistantMsg.toolCalls) {
        if (toolCall.function.name === toolSchema.function.name) {
          try {
            const parsed = JSON.parse(toolCall.function.arguments);
            const result = UserProfileValidator.validate(parsed);
            if (!result.valid) throw new Error(result.errors.join(", "));

            this.addToolResponse(
              session.id,
              contents,
              toolCall.id,
              JSON.stringify({ success: true })
            );
            return { success: true, data: result.data, iterations };
          } catch (validationError) {
            const errorMessage = `Validation failed: ${String(validationError)}`;
            this.addToolResponse(
              session.id,
              contents,
              toolCall.id,
              JSON.stringify({ success: false, error: errorMessage })
            );
            return { success: false, error: errorMessage, iterations };
          }
        }
      }
    }

    return null;
  }

  async executeToolCall(
    systemPrompt: string,
    userPrompt: string,
    toolSchema: ChatCompletionTool,
    sessionId: string
  ): Promise<ToolCallResult> {
    let session = this.aiSessionManager.getSession(sessionId, "google-gemini");

    if (!session) {
      session = this.aiSessionManager.createSession({
        provider: "google-gemini",
        sessionId,
      });
    }

    const existingMessages = this.aiSessionManager.getMessages(session.id);
    const contents = this._buildGeminiContents(existingMessages, userPrompt, session.id);

    let iterations = 0;
    const maxIterations = this.config.maxIterations ?? 5;
    const iterationTimeout = this.config.iterationTimeout ?? 30000;

    while (iterations < maxIterations) {
      iterations++;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), iterationTimeout);

      try {
        const baseUrl = this.config.apiUrl || "https://generativelanguage.googleapis.com/v1beta";
        const url = `${baseUrl}/models/${this.config.model}:generateContent`;
        const requestBody = this._buildGeminiRequestBody(contents, systemPrompt, toolSchema);

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey ? { "x-goog-api-key": this.config.apiKey } : {}),
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text().catch(() => response.statusText);
          log("Gemini API error", {
            provider: this.getProviderName(),
            model: this.config.model,
            status: response.status,
            error: errorText,
            iteration: iterations,
          });
          return {
            success: false,
            error: `Gemini API error: ${response.status} - ${errorText}`,
            iterations,
          };
        }

        const data = (await response.json()) as any;
        const result = this._handleGeminiResponse(data, session, contents, toolSchema, iterations);
        if (result) return result;

        const retryPrompt = "Please use the save_memories tool as instructed.";
        this.aiSessionManager.addMessageAtomic({
          aiSessionId: session.id,
          role: "user",
          content: retryPrompt,
        });
        contents.push({ role: "user", parts: [{ text: retryPrompt }] });
      } catch (error) {
        clearTimeout(timeout);
        return { success: false, error: String(error), iterations };
      }
    }

    return { success: false, error: `Max iterations (${maxIterations}) reached`, iterations };
  }
}
