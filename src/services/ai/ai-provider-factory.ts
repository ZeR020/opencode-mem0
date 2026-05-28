import { BaseAIProvider, type ProviderConfig } from "./providers/base-provider.js";
import { OpenAIChatCompletionProvider } from "./providers/openai-chat-completion.js";
import { OpenAIResponsesProvider } from "./providers/openai-responses.js";
import { AnthropicMessagesProvider } from "./providers/anthropic-messages.js";
import { GoogleGeminiProvider } from "./providers/google-gemini.js";
import { getAISessionManager, type AISessionManager } from "./session/ai-session-manager.js";
import type { AIProviderType } from "./session/session-types.js";

type ProviderCtor = new (
  config: ProviderConfig,
  sessionManager: AISessionManager
) => BaseAIProvider;

const PROVIDERS: Record<AIProviderType, ProviderCtor> = {
  "openai-chat": OpenAIChatCompletionProvider,
  "openai-responses": OpenAIResponsesProvider,
  anthropic: AnthropicMessagesProvider,
  "google-gemini": GoogleGeminiProvider,
};

export class AIProviderFactory {
  private static cleanupTimer: NodeJS.Timeout | null = null;
  private static sessionManager: AISessionManager | null = null;

  private static getSessionManager(): AISessionManager {
    return (this.sessionManager ??= getAISessionManager());
  }

  static startCleanupSchedule(intervalMs: number = 1000 * 60 * 60) {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = setInterval(() => this.cleanupExpiredSessions(), intervalMs);
  }

  static stopCleanupSchedule() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  static createProvider(providerType: AIProviderType, config: ProviderConfig): BaseAIProvider {
    const Ctor = PROVIDERS[providerType];
    if (!Ctor) throw new Error(`Unknown provider type: ${providerType}`);
    return new Ctor(config, this.getSessionManager());
  }

  static getSupportedProviders(): AIProviderType[] {
    return Object.keys(PROVIDERS) as AIProviderType[];
  }

  static cleanupExpiredSessions(): number {
    return getAISessionManager().cleanupExpiredSessions();
  }
}
