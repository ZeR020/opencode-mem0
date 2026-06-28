# src/services/ai/providers/

## Purpose

AI provider implementations. Each adapts a vendor API (or OpenCode's host provider) to the common `BaseAIProvider` contract so auto-capture and conflict detection can call any provider uniformly.

## Ownership

- `base-provider.ts` — `BaseAIProvider` abstract class and the shared contracts: `ProviderConfig`, `ToolCallResult`, `applySafeExtraParams()`. The `UNSAFE_KEYS` set blocks prototype-pollution / request-clobbering keys (`model`, `messages`, `tools`, `__proto__`, etc.) from `extraParams` merges
- `openai-chat-completion.ts` — `OpenAIChatCompletionProvider`: any OpenAI-compatible Chat Completions API (the `openai-chat` type, default `memoryProvider`)
- `openai-responses.ts` — `OpenAIResponsesProvider`: OpenAI Responses API (`openai-responses` type)
- `anthropic-messages.ts` — `AnthropicMessagesProvider`: Anthropic Messages API (`anthropic` type)
- `google-gemini.ts` — `GoogleGeminiProvider`: Google Gemini API (`google-gemini` type)

## Local Contracts

- Every provider extends `BaseAIProvider` and implements `executeToolCall(systemPrompt, userPrompt, toolSchema, sessionId)`, `getProviderName()`
- Providers are registered in `ai-provider-factory.ts`'s `PROVIDERS` map and keyed by an `AIProviderType` member in `src/types/index.ts`
- All `extraParams` merges go through `applySafeExtraParams()` — never spread `memoryExtraParams` directly into a request body
- Providers receive a `ProviderConfig` (built by `provider-config.ts`) and an `AISessionManager`; they do not read `CONFIG` directly
- Vendor-specific request/response shaping stays inside the provider file; the factory and call sites see only `ToolCallResult`

## Work Guidance

- Adding a provider: create `<vendor>.ts` extending `BaseAIProvider`; add the key to `AIProviderType`; register in the `PROVIDERS` map; add `tests/<vendor>.test.ts` mocking the vendor HTTP surface
- Keep vendor SDK imports lazy/optional where the SDK is heavy — the plugin must load even when a provider's SDK is unused
- Error handling must return a `ToolCallResult` with `success: false` and a message rather than throwing out of `executeToolCall`, so auto-capture can degrade gracefully

## Verification

- `tests/openai-chat-completion-provider.test.ts`, `tests/openai-responses.test.ts`, `tests/anthropic-messages.test.ts`, `tests/anthropic-provider.test.ts`, `tests/google-gemini.test.ts`
- `tests/ai-provider-config.test.ts` covers `ProviderConfig` construction

## Child DOX Index

No child AGENTS.md files. This is a leaf boundary.
