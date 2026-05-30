import type { PluginModule } from "@opencode-ai/plugin";
import pkg from "../package.json";

const { OpenCodeMemPlugin } = await (async () => {
  try {
    return await import("./index.js");
  } catch (e) {
    console.error("Failed to load OpenCodeMemPlugin:", e); // skipcq JS-0002
    throw e;
  }
})();

export const id = pkg.name;
export { OpenCodeMemPlugin };
export default { id, server: OpenCodeMemPlugin } satisfies PluginModule;
