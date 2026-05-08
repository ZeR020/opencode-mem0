import { BaseAIProvider, type ProviderConfig } from "./providers/base-provider.js";
import { OpenAIChatCompletionProvider } from "./providers/openai-chat-completion.js";
import { OpenAIResponsesProvider } from "./providers/openai-responses.js";
import { AnthropicMessagesProvider } from "./providers/anthropic-messages.js";
import { GoogleGeminiProvider } from "./providers/google-gemini.js";
import { getAISessionManager } from "./session/ai-session-manager.js";
import type { AIProviderType } from "./session/session-types.js";

export class AIProviderFactory {
  private static cleanupTimer: NodeJS.Timeout | null = null;
  private static sessionManager: ReturnType<typeof getAISessionManager> | null = null;

  private static getSessionManager() {
    if (!this.sessionManager) {
      this.sessionManager = getAISessionManager();
    }
    return this.sessionManager;
  }

  static startCleanupSchedule(intervalMs: number = 1000 * 60 * 60) {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, intervalMs);
  }

  static stopCleanupSchedule() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  static createProvider(providerType: AIProviderType, config: ProviderConfig): BaseAIProvider {
    const sessionManager = this.getSessionManager();
    switch (providerType) {
      case "openai-chat":
        return new OpenAIChatCompletionProvider(config, sessionManager);

      case "openai-responses":
        return new OpenAIResponsesProvider(config, sessionManager);

      case "anthropic":
        return new AnthropicMessagesProvider(config, sessionManager);

      case "google-gemini":
        return new GoogleGeminiProvider(config, sessionManager);

      default:
        throw new Error(`Unknown provider type: ${providerType}`);
    }
  }

  static getSupportedProviders(): AIProviderType[] {
    return ["openai-chat", "openai-responses", "anthropic", "google-gemini"];
  }

  static cleanupExpiredSessions(): number {
    return getAISessionManager().cleanupExpiredSessions();
  }
}
// audit: src/services/ai/ai-provider-factory.ts
