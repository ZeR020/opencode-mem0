/**
 * Shared utility functions for safe data transformations.
 * Centralized to eliminate duplication across client.ts and api-handlers.ts.
 */

export function safeToISOString(timestamp: unknown): string {
  if (timestamp === null || timestamp === undefined) {
    return new Date().toISOString();
  }

  const numValue = Number(timestamp);

  if (Number.isFinite(numValue)) {
    return new Date(numValue).toISOString();
  }

  if (typeof timestamp === "string") {
    const parsedDate = new Date(timestamp);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }

  return new Date().toISOString();
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
