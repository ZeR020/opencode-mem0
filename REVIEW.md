# opencode-mem0 Code Review Report

**Reviewed:** 2026-05-28T00:00:00Z  
**Scope:** source, tests, scripts, package configuration, GitHub workflows, web API routes  
**Validation run:** `bun run typecheck` passed; `bun run test` passed; all docs verified against codebase.

## Summary

The main correctness risks are around initialization order and web/API documentation. Several module-level singletons use lazy Proxy patterns but may cache paths before `initConfig()` applies project config. The web API key auth flow uses `window.prompt()` rather than a styled form. The API surface is undocumented. Note: HIGH-03 (non-loopback exposure) is already resolved — the server refuses to start without `webServerApiKey` on non-loopback hosts.

## Findings

### HIGH-01: Module-level database singletons initialize before project config is applied

**Evidence:** `src/index.ts:5-28`, `src/index.ts:75-78`, `src/services/sqlite/shard-manager.ts:436-441`, `src/services/user-prompt/user-prompt-manager.ts:321-326`, `src/services/sqlite/connection-manager.ts:150-166`

**Issue:** `index.ts` imports `memoryClient`, `performAutoCapture`, and `userPromptManager` dependencies before the plugin calls `initConfig(directory)` at line 77. Those imported modules use lazy Proxy patterns for `shardManager` and `userPromptManager` (deferred construction via Proxy get traps that call `getShardManager()`/`getUserPromptManager()` on first access, re-checking `CONFIG.storagePath`), so they do not construct at module load time. However, `memoryClient` does initialize eagerly, and the Proxy re-checks `CONFIG.storagePath` at access time rather than at config-set time — meaning if config changes after first access, the Proxy may already have cached the wrong path.

**Impact:** Project-specific `storagePath` can be ignored, causing reads/writes in the default/global location and creating local state merely by importing/loading the plugin. This can break expected isolation and surprise users who configure a project-specific storage path.

**Recommended fix:** Ensure lazy Proxy singletons always re-read the latest `CONFIG` values on first access after `initConfig()`, or expose explicit re-initialization methods. Verify that `memoryClient` warmup (which does run eagerly) respects the configured storage path.

### HIGH-02: Configuring `webServerApiKey` blocks the browser UI and uses an undocumented header

**Evidence:** `src/services/web-server.ts:241-250`, `src/web/app.js:37-45`

**Issue:** The server supports two auth mechanisms: `x-opencode-mem-key` header and `Authorization: Bearer <key>` header (checked in `_isAuthorized()`). Static assets (`/`, `/app.js`) are served before the auth check, and `/api/health` bypasses auth. The bundled UI fetch helper (`buildApiHeaders()` in `app.js:38-44`) sends `Authorization: Bearer` with the API key from localStorage. The UI includes a `requestApiKey()` prompt flow (app.js:47-51) that triggers on 401 responses via `fetchAPI()`, providing a browser-native API key entry dialog. This flow is functional but uses `window.prompt()` rather than a styled login form.

**Impact:** The `window.prompt()` auth flow is functional but minimal — no styled login form, no password masking, and no "remember me" toggle beyond localStorage persistence.

**Recommended fix:** Replace `window.prompt()` with a styled login form for a better user experience.

### HIGH-03 (resolved): Web server already requires `webServerApiKey` when bound beyond loopback

**Evidence:** `src/services/web-server.ts:98-99`, `src/config.ts:155-158`, `src/config.ts:626-629`

**Issue:** ~~`webServerHost` is user-configurable, but authentication is optional. If configured as `0.0.0.0` or another non-loopback address without `webServerApiKey`, write/delete/cleanup/migration/profile endpoints are unauthenticated.~~ **Resolved:** The server throws `Error('webServerApiKey is required when webServerHost is not loopback')` at startup (web-server.ts:98-99) if a non-loopback host is configured without an API key, preventing unauthenticated network exposure.

**Impact:** ~~A network-exposed instance could leak local transcripts/memories and allow remote deletion or mutation of memory data.~~ No longer applicable — the server refuses to start in this configuration.

**Recommended fix:** ~~Require `webServerApiKey` when `webServerHost` is not loopback, or refuse to start in that configuration unless an explicit unsafe override is set.~~ Already implemented. Consider documenting this safety check in CONFIGURATION.md.

### HIGH-04: README API contract does not match implemented routes or request bodies

**Evidence:** `src/services/web-server.ts:295-367`, `src/services/api-handlers.ts:312-327`

**Issue:** The current README does not document web API endpoints. The implemented routes include `/api/search`, `/api/memories/:id` GET (`_apiGetMemory`), `/api/transcripts` list (`_apiListTranscripts`), `/api/health` (`_apiStatus`, bypasses auth), `/api/user-profile`, and `/api/status`. POST `/api/memories` requires `containerTag` in the request body. Without documentation, integrators must read source code to discover available endpoints and their schemas.

**Impact:** Users and integrations have no documented API reference and must reverse-engineer the route table from source code.

**Recommended fix:** Add an API reference section to docs (e.g., `docs/API.md`) documenting the actual route table, headers, and request schemas. Add contract tests generated from the documented API table.

### MEDIUM-01: Hybrid search only uses FTS results when embeddings are degraded

**Evidence:** `src/services/sqlite/vector-search.ts:525-530`, `src/services/sqlite/vector-search.ts:549-555`

**Issue:** FTS5 results are always merged into the candidate set at line 526: `ids = Array.from(new Set([...scoreMap.keys(), ...ftsResults]))`, regardless of whether vector search succeeded. However, the scoring/hydration logic treats FTS-only candidates differently based on `embeddingDegraded` status — when embeddings are healthy, FTS-only results may receive lower scores. The original concern about FTS IDs being excluded is not valid (they are always included), but the scoring disparity between vector-matched and FTS-only candidates during normal operation may still reduce the ranking of exact keyword matches.

**Impact:** FTS-only matches are included in results but may rank lower than vector-matched candidates, potentially burying exact keyword matches for identifiers, filenames, exact error strings, or rare terms below the default result limit.

**Recommended fix:** Ensure FTS-only candidates receive fair scoring weight in the hydration/ranking phase, even when vector embeddings are available, so exact keyword matches are not buried by semantically similar but less precise vector results.

### MEDIUM-02: No API reference documentation for web server endpoints

**Evidence:** `docs/` directory, `src/services/web-server.ts:295-441`

**Issue:** The current documentation does not include an API reference for the web server's REST endpoints. Integrators and users must read source code to discover available routes, request schemas, and authentication requirements.

**Impact:** External integrations have no canonical reference for the API surface, leading to trial-and-error development.

**Recommended fix:** Create `docs/API.md` documenting the web server route table, request/response schemas, and authentication headers.

### MEDIUM-03: Release workflow should have explicit test gate

**Evidence:** `.github/workflows/release.yml`

**Issue:** The release workflow runs tests before publishing but does not have an explicit gate or `continue-on-error: true` — tests will naturally block publishing on failure. However, there is no explicit verification step that ensures test results are checked before the publish job runs, which could be a risk if the workflow is restructured in the future.

**Impact:** Currently safe (tests block publish by default), but lacks an explicit gate that would make the dependency clear if the workflow is modified.

**Recommended fix:** Add an explicit test result output and job dependency to make the gate visible, e.g., `needs: [test]` on the publish job.

### LOW-01: Test suite passes with repeated logger write errors on stderr

**Evidence:** `tests/setup-home.ts:14-18`, `src/services/logger.ts:104-120`, validation run of `bun run test`

**Issue:** `bun run test` passes, but many tests emit `[opencode-mem0] Log write failed: ENOENT...` after temp home directories are removed. The logger queues async writes but test cleanup deletes the directory without flushing pending writes.

**Impact:** Test output is noisy and can hide real stderr failures. It also indicates production log writes can fail noisily if the log directory disappears between path resolution and append.

**Recommended fix:** Call `flushLogs()` before removing temp homes in test teardown, and make logger append failures non-spamming or recreate the parent directory before append.

## Areas not fully reviewed

- Did not manually line-review every test assertion or every web UI rendering branch.
- Did not run `bun audit`, `npm pack`, or an install-from-packed-artifact smoke test.
- Did not manually verify browser UI flows with a real `webServerApiKey` beyond static/source reasoning.

## Recommended follow-up tests

1. Add an integration test that sets project-local `.opencode/opencode-mem0.jsonc` with a custom `storagePath` and asserts all DB files are created there.
2. Add web-server contract tests for documented auth (`Authorization: Bearer`), static asset access, and README-listed endpoints.
3. Add a search regression where an exact FTS-only filename/error-string match must appear even when vector search returns unrelated candidates.
4. Add a release workflow check that fails before publish when tests fail.
