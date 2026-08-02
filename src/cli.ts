#!/usr/bin/env node
// opencode-mem0 CLI. `init` activates the plugin on this machine by creating
// the global config + data dir that isConfigured() checks for. Idempotent:
// existing files are never touched. Paths resolve at call time so $HOME
// overrides work (tests, containers).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const CONFIG_TEMPLATE = `{
  // opencode-mem0 configuration — docs: https://github.com/ZeR020/opencode-mem0
  // Uncomment and edit what you need; defaults apply for everything else.
  // "logLevel": "info",
  // "opencodeProvider": "anthropic",
  // "opencodeModel": "claude-sonnet-4",
  // "webServerEnabled": true
}
`;

export const runInit = (): void => {
  const configDir = join(homedir(), ".config", "opencode");
  const configFile = join(configDir, "opencode-mem0.jsonc");
  const altConfigFile = join(configDir, "opencode-mem0.json");
  const dataDir = join(homedir(), ".opencode-mem0", "data");
  let changed = false;

  const existing = [configFile, altConfigFile].find(existsSync);
  if (existing) {
    print(`config: already exists, leaving untouched (${existing})`);
  } else {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configFile, CONFIG_TEMPLATE, { mode: 0o600 });
    print(`config: created ${configFile}`);
    changed = true;
  }

  if (existsSync(dataDir)) {
    print(`data:   already exists (${dataDir})`);
  } else {
    mkdirSync(dataDir, { recursive: true });
    print(`data:   created ${dataDir}`);
    changed = true;
  }

  print(
    changed
      ? "\nopencode-mem0 activated. Restart opencode to load it."
      : "\nopencode-mem0 is already activated."
  );
};

const main = (): void => {
  const cmd = process.argv[2];
  if (cmd === "init") {
    runInit();
    return;
  }
  print("usage: opencode-mem0 init");
  if (cmd) process.exitCode = 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
