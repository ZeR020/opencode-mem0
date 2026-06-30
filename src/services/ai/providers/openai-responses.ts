import {
  BaseAIProvider,
  type ProviderConfig,
  type ToolCallResult,
  applySafeExtraParams,
} from "./base-provider.js";
import { AISessionManager } from "../session/ai-session-manager.js";
import { ToolSchemaConverter, type ChatCompletionTool } from "../tools/tool-schema.js";
import { UserProfileValidator } from "../validators/user-profile-validator.js";
import { log } from "../../logger.js";

interface ResponsesAPIOutput {
  id: string;
  object: string;
  model: string;
  output: Array<{
    type: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: any;
  }>;
  conversation?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class OpenAIResponsesProvider extends BaseAIProvider {
  private readonly aiSessionManager: AISessionManager;

  constructor(config: ProviderConfig, aiSessionManager: AISessionManager) {
    super(config);
    this.aiSessionManager = aiSessionManager;
  }

  getProviderName(): string {
    return "openai-responses";
  }

  private _buildResponsesRequestBody(
    currentPrompt: string,
    conversationId: string | undefined,
    systemPrompt: string,
    tool: any
  ): any {
    const requestBody: any = {
      model: this.config.model,
      input: currentPrompt,
      tools: [tool],
    };

    if (conversationId) {
      requestBody.conversation = conversationId;
    } else {
      requestBody.instructions = systemPrompt;
    }

    if (this.config.extraParams) {
      applySafeExtraParams(requestBody, this.config.extraParams);
    }

    return requestBody;
  }

  private _handleResponsesResponse(
    data: ResponsesAPIOutput,
    session: any,
    sessionId: string,
    toolSchema: ChatCompletionTool,
    iterations: number,
    userPrompt: string
  ): { result: ToolCallResult | null; conversationId: string; retryPrompt: string } {
    let conversationId = data.conversation || session.conversationId;

    if (iterations === 1) {
      this.aiSessionManager.addMessageAtomic({
        aiSessionId: session.id,
        role: "user",
        content: userPrompt,
      });
    }

    const toolCall = this.extractToolCall(data, toolSchema.function.name);

    if (toolCall) {
      this.aiSessionManager.updateSession(sessionId, "openai-responses", {
        conversationId,
      });

      const validation = UserProfileValidator.validate(toolCall);
      if (!validation.valid) {
        return {
          result: {
            success: false,
            error: validation.errors.join(", "),
            iterations,
          },
          conversationId,
          retryPrompt: "",
        };
      }

      return {
        result: {
          success: true,
          data: validation.data,
          iterations,
        },
        conversationId,
        retryPrompt: "",
      };
    }

    return {
      result: null,
      conversationId,
      retryPrompt: this.buildRetryPrompt(data),
    };
  }

  async executeToolCall(
    systemPrompt: string,
    userPrompt: string,
    toolSchema: ChatCompletionTool,
    sessionId: string
  ): Promise<ToolCallResult> {
    let session = this.aiSessionManager.getSession(sessionId, "openai-responses");

    if (!session) {
      session = this.aiSessionManager.createSession({
        provider: "openai-responses",
        sessionId,
      });
    }

    let conversationId = session.conversationId;
    let currentPrompt = userPrompt;
    let iterations = 0;
    const maxIterations = this.config.maxIterations ?? 5;
    const iterationTimeout = this.config.iterationTimeout ?? 30000;

    while (iterations < maxIterations) {
      iterations++;

      const tool = ToolSchemaConverter.toResponsesAPI(toolSchema);
      const requestBody = this._buildResponsesRequestBody(
        currentPrompt,
        conversationId,
        systemPrompt,
        tool
      );

      const fetchResult = await this.fetchWithTimeout(
        `${this.config.apiUrl}/responses`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
        },
        iterationTimeout,
        iterations
      );
      if ("error" in fetchResult) return fetchResult.error;
      const response = fetchResult.response;

      if (!response.ok) {
        return this.apiErrorResponse(response, iterations, "OpenAI Responses");
      }

      const data = (await response.json()) as ResponsesAPIOutput;
      const {
        result,
        conversationId: nextConversationId,
        retryPrompt,
      } = this._handleResponsesResponse(
        data,
        session,
        sessionId,
        toolSchema,
        iterations,
        userPrompt
      );

      if (result) return result;
      conversationId = nextConversationId;
      currentPrompt = retryPrompt;
    }

    return {
      success: false,
      error: `Max iterations (${this.config.maxIterations}) reached without tool call`,
      iterations,
    };
  }

  private extractToolCall(data: ResponsesAPIOutput, expectedToolName: string): any {
    if (!data.output || !Array.isArray(data.output)) {
      return null;
    }

    for (const item of data.output) {
      if (item.type === "function_call" && item.name === expectedToolName) {
        if (item.arguments) {
          try {
            const parsed = JSON.parse(item.arguments);
            return parsed;
          } catch (error) {
            log("Failed to parse function call arguments", {
              error: String(error),
              toolName: item.name,
              arguments: item.arguments,
            });
            return null;
          }
        } else {
          log("Function call found but no arguments", {
            toolName: item.name,
            callId: item.call_id,
          });
        }
      }
    }

    return null;
  }

  private buildRetryPrompt(data: ResponsesAPIOutput): string {
    let assistantResponse = "";

    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === "message" && item.content) {
          assistantResponse =
            typeof item.content === "string" ? item.content : JSON.stringify(item.content);
          break;
        }
      }
    }

    return `Previous response: ${assistantResponse}\n\nPlease use the save_memories tool to extract and save the memories from the conversation as instructed.`;
  }
}
