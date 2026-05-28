export function safeToISOString(timestamp: unknown): string {
  if (timestamp === null || timestamp === undefined) return new Date().toISOString();

  const numValue = Number(timestamp);
  if (Number.isFinite(numValue)) return new Date(numValue).toISOString();

  if (typeof timestamp === "string") {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return new Date().toISOString();
}

export function safeJSONParse(jsonString: unknown): unknown {
  if (typeof jsonString !== "string") return undefined;
  try {
    return JSON.parse(jsonString);
  } catch {
    return undefined;
  }
}
