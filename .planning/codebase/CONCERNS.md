# Codebase Concerns

**Analysis Date:** 2026-05-07

## Tech Debt

### Widespread `any` Type Usage

- **Issue:** ~242 explicit `any` / `unknown` casts across the codebase, weakening TypeScript's type safety guarantees
- **Files:** `src/services/api-handlers.ts`, `src/services/memory-conflicts.ts`, `src/services/vector-backends/usearch-backend.ts`, `src/services/ai/providers/base-provider.ts`, `src/services/user-prompt/user-prompt-manager.ts`, `src/services/user-profile/user-profile-manager.ts`, `src/services/ai/session/ai-session-manager.ts`
- **Impact:** Runtime errors from incorrect assumptions about API responses or database rows are not caught at compile time. Refactoring is risky because types don't reflect actual shapes.
- **Fix approach:** Introduce strict interfaces for database row shapes, API response schemas, and message formats. Replace `as any` with validated parsing (e.g., Zod) at system boundaries.

### Large, Multi-Responsibility Files

- **Issue:** Several files exceed 500 lines and handle multiple concerns
- **Files:** `src/services/api-handlers.ts` (1186 lines), `src/services/memory-conflicts.ts` (681 lines), `src/services/sqlite/vector-search.ts` (714 lines), `src/services/memory-scoring.ts` (657 lines), `src/services/memory-lifecycle.ts` (431 lines), `src/index.ts` (648 lines)
- **Impact:** Cognitive load for maintainers is high. Changes to one feature (e.g., conflict resolution) risk regressing another (e.g., memory search). Testability is reduced.
- **Fix approach:** Decompose `api-handlers.ts` into route-specific handler modules. Extract conflict detection heuristics and resolution strategies into separate files. Split vector-search into query-building, result-hydration, and ranking phases.

### Duplicate Web Server Implementations

- **Issue:** Two parallel HTTP server implementations exist: `web-server.ts` and `web-server-worker.ts`
- **Files:** `src/services/web-server.ts`, `src/services/web-server-worker.ts`
- **Impact:** Divergence risk — a bug fixed in one may not be fixed in the other. `web-server-worker.ts` appears to be a dead/legacy file (no imports found in current codebase outside tests).
- **Fix approach:** Verify `web-server-worker.ts` is unused. If so, delete it and update any stale references. If both are needed, extract shared route handling and auth logic into a common module.

### Global Singleton State

- **Issue:** Heavy reliance on module-level singletons with `Symbol.for` global keys makes testing and parallel execution fragile
- **Files:** `src/services/embedding.ts` (`GLOBAL_EMBEDDING_KEY`), `src/services/logger.ts` (`GLOBAL_LOGGER_KEY`), `src/index.ts` (`GLOBAL_PLUGIN_WARMUP_KEY`, `GLOBAL_SIG_KEY`)
- **Impact:** Tests cannot easily isolate state. Multiple plugin loads in the same process share mutable state, leading to race conditions. The `memory-engine.test.ts` mocks show extensive workarounds for this.
- **Fix approach:** Refactor to explicit dependency injection. Pass service instances into constructors rather than importing singletons. For tests, provide reset hooks or factory functions.

### Transaction Handling Inconsistencies

- **Issue:** Some operations use explicit SQLite transactions while others don't; rollback logic is sometimes swallowed (`catch {}`)
- **Files:** `src/services/memory-lifecycle.ts` (lines 215, 253), `src/services/user-profile/user-profile-manager.ts` (lines 146, 183), `src/services/ai/session/ai-session-manager.ts` (lines 233, 251), `src/services/memory-scoring-service.ts` (lines 78, 165)
- **Impact:** Partial writes can leave the database in an inconsistent state (e.g., memory updated but scoring not recalculated). Silent rollback failures hide real bugs.
- **Fix approach:** Standardize on a transaction wrapper that logs rollback failures. Ensure all multi-statement operations are wrapped in transactions.

## Known Bugs

### Test Suite Parallel Execution Failures

- **Symptoms:** 12 tests fail when `bun test` runs all together, but pass in isolation
- **Files:** `tests/memory-engine.test.ts`, `tests/profile-write.test.ts`, `tests/profile-tool-runtime.test.ts`
- **Trigger:** Running the full test suite with `bun test` or `npm test`
- **Root causes:**
  1. `connectionManager.closeAll()` in one test affects concurrent profile tests
  2. Subprocess tests hang on background jobs (lifecycle timers, scoring intervals)
  3. Module cache pollution from Vitest mocks — singletons retain state between tests
- **Workaround:** CI uses `continue-on-error: true` on the test step. Tests are run individually for verification.
- **Fix approach:** Implement proper test isolation by resetting all singleton state in `beforeEach`. Mock `setInterval`/`setTimeout` globally in tests. Use in-memory SQLite databases per test.

### Config `isConfigured()` Always Returns True

- **Symptoms:** Plugin initializes even when no valid config exists, leading to cryptic failures downstream
- **Files:** `src/config.ts` (line 749)
- **Trigger:** Loading the plugin without a config file or with an empty config
- **Impact:** Users get confusing error messages from downstream services instead of a clear "not configured" message.
- **Fix approach:** Implement actual validation logic that checks for required fields (e.g., storage path exists and is writable). Return `false` with a descriptive error.

### OAuth Token Refresh Race Condition

- **Symptoms:** Multiple concurrent requests may trigger simultaneous token refreshes, potentially invalidating the refresh token
- **Files:** `src/services/ai/opencode-provider.ts` (lines 91-130)
- **Trigger:** Rapid concurrent API calls when the access token is expired
- **Impact:** One refresh succeeds and writes a new refresh token; another refresh using the old refresh token fails, causing the entire auth session to be invalidated.
- **Fix approach:** Add a locking mechanism around token refresh. Use a promise-based lock so concurrent requests wait for a single refresh to complete.

## Security Considerations

### PII Redaction Is Pattern-Based, Not Exhaustive

- **Risk:** Email addresses and other PII may leak through logs or API responses if they don't match the regex patterns
- **Files:** `src/services/web-server-worker.ts` (lines 64-66), `src/services/logger.ts` (lines 58-62)
- **Current mitigation:** Regex-based redaction of emails and keys matching `/token|secret|password|api[-_]?key|authorization/i`
- **Recommendations:** 
  1. Use a structured log format that tags fields as sensitive by default
  2. Apply redaction at the serialization layer, not just in the logger
  3. Audit all API endpoints that return memory metadata for PII leakage

### Web Server API Key Auth Bypass on Localhost

- **Risk:** API key enforcement is skipped when `host` is localhost, but this check is based on the configured host, not the actual remote IP
- **Files:** `src/services/web-server.ts` (lines 229-239), `src/services/web-server-worker.ts` (lines 96-103)
- **Current mitigation:** `requiresAuth = !LOCAL_HOSTS.has(this.config.host)`
- **Recommendations:** Check the actual remote IP (`requestIP(req)`) instead of the configured host. A reverse proxy or tunnel could expose localhost-bound server to the internet while the config still says `127.0.0.1`.

### Secret File Permission Checks Are Best-Effort

- **Risk:** Secret files with overly permissive permissions are only warned about, not enforced
- **Files:** `src/services/secret-resolver.ts` (lines 16-33)
- **Current mitigation:** `console.warn()` on files with group/other permissions
- **Recommendations:** Make this a hard error (throw) for secret files. On Windows, the check is skipped entirely — document this limitation.

### JSON Parsing Without Validation

- **Risk:** `JSON.parse()` of untrusted data (API responses, database metadata) can crash the process or introduce prototype pollution
- **Files:** `src/services/ai/opencode-provider.ts` (lines 63, 95, 119, 171), `src/services/ai/providers/google-gemini.ts` (lines 46, 92, 105), `src/services/ai/session/ai-session-manager.ts` (lines 268, 282, 284), `src/services/user-memory-learning.ts` (lines 60, 208, 298)
- **Current mitigation:** None — `JSON.parse()` is called directly without schema validation
- **Recommendations:** Use Zod or similar validation for all external JSON inputs. The `UserProfileValidator` pattern in `src/services/ai/validators/user-profile-validator.ts` should be extended to all parse sites.

## Performance Bottlenecks

### Exact-Scan Fallback Is O(n) Per Query

- **Problem:** When `usearch` is unavailable, vector search falls back to exact cosine similarity scan across all memories
- **Files:** `src/services/vector-backends/exact-scan-backend.ts`, `src/services/vector-backends/backend-factory.ts`
- **Cause:** Loads every vector from SQLite and computes full cosine similarity
- **Improvement path:** Add a bounding-box or LSH-based approximate index for the fallback backend. Or shard the exact-scan by container_tag to reduce the scanned set.

### Memory Scoring Recalculation Is Single-Threaded and Blocking

- **Problem:** `recalculateAllScores()` iterates all memories across all shards in a single loop
- **Files:** `src/services/memory-scoring-service.ts` (lines 30-186)
- **Cause:** Each memory triggers multiple regex matches, word splitting, and Jaccard similarity calculations
- **Improvement path:** Process shards in parallel (they are independent). Batch-update scores with a single `UPDATE` per shard instead of per-memory. Cache keyword regex compilation (already partially done with `TECHNICAL_KEYWORDS_RE`).

### Context Tracker Grows Unbounded

- **Problem:** `ContextTracker` stores all recent queries and files in memory without eviction
- **Files:** `src/services/retrieval-context.ts` (lines 12-47)
- **Cause:** `maxHistory = 10` is fixed and not configurable; the arrays are never cleared
- **Improvement path:** Make `maxHistory` configurable. Add LRU eviction. Clear context when the project changes.

## Fragile Areas

### Multi-Platform SQLite Abstraction

- **Files:** `src/services/sqlite/sqlite-bootstrap.ts`, `src/services/sqlite/connection-manager.ts`
- **Why fragile:** Runtime detection of `bun:sqlite` vs `better-sqlite3` means behavior differs across platforms. The wrapper abstracts away native features (e.g., FTS5, JSON1) that may not be available in both.
- **Safe modification:** Always test both backends. Add feature-detection tests (e.g., `PRAGMA compile_options`) rather than assuming feature parity.

### Dynamic Import Chains in Hot Paths

- **Files:** `src/services/memory-conflicts.ts` (lines 50, 75), `src/services/auto-capture.ts` (lines 273, 319), `src/services/user-memory-learning.ts` (lines 163, 226)
- **Why fragile:** `await import(...)` inside request handlers can fail if the module is missing or if there's a circular dependency. It also introduces async overhead.
- **Safe modification:** Move conditional imports to module top-level or initialization time. Use a provider registry pattern that resolves at startup.

### Signal Handler Double-Binding

- **Files:** `src/index.ts` (lines 209-215)
- **Why fragile:** Uses `globalThis` symbols to prevent double-binding, but this assumes `globalThis` is shared across all loads. In test environments or worker threads, this may not hold.
- **Safe modification:** Use `process.listenerCount()` to check before binding. Ensure shutdown handler is idempotent (multiple calls are safe).

## Scaling Limits

### SQLite Write Concurrency

- **Current capacity:** Single-writer SQLite limits throughput to ~1 write transaction at a time per database file
- **Limit:** Under high write load (e.g., rapid auto-capture), writes will queue and potentially time out
- **Scaling path:** The sharding strategy (`maxVectorsPerShard`) already mitigates this for new writes. Ensure the shard selection logic distributes load evenly. Consider WAL mode tuning (`PRAGMA journal_size_limit`).

### Embedding Model Download

- **Current capacity:** First startup downloads the embedding model (~100MB+) from HuggingFace
- **Limit:** No progress callback to the user. Timeout is hardcoded at 30s (`TIMEOUT_MS` in `src/services/embedding.ts`), which may be insufficient on slow networks
- **Scaling path:** Implement a download progress indicator. Increase timeout for first download. Support pre-cached models in the package.

### USearch In-Memory Index

- **Current capacity:** USearch index is in-memory only; on process restart, it rebuilds from SQLite
- **Limit:** Rebuild time scales with total memory count. For 50k memories, this adds seconds to startup
- **Scaling path:** Implement persistent index serialization (USearch supports saving/loading). Rebuild only when the shard has changed since last save.

## Dependencies at Risk

### `@huggingface/transformers`

- **Risk:** Heavy native dependency (ONNX runtime). May fail to install or load on some platforms (ARM Linux, Windows without WSL)
- **Impact:** Plugin fails to start if embedding model can't be loaded
- **Migration plan:** Already has a fallback path via `embeddingApiUrl` / `embeddingApiKey`. Make this the primary path and local transformers the fallback. Or use a lighter embedding library (`@xenova/transformers` is already the model source).

### `usearch`

- **Risk:** Native C++ module. May not build on newer Node versions or uncommon architectures
- **Impact:** Falls back to exact-scan (slow)
- **Migration plan:** Already has graceful fallback. Monitor for prebuilt binaries availability. Consider `hnswlib-node` as an alternative approximate index.

### `better-sqlite3`

- **Risk:** Native module requiring compilation. Can fail on systems without a C++ compiler
- **Impact:** Plugin won't load without Bun (which has built-in SQLite)
- **Migration plan:** The `sqlite-bootstrap.ts` already handles this with runtime detection. Document that Bun is preferred for zero-native-dependency installation.

## Missing Critical Features

### Structured Health Check Endpoint

- **Problem:** No dedicated health/readiness endpoint for the web server
- **Blocks:** Kubernetes or container orchestration deployments cannot properly monitor the plugin
- **Fix approach:** Add `/api/health` that checks database connectivity, embedding model readiness, and disk space.

### Graceful Shutdown for Background Jobs

- **Problem:** Background intervals (scoring, lifecycle, cleanup) are stopped on SIGINT but there's no wait for in-flight operations
- **Blocks:** Data loss if a scoring update or memory insertion is in progress when the process exits
- **Fix approach:** Add a `shutdownInProgress` flag. In the shutdown handler, stop accepting new work, wait for current jobs to finish (with a timeout), then close databases.

### Config Reload Without Restart

- **Problem:** Config is loaded once at startup. Changes require restarting the OpenCode agent
- **Blocks:** Users can't tune settings (e.g., similarity threshold) without interrupting their session
- **Fix approach:** Watch the config file for changes and reload non-critical settings. Document which settings require restart.

## Test Coverage Gaps

### Web Server Integration Tests

- **What's not tested:** The actual HTTP server startup, port binding, API key enforcement, static file serving
- **Files:** `src/services/web-server.ts`, `src/services/platform-server.ts`
- **Risk:** Port collision handling, auth bypass, and request parsing bugs go unnoticed
- **Priority:** High

### Conflict Resolution End-to-End

- **What's not tested:** The `resolveConflict` function with all four strategies (keep_newer, keep_both, merge, manual)
- **Files:** `src/services/memory-conflicts.ts` (lines 466-614)
- **Risk:** Merge strategy may create corrupted memories or fail to deprecate originals
- **Priority:** Medium

### Migration Service (Fresh-Start and Re-Embed)

- **What's not tested:** `migrationService.migrateToNewModel()` with real dimension mismatches
- **Files:** `src/services/migration-service.ts`
- **Risk:** Data loss during model upgrades
- **Priority:** High

### OAuth Provider Flow

- **What's not tested:** Token refresh, token persistence, beta header injection, tool name prefix stripping
- **Files:** `src/services/ai/opencode-provider.ts`
- **Risk:** Auth failures in production that don't reproduce with API keys
- **Priority:** Medium

### Deduplication Service

- **What's not tested:** Near-duplicate detection with actual vectors, malformed vector handling
- **Files:** `src/services/deduplication-service.ts`
- **Risk:** Incorrect duplicate detection deletes valid memories or misses real duplicates
- **Priority:** Medium

---

*Concerns audit: 2026-05-07*
