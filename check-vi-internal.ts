import { vi } from "vitest";

console.log("vi keys:", Object.getOwnPropertyNames(vi));
for (const key of Object.getOwnPropertyNames(vi)) {
  try {
    const val = (vi as any)[key];
    if (typeof val !== "function") {
      console.log(`  vi.${key}:`, typeof val, val);
    }
  } catch {}
}
