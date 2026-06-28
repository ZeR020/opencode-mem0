# src/services/ai/

## Purpose

AI provider subsystem used by auto-capture and conflict detection to extract technical knowledge and resolve contradictions via LLMs. Supports OpenAI-compatible chat and responses APIs, Anthropic, and Google Gemini, plus a bridge to OpenCode's own connected providers.

## Ownership

- `ai-provider-factory.ts` — `AIProviderFactory`. Static factory with a `PROVIDERS` registry mapping `AIProviderType` → provider constructor. `createProvider()` is the only seam for constructing providers
- `provider-config.ts` — `buildMemoryProviderConfig()`: assembles a `ProviderConfig` from the runtime config fields (`memoryModel`, `memoryApiUrl`, `memoryApiKey`, `memoryTemperature`, `memoryExtraParams`) plus iteration/timeout overrides. Throws if the external API is not configured
- `opencode-provider.ts` — Bridge to OpenCode's connected AI providers (`opencodeProvider`/`opencodeModel` config). Reuses the host's main model instead of a separate API endpoint
- `session/session-types.ts` — `AIProviderType` (re-exported), session types
- `session/ai-session-manager.ts` — `AISessionManager` (via `getAISessionManager()`): AI provider session management with expiration. Retention via `aiSessionRetentionDays`. Expired-session cleanup is scheduled inline by `src/index.ts` via `setInterval`
- `tools/tool-schema.ts` — Structured output tool definitions handed to providers
- `validators/user-profile-validator.ts` — Output validation schemas for profile extraction
- `providers/` — Provider implementations. See `src/services/ai/providers/AGENTS.md`

## Local Contracts

- New providers extend `BaseAIProvider` (`providers/base-provider.ts`), implement `executeToolCall`/`getProviderName`, register in the `PROVIDERS` map, and add their key to `AIProviderType` (`src/types/index.ts` and `session/session-types.ts`)
- `ProviderConfig` (`providers/base-provider.ts`) is the shared config shape; `buildMemoryProviderConfig()` is the constructor for it
- `applySafeExtraParams()` guards against prototype-pollution and request-clobbering keys (`UNSAFE_KEYS` set) — never bypass it when merging `memoryExtraParams` into a request body
- Provider construction goes through `AIProviderFactory.createProvider()` only; never `new` a provider directly at call sites
- Without a configured provider, auto-capture and conflict detection silently skip with a log warning — preserve that graceful degradation

## Work Guidance

- Adding a provider: see `src/services/ai/providers/AGENTS.md`
- Session cleanup is scheduled inline by `src/index.ts` (`setInterval` → `getAISessionManager().cleanupExpiredSessions()`); the factory no longer owns the cleanup schedule
- The OpenCode provider bridge (`opencode-provider.ts`) is the zero-config path; the external providers are the explicit-config path. Keep both working

## Verification

- `tests/ai-provider-config.test.ts`, `tests/ai-session-manager.test.ts`, `tests/opencode-provider.test.ts`, `tests/openai-chat-completion-provider.test.ts`, `tests/openai-responses.test.ts`, `tests/anthropic-messages.test.ts`, `tests/anthropic-provider.test.ts`, `tests/google-gemini.test.ts`

## Child DOX Index

| Path                                  | Scope                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `src/services/ai/providers/AGENTS.md` | Provider implementations: base, OpenAI chat/responses, Anthropic, Google Gemini |
