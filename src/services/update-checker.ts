import pkg from "../../package.json" with { type: "json" };
import { log } from "./logger.js";

const REGISTRY_URL = `https://registry.npmjs.org/${pkg.name}/latest`;
const TIMEOUT_MS = 5000;

/** Returns positive if b is newer than a, 0 if equal, negative if b is older. */
export function compareVersions(a: string, b: string): number {
  const pa = (a.split("-")[0] ?? a).split(".").map(Number);
  const pb = (b.split("-")[0] ?? b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface UpdateInfo {
  current: string;
  latest: string;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> }
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** Checks npm for a newer release. Returns null if up-to-date or on any failure. */
export async function checkForUpdate(fetchFn: FetchLike = fetch): Promise<UpdateInfo | null> {
  try {
    const res = await fetchFn(REGISTRY_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (!latest || compareVersions(pkg.version, latest) <= 0) return null;
    return { current: pkg.version, latest };
  } catch (error) {
    log("Update check failed (offline or registry unreachable)", { error: String(error) });
    return null;
  }
}
