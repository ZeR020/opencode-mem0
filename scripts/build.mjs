// skipcq: JS-0833 — Valid ESM syntax, DeepSource false positive for .mjs files
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

function main() {
  // Run TypeScript compiler
  // Resolve the actual TypeScript JS entrypoint, not the platform-specific shim
  const require = createRequire(import.meta.url);
  // TS 7.0 locked down its `exports` map and no longer exposes `./bin/tsc`
  // as an importable subpath. Resolve the package root via the one subpath it
  // still exports (`./package.json`), then locate tsc relative to it.
  const pkgPath = require.resolve("typescript/package.json");
  const tscPath = join(dirname(pkgPath), "bin", "tsc");
  if (!existsSync(tscPath)) {
    console.error("Error: tsc not found. Run npm install or bun install first.");
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [tscPath], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  // Copy web assets to dist/web
  const srcWebDir = "./src/web";
  const distWebDir = "./dist/web";

  if (!existsSync(srcWebDir)) {
    console.warn("Warning: src/web directory not found, skipping asset copy.");
    return;
  }

  // Clean first — stale assets from older builds (e.g. i18n.js from the pre-SPA
  // dashboard) otherwise persist in dist/ and get published to npm.
  rmSync(distWebDir, { recursive: true, force: true });
  mkdirSync(distWebDir, { recursive: true });

  for (const entry of readdirSync(srcWebDir)) {
    const srcPath = join(srcWebDir, entry);
    const destPath = join(distWebDir, entry);
    cpSync(srcPath, destPath, { recursive: true, force: true });
  }

  console.log("Build complete.");
}

main();
