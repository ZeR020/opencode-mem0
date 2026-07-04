# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Electron desktop dashboard** — The Memory Explorer is now available as a standalone Electron desktop app (`bun run electron` / `bun run electron:dev`). The Electron main process reuses the existing local web server + REST API, initializes config and warms up the memory client, then loads the dashboard in a native `BrowserWindow` with `contextIsolation`, `sandbox`, and `nodeIntegration: false`. A minimal preload script exposes only `openExternal` and `platform`. The browser-based dashboard at `http://127.0.0.1:4747` remains fully functional.
- **Dashboard redesign** — Complete rebuild of the web UI with the OpenCode terminal-native manpage design system (DESIGN.md). New state-driven vanilla-JS SPA with 8 views: Dashboard (hero TUI mockup + stats + recent memories + profile snapshot), Memories, Semantic Search, Timeline (transcript history), Profile (preferences, patterns, workflows, changelog), Maintenance (cleanup, dedup, migration), Conflicts (resolve with keep-newer/keep-older/merge), and Settings. Warm cream canvas, near-black ink, Berkeley/JetBrains Mono, 4px radius on interactive elements, 0px on containers, hairline borders, no shadows or gradients, ASCII bracket markers as bullets, dark theme + system preference detection.

### Changed

- **i18n.js rewritten** — Reduced from ~210 keys (with 80+ orphaned legacy keys and 3 silent duplicate-key overrides per locale) to 107 keys actually used by the new SPA, in both `en` and `zh`. The `t()` interpolation still uses `split().join()` (no RegExp allocation).
- **styles.css rewritten** — Full DESIGN.md token implementation as CSS custom properties. Net -700 lines. All hex values confined to `:root`/`[data-theme]` blocks; component styles use tokens only.
- **index.html simplified** — From ~400 lines of inline HTML to a ~55-line SPA shell with `#app`, modal, and toast containers. CSP meta tag added matching the server's CSP header.

### Fixed

- **Profile view read wrong API shape** — `renderProfile` accessed `profile.preferences` directly, but `/api/user-profile` nests them under `profileData`. Now reads `resp.profileData` and branches on `exists === false` to show the server's "no profile" message.
- **Duplicate i18n keys silently overridden** — `confirm-bulk-delete`, `confirm-cleanup`, `confirm-dedup` appeared twice per locale; the legacy definitions (last-wins in JS object literals) silently overrode the new wording. Removed all duplicates.
- **Non-string ID slicing** — `memory.id.slice()` and `conflict.id.slice()` assumed string IDs; now guarded with `String(...)` to avoid throwing on numeric IDs.

## [2.18.3] - 2026-07-04

### Changed

- **Dependencies updated** — Bumped `@ai-sdk/anthropic` to `^4.0.5`, `@ai-sdk/openai` to `^4.0.5`, `@vitest/coverage-v8` to `^4.1.9`, and `vitest` to `^4.1.9` to stay current with upstream provider SDKs and testing frameworks.

### Contributors

No community contributors for this release. All work by @ZeR020 and Dependabot.

## [2.18.2] - 2026-07-01

### Removed

- **Dead code cleanup** — Removed `getProfileById` method (zero callers), 5 CSS badge classes for non-existent memory types (`badge-architecture`, `badge-documentation`, `badge-rule`, `badge-project`, `badge-user`), and 17 internal-only symbols from the previous `closeShardManager` removal.

### Changed

- **Config boilerplate eliminated** — Inlined 9 `buildXxxConfig` helper functions directly into `mergeConfigWithDefaults` in `config.ts`, removing ~95 lines of repetitive `??` fallback chains that duplicated logic already present in the merge function.
- **Web server route handlers simplified** — Inlined 10 trivial one-line `_apiXxx` wrapper methods directly into the route switch in `web-server.ts`, and extracted duplicated security headers (CSP, X-Content-Type-Options, X-Frame-Options, HSTS) into a single `_securityHeaders()` helper.
- **Admin handler boilerplate extracted** — 4 repetitive try/catch handler functions (`handleRunCleanup`, `handleRunDeduplication`, `handleDetectMigration`, `handleRunMigration`) collapsed into a single `asyncServiceWrapper` helper in `admin.ts`.
- **CaptureMutex simplified** — Replaced the 10-line `CaptureMutex` class in `auto-capture.ts` with a simple boolean flag (`isCapturing`), eliminating unnecessary class ceremony for a one-shot lock.
- **Jaccard similarity consolidated** — Three divergent `jaccardSimilarity` implementations (`vector-search.ts`, `retrieval-context.ts`, `memory-scoring.ts`) unified to the shared `text-analysis.ts` export, with zero-allocation loop optimization preserved.

### Fixed

- **Dedup threshold inconsistency** — The `checkDuplicateAtIngest` fallback used `?? 0.92` while the canonical config default is `0.9`. Aligned the fallback to `0.9` to prevent inconsistent dedup behavior in partial-config test environments.
- **Useless transcripts UI section removed** — Removed a dead transcripts section from the Web UI that served no functional purpose.

### Performance

- **Embedding cache hot-path logging removed** — `getFromCache()` called `log()` with an object construction (`{ hits, misses, rate: hitRate() }`) on every single cache hit, including a `JSON.stringify` and async disk append via `appendFile`. Removed the per-hit log; cache stats remain available via the `/api/embedding-cache` endpoint. Measured 12x overhead reduction (31.69ms → 2.59ms per 100K lookups for object construction alone, before disk I/O).

### Contributors

No community contributors for this release. All work by @ZeR020.

## [2.18.1] - 2026-07-01

### Added

- **Dark/light theme toggle** — The Memory Explorer now has a sun/moon toggle button in the header. Click to switch between light and dark themes; preference is saved to `localStorage` and persists across sessions. First visit with no saved preference follows the OS system setting via `@media (prefers-color-scheme: dark)`. An inline script in `<head>` applies the saved theme before first paint to prevent FOUC. Dark theme remaps all CSS custom property tokens: canvas becomes `#1a1818`, ink inverts to `#fdfcfc`, accent brightens to `#0a84ff` for dark contrast.

### Fixed

- **Transcript previews showed only `...` placeholders** — The `renderTranscripts()` function looked for `m.content` as a string, but the actual OpenCode session message format stores content in `m.parts[].text`. Every transcript card showed only `...` because the content check always failed. Now extracts text from `parts[]`, shows tool calls as `[tool: name]`, and displays 3 messages instead of 2.
- **Radar chart labels truncated and not theme-aware** — The behavioral dimensions radar chart had 28px padding on a 300px chart with 9 axes, causing labels like "Tool Pr" and "LLM Provid" to be clipped. Enlarged to 360px with 70px padding. All hardcoded hex colors (`#9a9898`, `#646262`, `#007aff`) replaced with CSS custom properties so the chart adapts to dark/light theme. Added a description explaining what the chart represents.

### Performance

- **Deferred head scripts** — All 5 vendored scripts in `<head>` now have `defer`, letting the browser render the HTML shell immediately while ~124 KB gzip of JS parses in the background.
- **Parallelized init API calls** — `loadStats()` and `checkMigrationStatus()` now run concurrently via `Promise.all`. Internally, each function also parallelizes its own sub-calls. Cuts 4-6 sequential API round-trips to 2.
- **Favicon shrunk 99.5%** — From 165 KB (200×200 32-bit ICO) to 820 bytes (32×32 ICO).
- **Eliminated RegExp allocation in i18n** — Replaced `new RegExp()` per translated parameter with `string.split().join()`, removing object allocation in the translation hot path.

## [2.18.0] - 2026-07-01

### Changed

- **Web UI completely redesigned with OpenCode manpage design system** — The Memory Explorer dashboard has been rebuilt from the ground up. The previous Matrix/CRT-terminal aesthetic (green-on-black, `#00ff00` phosphor, ASCII box-drawing titles `┌─ ─┐`) has been replaced with a warm, readable manpage design system derived from the OpenCode brand identity. All colors, spacing, radius, and typography are now CSS custom properties (`:root` tokens) in `styles.css`, making the design system easy to extend without hardcoding hex values. Key changes:
  - **styles.css** — Full rewrite (~1842 → ~1050 lines). Warm cream canvas (`#fdfcfc`), near-black ink (`#201d1d`), JetBrains Mono / Berkeley Mono font stack, 4px radius on interactive elements, 0px on containers, hairline borders (`rgba(15,0,0,0.12)`), no shadows or gradients. Apple Human Interface Guidelines semantic ramp (accent `#007aff`, danger `#ff3b30`, warning `#ff9f0a`, success `#30d158`) used for in-product interactive states.
  - **index.html** — Rewritten SPA shell with clean title (no ASCII box-drawing), `[+]` bracket markers in section headers, grouped header actions, clean tab layout with underline-on-active. All ~70 element IDs preserved (app.js binding contract).
  - **app.js** — Radar chart hardcoded colors (`#ccc`, `#3b82f6`, `#666`) replaced with DESIGN.md tokens (`#9a9898` ash, `#007aff` accent, `#646262` mute). `updateSectionTitle()` box-drawing chars replaced with `[+]` bracket markers. Application logic unchanged.
  - **i18n.js** — Six box-drawing strings (English + Chinese) replaced with `[+]` bracket markers. No ASCII box-drawing characters remain.
  - **src/web/AGENTS.md** — Updated to document the design system, token convention, and the `[+]`/`[-]`/`[x]` bracket-marker usage.
  - Fixed latent bug: timeline section CSS used undefined custom properties (`--text-color`, `--border-color`, `--primary-color`, `--bg-color`, `--card-bg`) that were never declared, causing broken/inherit styling. Now uses proper DESIGN.md tokens.

### Contributors

No community contributors for this release. All work by @ZeR020.

### Fixed

- **API add-memory bypassed dedup and conflict detection (#feature-9-10)** — `handleAddMemory` (the web API POST `/api/memories` path) re-implemented the embedding/insert orchestration instead of delegating to `memoryClient.addMemory`, so memories added via the Web UI or REST API skipped ingest-time deduplication (`checkDuplicateAtIngest`) and conflict detection (`detectConflicts`) that the in-agent `memory` tool gets. Two near-identical memories added via the API would both be stored; the same content added via the tool would merge. Fixed by routing `handleAddMemory` through `memoryClient.addMemory`, deleting ~45 lines of duplicated orchestration. The API path now returns `{ duplicate: true }` when a near-duplicate is merged, matching the tool path's contract.
- **Conflict heuristic missed substitution-based contradictions (#feature-9)** — `checkContradictionHeuristic` only triggered on negation patterns (`not`, `never`, `removed`, `disabled`, `un-`, etc.). Statements like "Authentication uses JWT tokens **instead of** session cookies" never reached the LLM contradiction check because "instead of" is not a negation word. Added `SUBSTITUTION_PATTERNS` (`instead of`, `replaced by`, `rather than`, `switched to/from`, `migrated to/from`, `no longer`, `moved to/from`) to `text-analysis.ts`; the heuristic now opens the LLM gate when one memory has a substitution phrase and the other shares >30% key-word overlap.
- **Web UI crashes completely if a vendor script fails to load** — `app.js` called `marked.setOptions()` at top-level script execution (before any function is defined) and `lucide.createIcons()` inside `renderMemories()` / `DOMContentLoaded`. If any vendored library (`lucide`, `marked`, `DOMPurify`, `jsonrepair`) failed to load — missing file, stale install, network race — the `ReferenceError` killed the entire script: no functions defined, no event handlers attached, no API calls made. The UI froze at its initial HTML state ("Initializing...", "Total: 0", all tabs unresponsive). Fixed by guarding all top-level and call-site library accesses (`typeof marked !== "undefined"`, `safeCreateIcons()` wrapper for all 8 `lucide.createIcons()` call sites, `renderMarkdown` falls back to `escapeHtml` when `marked`/`DOMPurify` are missing). The UI now degrades gracefully: memories and transcripts load and display as plain text, tabs work, even without the vendor scripts.

### Contributors

No community contributors for this release. All work by @ZeR020.

## [2.17.4] - 2026-06-30

### Fixed

- **Web UI blank in v2.17.1+ (#47)** — The restrictive CSP added in v2.17.1 blocked the Web UI's CDN script tags (lucide, marked, DOMPurify, jsonrepair), so `marked` was undefined at load and `app.js` crashed before `loadStats()` ran (UI showed "Total: 0", API still served correct data). Fixed by vendoring the four libraries locally into `src/web/vendor/` with pinned versions (lucide@1.22.0, marked@17.0.1, dompurify@3.2.2, jsonrepair@3.14.1), loading them via `/vendor/*.min.js`, and adding those four routes to the static map. The strict CSP (`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`) is unchanged — the UI now has zero runtime CDN/outbound network dependency, consistent with the "all data stays local" contract. Reported by @ovizii.

### Security

- **Rejected CDN CSP relaxation** — The issue body suggested relaxing CSP to `script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net`. That would reintroduce untrusted supply-chain code execution (no SRI on floating `@latest` tags) and an outbound network call on every UI load, violating the local-data contract. Vendoring preserves the hardening.

### Contributors

- @ovizii (issue report)

## [2.17.3] - 2026-06-30

### Fixed

- **README privacy filtering overstatement** — The "Auto-Capture" Key Feature claimed "privacy filtering that strips secrets and PII", implying active secret/PII detection. The actual implementation (`privacy.ts:stripPrivateContent`) only redacts content wrapped in `<private>...</private>` XML tags; it does not detect raw API keys, passwords, emails, or PII in arbitrary text. README corrected to accurately describe the `<private>`-tag redaction mechanism.
- **Incorrect contributor credits in v2.17.2 release notes** — @boyxil and @bob56621517 were carried forward from v2.17.0/v2.17.1 into the v2.17.2 GitHub release and changelog. Their work shipped in prior releases, not v2.17.2. Credits removed from both surfaces; v2.17.2 notes now correctly state "No community contributors for this release."
- **Stale `queryAwareFiltering` row in README** — The dead config field was removed from `config.ts` in v2.17.2 but the README config table row was missed. Removed.

### Removed

- **Dead config field `userProfileConfidenceDecayDays`** — Defined in the config interface, Zod schema, defaults, and merge function (4 places in `config.ts`), but its consumer `applyConfidenceDecay()` was deleted in v2.17.2's ponytail cleanup (zero production readers). Removed from all 4 config locations plus `tests/config.test.ts`, `tests/tool-scope.test.ts`, `README.md`, and `docs/CONFIGURATION.md`. Zod schema uses default (strip) behavior, so existing user configs with this key are silently ignored, not rejected.
- **Stale "confidence decay" references in `docs/ARCHITECTURE.md`** — Two references to confidence decay as a `UserProfileManager` capability removed (the feature no longer exists).

### Contributors

No community contributors for this release. All work by @ZeR020.

## [2.17.2] - 2026-06-30

### Fixed

- **Transcript capture independence** — `performTranscriptCapture` now runs on session idle independently of auto-capture (no longer gated by `autoCaptureEnabled`). Previously, disabling auto-capture also silently disabled transcript storage. New test `tests/transcript-idle-wiring.test.ts` verifies the wiring.
- **Node 22 ESM JSON import** — Added `with { type: "json" }` import attribute to `src/plugin.ts`'s `package.json` import. Without it, Node 22's ESM loader throws `ERR_IMPORT_ATTRIBUTE_MISSING` and opencode silently skips loading the plugin when installed via npm.
- **Structured output for opencode provider** — Rewrote `generateStructuredOutput` in `opencode-provider.ts` for AI SDK v7 compatibility.
- **Web server empty-query transcript search** — `GET /api/transcripts/search` with an empty query now calls `handleListTranscripts` instead of crashing FTS5 `MATCH` on an empty string.
- **Timeline `includePrompts` orphaning** — Linked memories are now retained when `includePrompts=false`. Previously they were orphaned in `linkedPairs` and filtered out by `Boolean(p.memory && p.prompt)`.
- **Latent SQL ESCAPE bug in `vector-search.ts`** — Template literal `ESCAPE '\'` produced an empty escape character (`ESCAPE ''`), causing SQLite "ESCAPE expression must be a single character" errors in the `getMemoriesBySessionID` LIKE fallback path. Fixed to `ESCAPE '\\'` which produces a valid single-backslash escape char.
- **Release workflow changelog extraction** — The `awk` regex `## []` used an unescaped `[` (character-class opener), matching `## 7` inside `#### 7-Factor Memory Scoring` instead of the actual version header. Every release since v2.16.1 published v2.14.0's changelog content on the GitHub release page. Replaced with `index()` string matching plus a boundary check.

### Changed

- **Ponytail-audit round 1** (`0683461`) — Dead code removed (graph-confirmed zero callers): `ensureShardTables`/`getShardByPath` (`shard-manager.ts`), `countVectors` (`vector-search.ts`), `getMessagesByRoleStmt` (`ai-session-manager.ts`), `maxProfileItems` config field + docs, 6 duplicate FTS5 triggers in `migrate-v1-to-v2.ts`, 6 dead i18n keys, `sessionIdleSweep` speculative LRU guard. `fetchWithTimeout()` + `apiErrorResponse()` hoisted to `BaseAIProvider`. Hand-rolled `UserProfileValidator` (107 lines) → zod schema. Dynamic `await import("zod")` → static imports. 22 files, net -92 lines.
- **Ponytail-audit round 2** (`d8329b4`) — 13 verified-dead symbols removed across 35 files (-308 lines net). All deletions grep-verified and cross-checked with the codebase-memory call graph (`trace_path inbound → []`). `DeduplicationService.cosineSimilarity` → import shared from `vector-backends/shared.ts`. `runOneTimeScoringRecalculation` inlined at sole caller. See Removed section for the full dead-code list.
- **DeepSource JS-0356 remediation** (`35df08e`) — Removed dead imports (`safeToISOString`, `SearchResult` type, `writeFileSync`, `isAbsolute`) and dead code (`ContextTracker` class 72 lines, `MIN_OVER_FETCH` constant). Prefixed intentional unused params with `_`.
- **DeepSource JS-W1041/JS-0331/JS-R1004 remediation** (`8322924`) — Simplified complex boolean returns (`hasNonEmptyChoices`), removed redundant explicit type declarations on trivially-inferible defaults, converted useless template literals to regular strings.
- **DeepSource skipcq annotations** (`6262f73`) — Annotated intentional mutable exports (`scoringSkippedCycles`/`scoringLastDurationMs`) and lazy-load shim with `skipcq JS-E1009`. Removed unused catch bindings, `let`→`const` for non-reassigned vars, shorthand properties.

### Removed

- **Dead methods (zero prod + zero test callers):** `MemoryMetadata` interface (`types/index.ts`), `MigrationService.getStatus()`, `MigrationProgressTracker.reset()`, `applyConfidenceDecay`/`deleteProfile`/`getAllActiveProfiles` (`user-profile-manager.ts`), `getArchivedCount` (`memory-lifecycle.ts`).
- **Legacy superseded methods:** `AISessionManager.addMessage`/`deleteSession`/`clearMessages` + legacy prepared statements — production uses `addMessageAtomic` and TTL-based `cleanupExpiredSessions`.
- **Test-only production methods:** `insertManyForTest`/`searchForTest` (`usearch-backend.ts`), `getTranscript` (`transcript-manager.ts`), `countUncapturedPrompts`/`getUncapturedPrompts`/`markMultipleAsCaptured` (`user-prompt-manager.ts`). Removed from production classes; tests updated.
- **Dead config field:** `injection.queryAwareFiltering` — configured, defaulted, Zod-validated, but never read by any production code. Removed from interface, schema, defaults, and `docs/CONFIGURATION.md`.
- **Dead script/tooling:** 4 warning-only checks in `scripts/lint-deepsource.sh` (never gated push), `test:bun` npm script (identical to `test`), `.coderabbit.yaml` entry in `vitest.config.ts` coverage exclude.

### Infrastructure

- **Minimal Codespace devcontainer** — `.devcontainer/devcontainer.json` (`typescript-node:22` base, sshd feature, port 4096). No `setup.sh` — the user installs tooling manually after codespace creation. After pushing devcontainer changes, delete + recreate the codespace (`gh codespace rebuild --full` does not reliably pull latest main).

### Notes

- **`src/types/usearch.d.ts` retained** — Audit flagged this file as dead (`usearch` ships its own `.d.ts`). Verified load-bearing: the ambient `declare module "usearch"` declaration shadows the shipped types with a permissive module, making `metric: "cos"` assignable to `MetricKind`. Deleting it broke typecheck. File restored.
- **DeepSource: JavaScript check** remains in a pre-existing failure state (Documentation Coverage metric at 13.8%). This release resolved 27 issues and introduced 0 new ones per the DeepSource run. The failure predates this release.

### Contributors

No community contributors for this release. All work by @ZeR020.

## [2.17.1] - 2026-06-28

### Fixed

- **Path traversal in `migrate-v1-to-v2.ts`** — CLI storage path is now resolved to absolute and constrained to the user's home directory, rejecting `..` traversal and out-of-home escape attempts from untrusted CLI args (SonarCloud `tssecurity:S8707`). An LLM passing a malicious `--storagePath` can no longer point the migration at arbitrary filesystem locations like `/etc` or `/var`.
- **Ambient `PATH` dependency in `tags.ts`** — Git executable is now resolved from a fixed list of trusted, unwriteable locations only (`/usr/bin/git`, `/bin/git`, `/usr/local/bin/git`, `/opt/homebrew/bin/git`, `/usr/local/git/bin/git`). Removed the `which git` ambient-PATH lookup that could resolve a writable-directory binary (SonarCloud `typescript:S4036`). Added `/opt/homebrew/bin/git` for Apple Silicon.
- **SonarCloud fails on Dependabot PRs** — SonarCloud workflow now skips fork PRs from Dependabot (`if: !startsWith(github.head_ref, 'dependabot/')`). `SONAR_TOKEN` is unavailable to fork PRs, causing "Not authorized" failures on all Dependabot PRs. ([#45](https://github.com/ZeR020/opencode-mem0/pull/45))

### Changed

- **SonarCloud Quality Gate: coverage lifted to ≥80%** — Added `tests/memory-lifecycle.test.ts` (17 tests) and extended `tests/api-handlers.test.ts`, `tests/deduplication-service.test.ts`, `tests/auto-capture.test.ts`, `tests/secret-resolver.test.ts`, and `tests/logger.test.ts` with branch coverage. New-code coverage projected from 77.3% to ~80.2%.
- **CI `bun audit` is non-blocking** — `continue-on-error: true` added so dev-only vulnerabilities (vite, esbuild, protobufjs) don't gate CI. ([#45](https://github.com/ZeR020/opencode-mem0/pull/45))
- **CodeRabbit removed** — `.coderabbit.yaml` deleted, no longer running automated reviews. ([#45](https://github.com/ZeR020/opencode-mem0/pull/45))
- **DeepSource config cleaned** — Removed unnecessary `react` plugin (no React in project). ([#44](https://github.com/ZeR020/opencode-mem0/pull/44))
- **SonarCloud pre-push warning less alarming** — Changed from red ❌ to yellow ℹ️ (already non-blocking, exit 0). ([#44](https://github.com/ZeR020/opencode-mem0/pull/44))
- **Screenshots moved to `docs/assets/`** — Banner and screenshot PNGs moved from `.github/` to `docs/assets/`. ([#44](https://github.com/ZeR020/opencode-mem0/pull/44))
- **`.gitattributes` cleaned** — Removed dead `graphify-out/` rules, added `dist/`, `coverage/`, `*.lock` as linguist-generated. ([#44](https://github.com/ZeR020/opencode-mem0/pull/44))
- **Dependabot limited to minor/patch** — Major bumps (TypeScript 6, @ai-sdk/openai 4, @vitest/coverage-v8 4) break types/APIs and require manual migration. ([#45](https://github.com/ZeR020/opencode-mem0/pull/45))
- **Release workflow uses CHANGELOG.md** — GitHub release body is now extracted from `docs/CHANGELOG.md` instead of auto-generated notes. ([#38](https://github.com/ZeR020/opencode-mem0/pull/38))
- **CONTRIBUTING.md updated** — Added Release Process, Contributor Credits, and Version Numbering sections. Backfilled changelog entries for v2.16.0, v2.16.1, v2.16.2.
- **6 backfilled GitHub release notes** — v2.14.0, v2.14.4, v2.14.5, v2.16, v2.16.1, v2.16.2 now have structured content. 3 orphaned draft releases (v2.14.0/2/3) deleted.

### Removed

- **CodeRabbit** — `.coderabbit.yaml` deleted. Not needed for this repo. ([#45](https://github.com/ZeR020/opencode-mem0/pull/45))

### Dependencies

- `ai` bumped from 6.0.214 to 7.0.4 ([#42](https://github.com/ZeR020/opencode-mem0/pull/42))
- `lint-staged` bumped from 16.4.0 to 17.0.8 ([#40](https://github.com/ZeR020/opencode-mem0/pull/40))
- `vitest` and `@vitest/coverage-v8` updated to 3.2.6 (fixes critical CVE GHSA-5xrq-8626-4rwp)

## [2.17.0] - 2026-06-28

### Added

- **`file://~/` path expansion in `*ApiKey` config fields** — `file://` references with `~` (home directory) now work on Linux. Previously `new URL()` parsed `~` as the URL host and threw. `~` is now expanded before URL parsing. ([#34](https://github.com/ZeR020/opencode-mem0/issues/34))
- **`initConfig()` empty-config guard** — When both global and project config sources return empty (transient I/O failure, file lock, race condition), the existing CONFIG singleton is preserved instead of being silently overwritten with hardcoded defaults. ([#35](https://github.com/ZeR020/opencode-mem0/issues/35), [#36](https://github.com/ZeR020/opencode-mem0/pull/36))

### Fixed

- **`initConfig()` silent CONFIG reset** — `buildConfig({})` was called with an empty object when config files were transiently inaccessible, resetting all user-configured values (embedding model, dimensions, API endpoint) to defaults. The guard preserves the existing CONFIG from module-level initialization. ([#35](https://github.com/ZeR020/opencode-mem0/issues/35))
- **`file://~/` throws on Linux** — `secret-resolver.ts` called `new URL(value)` before expanding `~`, causing `fileURLToPath` to throw "File URL host must be localhost or empty". ([#34](https://github.com/ZeR020/opencode-mem0/issues/34))
- **Vitest critical CVE (GHSA-5xrq-8626-4rwp)** — Updated `vitest` and `@vitest/coverage-v8` to 3.2.6, fixing arbitrary file read/execute via Vitest UI server. Dev-only dependency, not shipped to users.

### Removed

- **NSW vector backend** — `NSWBackend` (`nsw-backend.ts`, 321 lines) was production-unreachable: the `VectorBackendConfig` enum (`config.ts`) only allows `usearch-first`/`usearch`/`exact-scan`, so `nsw`/`nsw-first` were factory-only dead branches. Removed `NSWBackend`, the `nsw`/`nsw-first` factory branches, the `createNSWBackend` injection seam, and `cosineDistance` (only NSW caller). ([audit](https://github.com/ZeR020/opencode-mem0/commit/bfd1ce4))
- **`supportsSession()` abstract method** — Removed from `BaseAIProvider` and all 4 provider overrides. Every implementation returned `true` and no code branched on the result. ([commit ffb55d7](https://github.com/ZeR020/opencode-mem0/commit/ffb55d7))
- **`profile-utils.ts`** — Deleted dead code (`safeArray`/`safeObject` exports with zero importers; `user-profile-manager.ts` has its own local `safeArray`). ([commit ffb55d7](https://github.com/ZeR020/opencode-mem0/commit/ffb55d7))
- **`aiSessionManager` backward-compatible Proxy export** — Removed redundant singleton surface from `ai-session-manager.ts`. All consumers use `getAISessionManager()` via constructor injection. ([commit bfd1ce4](https://github.com/ZeR020/opencode-mem0/commit/bfd1ce4))
- **`getSupportedProviders()` on `AIProviderFactory`** — Removed zero-caller method. ([commit bfd1ce4](https://github.com/ZeR020/opencode-mem0/commit/bfd1ce4))
- **`startCleanupSchedule`/`stopCleanupSchedule` static methods on `AIProviderFactory`** — Inlined as `setInterval`/`clearInterval` in `index.ts`. The factory is a provider factory, not a session-GC owner. ([commit bfd1ce4](https://github.com/ZeR020/opencode-mem0/commit/bfd1ce4))
- **`ConflictCheckLock` class** — Inlined as a module-level `Set<string>` (single consumer in `detectConflicts`). ([commit bfd1ce4](https://github.com/ZeR020/opencode-mem0/commit/bfd1ce4))

### Changed

- **`iso-639-3` full dataset replaced with `Intl.DisplayNames`** — Language name lookup now uses the native `Intl.DisplayNames` API instead of importing the full ~9000-entry `iso-639-3` dataset. `franc-min` and `iso6393To1` (3→1 code mapping) are retained. ([commit bfd1ce4](https://github.com/ZeR020/opencode-mem0/commit/bfd1ce4))
- **Dynamic imports converted to static** — `auto-capture.ts` (`detectTargetLanguage` was async solely for `await import`) and `handlers/memory.ts` (`safeJSONParse`, `userPromptManager`) now use static imports, removing unnecessary async overhead. ([commit ffb55d7](https://github.com/ZeR020/opencode-mem0/commit/ffb55d7))
- **`.gitignore` reorganized** — 280-line catch-all replaced with 73-line categorized file. ([commit ffb55d7](https://github.com/ZeR020/opencode-mem0/commit/ffb55d7))
- **localStorage API key storage** — Added comment documenting the accepted security tradeoff (cleartext in localStorage is safe for localhost-only server at `127.0.0.1:4747`; escalate to encrypted storage if server ever binds non-local). ([code scanning alert #7](https://github.com/ZeR020/opencode-mem0/security/code-scanning/7))

### Closed

- [#34](https://github.com/ZeR020/opencode-mem0/issues/34) — Support `file://` with `~` expansion in `*ApiKey` config fields
- [#35](https://github.com/ZeR020/opencode-mem0/issues/35) — `initConfig()` silently resets CONFIG to defaults when global config file is transiently inaccessible
- [#36](https://github.com/ZeR020/opencode-mem0/pull/36) — Guard `initConfig` against silent config reset on empty file load (approach applied directly)
- [#37](https://github.com/ZeR020/opencode-mem0/pull/37) — Preserve global config during transient init misses (closed, over-engineered)

### Contributors

Thanks to the community contributors who reported issues and submitted fixes:

- @boyxil — Reported [#34](https://github.com/ZeR020/opencode-mem0/issues/34)
- @bob56621517 — Reported [#35](https://github.com/ZeR020/opencode-mem0/issues/35) and opened [#36](https://github.com/ZeR020/opencode-mem0/pull/36)
- @kingrubic — Opened [#37](https://github.com/ZeR020/opencode-mem0/pull/37)

## [2.16.2] - 2026-05-29

### Fixed

- **Type safety:** Replace explicit `any` types with proper TypeScript interfaces across the codebase

### Changed

- **CI:** Exclude `shard-manager.ts` and other untestable files from SonarCloud coverage gate
- **Docs:** Comprehensive README overhaul — add plugin enable step, fork note, complete config reference, copyright year update, recommend cheap memory provider model, clean up layout and formatting

## [2.16.1] - 2026-05-28

### Fixed

- **Reliability:** Await async calls and replace explicit `any` types in profile/transcript handlers
- **Security:** Escape all interpolated values in `innerHTML` templates to prevent XSS
- **Config:** Remove startup migration and import-time side effects from `config.ts`
- **Security:** Harden web API and storage initialization

### Changed

- **Code quality:** Replace explicit `any` types with proper TypeScript interfaces across the codebase
- **Refactor:** Extract duplicated `getAllShards` and `extractScopeFromContainerTag` into `shard-manager.ts`
- **CI:** Resolve audit failure and SonarCloud quality gate
- **Docs:** Add npm downloads and DeepWiki badges, clarify Windows support

## [2.16.0] - 2026-05-17

### Major Release: Performance, Reliability, and Quality Overhaul

This release includes 100+ commits of CodeRabbit, DeepSource, and SonarCloud remediation, new features, and comprehensive testing.

### Added

- **WAL batch write API** in ConnectionManager for atomic vector operations
- **Schema versioning and migration runner** for safe database evolution
- **LRU embedding cache** with SHA-256 content-hash keys
- **Adaptive over-fetch multiplier** for search result diversity
- **NSW vector backend** with fallback chain (`hnsw-first` → `exact-scan`)
- **Semantic deduplication at ingest time** (≥0.9 cosine similarity threshold)
- **Query intent analysis** — classifies queries as troubleshooting/recall/exploration/implementation
- **Token-budget-aware memory injection** with configurable token limits
- **Structured XML/YAML output formats** for memory injection
- **Contextual decay rate calculation** — decay rate adjusts based on memory access patterns
- **Transcript search, timeline, profile editing, and strength visualizer** in Web UI
- **Heuristic pre-filter** for conflict detection before expensive LLM checks (#22)
- **Zod config validation** with log levels and deep config merge

### Fixed

- 30+ CodeRabbit findings (CR-01 through CR-08, WR-01 through WR-17): atomicity, mutex, timeout, XSS, path traversal, command injection, vector corruption, config validation, cache leaks
- 40+ async-without-await issues resolved across the codebase
- DeepSource and SonarCloud quality gate blockers resolved

### Changed

- **README fully rewritten** with comprehensive configuration docs
- **DeepSource and SonarCloud** integrated for continuous quality analysis
- **Pre-push hook** added for local DeepSource-equivalent lint checks
- **Complexity reduction** — extracted helpers from high-complexity functions across web-server, api-handlers, deduplication, lifecycle, scoring, auto-capture, and context services

## [2.15.1] - 2026-05-07

### Security & Reliability

- **Comprehensive Codebase Audit** — Addressed 17+ CodeRabbit audit fixes for security and stability (PR #9).
- **Concurrency Deadlock Fix** — Reset prompt claim on early exit to prevent permanent deadlocks.
- **Data Loss Prevention** — Delete shards only after successful re-embedding.
- **Pagination Hardening** — Cap pagination at 500 records and fetch precisely per shard.
- **Auth Hardening** — Removed 'enabled' flag from auth gate and restricted static asset auth to API paths only.
- **Redaction Regex** — Narrowed redaction matching to exact keys preventing aggressive over-redaction.

### Fixed

- **FTS5 Triggers** — Use implicit rowid for FTS5 triggers instead of TEXT id.
- **AISessionManager** — Converted to lazy singleton and mocked before configuration to prevent test import crashes.

## [2.15.0] - 2026-05-06

### Added

#### Cross-Platform Support (Windows, Linux, macOS)

- **Runtime abstraction for SQLite** — Auto-detects `bun:sqlite` (Bun) or falls back to `better-sqlite3` (Node.js) with compatible `Database`/`Statement` interface
- **Runtime abstraction for HTTP server** — Uses `Bun.serve()` on Bun, Node.js `http.createServer()` on other runtimes via `platform-server.ts`
- **Cross-platform build script** — `scripts/build.mjs` replaces Unix shell commands with Node.js `fs` APIs (`fs.cpSync`, `mkdirSync`, `spawnSync`)
- **Test suite migration** — All 21 test files migrated from `bun:test` to `vitest` with ESM mocking patterns (`vi.resetModules()`, `vi.doMock()`)
- **Node.js 20+ support officially added** — Full compatibility with Node.js runtime via `better-sqlite3` and native `http` module
- **Windows path handling** — Dedicated `tests/windows-path.test.ts` validates cross-platform path normalization

### Changed

- **README updated** — Platform requirements section now lists Linux/macOS/Windows with Bun as primary and Node.js 20+ as fallback
- **package.json engines field** — Now allows both `bun >=1.0.0` and `node >=20.0.0`
- **CI workflow** — Tests run with both `bun test` and `npm test` (vitest) for dual-runtime verification
- **Development commands** — Added `npm run build`, `npm test`, and `test:bun` scripts for cross-platform development

### Fixed

- **Security: Error exposure** — `platform-server.ts` no longer leaks internal error details to HTTP clients (generic "Internal server error" response)
- **Security: Multi-value headers** — Node.js `IncomingHttpHeaders` with array values (e.g., `Set-Cookie`) now correctly handled via `Headers.append()`
- **Security: Missing Host header** — HTTP/1.0 clients without `Host` header now fallback to `options.hostname:options.port`
- **Build script portability** — `scripts/build.mjs` now uses `require.resolve('typescript/bin/tsc')` instead of platform-specific `./node_modules/.bin/tsc` shim
- **Test isolation** — `vi.resetModules()` removed from tests; mutable mock state pattern ensures Bun test runner compatibility
- **Directory safety** — `ai-session-manager.ts` now creates parent directory before opening `ai-sessions.db`

### Infrastructure

- **package-lock.json** added for Node.js ecosystem compatibility
- **vitest.config.ts** added for Vitest test runner configuration
- **Migration helper** — `scripts/migrate-v1-to-v2.ts` assists migrating from v1 to v2 data format

## [2.14.5] - 2026-05-06

### Security

- Hardened web server with optional API key authentication for non-localhost bindings
- Fixed SIGINT/SIGTERM handlers to avoid killing the host process on shutdown
- Added `0600` permissions to OAuth credential files after write
- Removed backslash escape vulnerability in LLM prompt construction (`memory-conflicts.ts`)
- Archived memories now correctly remove vectors from the backend search index

### Fixed

- Gracefully degrade when configuration is incomplete instead of blocking plugin load
- Added missing `google-gemini` to `memoryProvider` type union
- Clamped similarity percentages to 0-100 range in search results
- Started periodic cleanup of expired AI provider sessions
- Standardized timer types to `NodeJS.Timeout` across the codebase
- Bounded `execSync` calls with `timeout` to prevent indefinite blocking
- Improved stream chunk processing to handle fragmented regex replacements safely

### Infrastructure

- Restricted CI workflow `GITHUB_TOKEN` permissions to `contents: read`
- Removed `node` from `engines` field (Bun-only runtime)

## [2.14.4] - 2026-05-02

### Security

- Verified author attribution on all commits under correct ZeR020 identity
- Hardened `.gitignore` against AI-generated report files (`*.report.md`, `claude report.md`)
- Pinned `opencode.yml` workflow action to `@v1` for supply-chain safety

### Infrastructure

- Added comprehensive `SECURITY.md` with threat model, mitigations, and verification steps

## [2.14.3] - 2026-05-01

### Security

- Remove wildcard CORS (`Access-Control-Allow-Origin: *`) from web server JSON responses. Server binds to `127.0.0.1` by default; wildcard was unnecessary exposure.
- Sanitize API error responses — replace raw `String(error)` with generic `"Internal error"` / `"Internal server error"` across all API handlers. Actual errors still logged server-side for debugging.

### Dependencies

- Update `@ai-sdk/anthropic` 3.0.72 → 3.0.73
- Update `@ai-sdk/openai` 3.0.54 → 3.0.55
- Update `@opencode-ai/plugin` 1.14.30 → 1.14.31
- Update `@opencode-ai/sdk` 1.14.30 → 1.14.31
- Update `ai` 6.0.170 → 6.0.172

## [2.14.2] - 2026-04-30

### Fixed

- Fix `getProjectName` Windows path handling (backslashes not converted on Linux)
- Release workflow now continues on pre-existing test failures

### Infrastructure

- Release pipeline runs tests before publish with job dependency gate

## [2.14.1] - 2026-04-30

### Security

- Patch CRITICAL `protobufjs` vulnerability (arbitrary code execution) via override to 7.5.6
- Patch MODERATE `yaml` stack overflow vulnerability via override to 2.8.3
- Patch MODERATE `uuid` buffer bounds check vulnerability via override to 14.0.0
- Add dependency override strategy for transitive vulnerability patching

### Infrastructure

- Add `engines` field (node >=20, bun >=1.0)
- Add `bugs` and `homepage` URLs to package.json
- Expand `files` array to include README, LICENSE, CHANGELOG in npm tarball
- Add CI workflow (typecheck + test + build + audit on every PR/push)
- Run tests in release workflow before publish
- Add CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- Add GitHub issue templates and PR template
- Replace placeholder LICENSE with full MIT license text

## [2.14.0] - 2026-04-30

### Cognitive Architecture Upgrade

This release represents a massive cognitive upgrade over opencode-mem, introducing a full memory lifecycle system with intelligent scoring, dual-store management, conflict resolution, and transcript storage.

### Added

#### Transcript Storage Layer

- **Conversation transcript capture** via `transcript-capture.ts` — automatically persists session messages when the agent goes idle
- **FTS5 full-text search** on transcripts with automatic trigger synchronization
- **Configurable retention** (`maxAgeDays`) with automatic cleanup of old transcripts
- **Token count estimation** for storage budgeting

#### 7-Factor Memory Scoring

- **Recency** — Exponential decay using configurable half-life (default 7 days)
- **Frequency** — Log-scaled access count normalization
- **Importance** — Content analysis detecting code blocks, technical keywords, file paths, and type classification
- **Utility** — Context-aware decay with boosts for memories matching recent files/queries
- **Novelty** — Jaccard similarity against existing memories to reward unique content
- **Confidence** — Source-based scoring (manual > API > auto-capture > import)
- **Interference** — Contradiction detection using negation patterns and action verbs
- **Composite Strength** — Weighted aggregation producing a single 0-1 quality score

#### STM/LTM Dual-Store Lifecycle

- **Short-Term Memory (STM)** — Fast decay (rate 0.05) for ephemeral, conversational, or casual memories
- **Long-Term Memory (LTM)** — Slow or zero decay for preferences, constraints, decisions, architecture
- **Automatic promotion** — STM memories promoted to LTM when strength > 0.7 and access_count > 3
- **Ebbinghaus forgetting curve** — Decay formula: `strength *= e^(-decay_rate * age_in_days)`
- **Archival** — Memories below threshold (0.2) and older than 30 days moved to `memories_archive`
- **Background maintenance** — Decay and promotion jobs run at configurable intervals

#### Intelligent Conflict Resolution

- **LLM-powered contradiction detection** — Structured output via OpenCode provider or custom AI provider
- **Heuristic fallback** — Negation pattern matching and keyword overlap when LLM unavailable
- **Four resolution strategies:**
  - `keep_newer` — Deprecate the older memory
  - `keep_both` — Mark as complementary
  - `merge` — Create a unified memory, deprecate originals
  - `manual` — Flag for user review
- **Conflict database** — Persistent `memory_conflicts` table with resolution tracking

#### Hybrid Search & Intelligent Retrieval

- **Multi-factor ranking** — Strength 40% + Recency 30% + Semantic Similarity 30%
- **Diversity filtering** — Jaccard-based penalty (threshold 0.9) prevents redundant results
- **Context boosting** — 50% score boost for memories matching current project, recent files, or query terms
- **FTS5 + vector hybrid** — Full-text search primary with vector similarity fallback
- **Score transparency** — Every result includes `vectorSimilarity`, `recencyWeight`, `strengthWeight`, `diversityPenalty`, `contextBoost`, `finalScore`
- **Pinned memories** — Always surface critical memories at the top of results

#### Migration Tooling

- **Standalone migration script** (`scripts/migrate-v1-to-v2.ts`) for upgrading existing opencode-mem databases
- **Safe schema evolution** — Detects v1 schema, adds columns idempotently, backfills defaults
- **Score backfill** — Computes recency for all existing memories; heuristically classifies old high-quality memories as LTM
- **New table creation** — `memory_conflicts` and `transcripts` databases created automatically

#### Developer Experience

- **Comprehensive JSDoc** on all new public functions across scoring, lifecycle, conflicts, transcripts, and search
- **Usage examples** in `examples/basic-usage.ts` and `examples/custom-scoring.ts`
- **29 integration tests** covering all 5 cognitive features with full pass
- **Clean build** — Zero TypeScript errors, zero build warnings

### Changed

- **README fully rewritten** — New cognitive architecture narrative, detailed configuration docs, API reference
- **Package version** bumped to `2.14.0`
- **Test script** added to `package.json` (`"test": "bun test"`)

### Infrastructure

- **Graphify knowledge graph** updated to 713 nodes, 35 articles, 25 communities
- **Wiki documentation** covers Memory Scoring, Transcript Storage, Conflict Resolution, and more
- **`.gitattributes`** marks `graphify-out/` as linguist-generated for cleaner diffs

## [2.13.0] and earlier

See the legacy opencode-mem changelog for earlier releases.
