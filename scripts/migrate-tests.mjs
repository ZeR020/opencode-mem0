import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function migrateFile(filePath) {
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
  content = content.replace(/(?<!\bvi\.)\bmock\(/g, "vi.fn(");

  // Replace mock.module( with vi.mock(
  content = content.replace(/\bmock\.module\(/g, "vi.mock(");

  // Replace spyOn( with vi.spyOn(
  content = content.replace(/\bspyOn\(/g, "vi.spyOn(");

  // Flag Bun.spawnSync usage for manual migration
  if (content.includes("Bun.spawnSync")) {
    const matches = content.match(/Bun\.spawnSync\s*\(/g);
    if (matches) {
      content = `// MANUAL_MIGRATION_REQUIRED: Bun.spawnSync usage detected (${matches.length} occurrence(s)).\n// Convert to spawnSync(command, args, options) from "node:child_process" and add appropriate import.\n${content}`;
    }
  }

  writeFileSync(filePath, content);
  console.log(`Migrated: ${filePath}`);
}

function migrateDirectory(dir) {
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
// AUDIT_MARKER
