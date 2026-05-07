/**
 * Shared utility functions for safe data transformations.
 * Centralized to eliminate duplication across client.ts and api-handlers.ts.
 */

export function safeToISOString(timestamp: unknown): string {
  try {
    if (timestamp === null || timestamp === undefined) {
      return new Date().toISOString();
    }
    const numValue = Number(timestamp);

    if (isNaN(numValue) || numValue < 0) {
      return new Date().toISOString();
    }

    return new Date(numValue).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export function safeJSONParse(jsonString: unknown): unknown {
  if (!jsonString || typeof jsonString !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(jsonString);
  } catch {
    return undefined;
  }
}
