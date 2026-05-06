import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function migrateFile(filePath: string): void {
  let content = readFileSync(filePath, "utf-8");

  // Replace bun:test import with vitest
  if (content.includes('from "bun:test"')) {
    const hasMock = content.includes("mock(") || content.includes("mock.module(");
    const hasSpyOn = content.includes("spyOn(");

    if (hasMock || hasSpyOn) {
      // Replace mock and/or spyOn with vi in the import
      content = content.replace(/import\s*\{([^}]*)\}\s*from\s*"bun:test"/, (match, imports) => {
        let cleaned = imports
          .replace(/\bmock\b/g, "vi")
          .replace(/\bspyOn\b/g, "vi");
        // Remove duplicate vi if both mock and spyOn were present
        const viMatches = cleaned.match(/\bvi\b/g);
        if (viMatches && viMatches.length > 1) {
          cleaned = cleaned.replace(/,\s*vi\s*,/g, ",").replace(/vi\s*,\s*vi/g, "vi");
        }
        return `import {${cleaned}} from "vitest"`;
      });
    } else {
      content = content.replace(/from "bun:test"/g, 'from "vitest"');
    }
  }

  // Replace mock() with vi.fn() (but not mock.module or already converted vi.mock)
  content = content.replace(/\bmock\(/g, "vi.fn(");

  // Replace mock.module( with vi.mock(
  content = content.replace(/\bmock\.module\(/g, "vi.mock(");

  // Replace spyOn( with vi.spyOn(
  content = content.replace(/\bspyOn\(/g, "vi.spyOn(");

  // Replace Bun.spawnSync with spawnSync from node:child_process
  if (content.includes("Bun.spawnSync")) {
    content = content.replace(/Bun\.spawnSync\s*\(\s*\{/g, "spawnSync(");
    // Also need to add import - will handle manually for specific files
  }

  writeFileSync(filePath, content);
  console.log(`Migrated: ${filePath}`);
}

function migrateDirectory(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      migrateDirectory(path);
    } else if (path.endsWith(".test.ts")) {
      migrateFile(path);
    }
  }
}

migrateDirectory("tests");
