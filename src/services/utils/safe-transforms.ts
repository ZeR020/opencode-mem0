/**
 * Shared utility functions for safe data transformations.
 * Centralized to eliminate duplication across client.ts and api-handlers.ts.
 */

export function safeToISOString(timestamp: unknown): string {
  if (timestamp === null || timestamp === undefined) {
    return new Date().toISOString();
  }

  const numValue = Number(timestamp);

  if (!Number.isFinite(numValue)) {
    if (typeof timestamp === "string") {
      const parsedDate = new Date(timestamp);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate.toISOString();
      }
    }
    return new Date().toISOString();
  }

  const date = new Date(numValue);
  if (isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
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
