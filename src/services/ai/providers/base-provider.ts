import { log } from "../../logger.js";
export interface ToolCallResult {
  success: boolean;
  data?: any;
  error?: string;
  iterations?: number;
}

export interface ProviderConfig {
  model: string;
  apiUrl: string;
  apiKey?: string;
  maxIterations?: number;
  iterationTimeout?: number;
  maxTokens?: number;
  memoryTemperature?: number | false;
  extraParams?: Record<string, unknown>;
}

const UNSAFE_KEYS = new Set([
  "model",
  "messages",
  "tools",
  "tool_choice",
  "temperature",
  "input",
  "instructions",
  "conversation",
  "__proto__",
  "constructor",
  "prototype",
]);

export function applySafeExtraParams(
  requestBody: Record<string, any>,
  extraParams: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(extraParams)) {
    if (!UNSAFE_KEYS.has(key)) requestBody[key] = value;
  }
}

export abstract class BaseAIProvider {
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  abstract executeToolCall(
    systemPrompt: string,
    userPrompt: string,
    toolSchema: any,
    sessionId: string
  ): Promise<ToolCallResult>;

  abstract getProviderName(): string;

  /**
   * Fetch with AbortController-based timeout. Captures the shared
   * controller/timeout/clearTimeout/AbortError pattern used by all providers.
   * @returns the Response on success, or a ToolCallResult error on timeout/failure.
   */
  protected async fetchWithTimeout(
    url: string,
    options: RequestInit,
    iterationTimeout: number,
    iterations: number
  ): Promise<{ response: Response } | { error: ToolCallResult }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), iterationTimeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return { response };
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === "AbortError") {
        return {
          error: {
            success: false,
            error: `API request timeout (${iterationTimeout}ms)`,
            iterations,
          },
        };
      }
      return {
        error: {
          success: false,
          error: String(error),
          iterations,
        },
      };
    }
  }

  /**
   * Handle a non-OK HTTP response. Logs the error and returns a failure ToolCallResult.
   */
  protected async apiErrorResponse(
    response: Response,
    iterations: number,
    providerLabel: string
  ): Promise<ToolCallResult> {
    const errorText = await response.text().catch(() => response.statusText);
    log(`${providerLabel} API error`, {
      provider: this.getProviderName(),
      model: this.config.model,
      status: response.status,
      error: errorText,
      iteration: iterations,
    });
    return {
      success: false,
      error: `API error: ${response.status} - ${errorText}`,
      iterations,
    };
  }
}

/**
 * Extracts and parses the first complete JSON object found in the given text.
 * Handles brace depth and ignores brackets inside string literals (with quotes).
 * If no valid JSON object is found, returns null.
 *
 * @param text The text to scan for JSON.
 * @returns The parsed JSON object, or null if not found or invalid.
 */
export function extractFirstJSON(text: string): unknown | null {
  if (typeof text !== "string") {
    return null;
  }

  let searchIdx = 0;
  while (true) {
    const startIdx = text.indexOf("{", searchIdx);
    if (startIdx === -1) {
      return null;
    }

    let braceCount = 0;
    let inString = false;
    let escape = false;
    let stringChar: string | null = null;
    let foundEnd = false;
    let endIdx = -1;

    for (let i = startIdx; i < text.length; i++) {
      const char = text[i]!;

      if (inString) {
        if (escape) {
          escape = false;
        } else if (char === "\\") {
          escape = true;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
      } else {
        if (char === '"' || char === "'" || char === "`") {
          inString = true;
          stringChar = char;
        } else if (char === "{") {
          braceCount++;
        } else if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            foundEnd = true;
            endIdx = i;
            break;
          }
        }
      }
    }

    if (foundEnd) {
      const potentialJSON = text.slice(startIdx, endIdx + 1);
      try {
        return JSON.parse(potentialJSON);
      } catch {
        searchIdx = startIdx + 1;
      }
    } else {
      searchIdx = startIdx + 1;
    }
  }
}
