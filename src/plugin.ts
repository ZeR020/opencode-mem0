import type { PluginModule } from "@opencode-ai/plugin";
import pkg from "../package.json" with { type: "json" };
import { OpenCodeMemPlugin } from "./index.js";

export const id = pkg.name;
export { OpenCodeMemPlugin };
export default { id, server: OpenCodeMemPlugin } satisfies PluginModule;
