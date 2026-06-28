# src/services/vector-backends/

## Purpose

Pluggable vector index backends for similarity search. Decouples the indexing algorithm from the storage layer so `vector-search.ts` can use usearch HNSW or brute-force exact scan, with an automatic fallback chain.

## Ownership

- `types.ts` — The `VectorBackend` interface (the only seam for new backends), `VectorBackendFactoryOptions`, `BackendSearchResult`, `BackendInsertItem`, `VectorBackendSearchParams`, `VectorKind` (`"content" | "tags"`)
- `backend-factory.ts` — `createVectorBackend()` factory. Builds a `FallbackAwareBackend` (internal, not exported) that wraps a primary + fallback backend, with a 3-transient-error retry loop and a 60s recovery window. Strategies: `usearch-first` (default), `usearch`, `exact-scan`
- `usearch-backend.ts` — `USearchBackend`: HNSW index via the usearch native binding
- `exact-scan-backend.ts` — `ExactScanBackend`: brute-force cosine similarity fallback (no index overhead)
- `shared.ts` — Shared helpers across backend implementations

## Local Contracts

- New backends implement `VectorBackend` from `types.ts` — that interface is the only contract. Do not add backend-specific methods to the interface
- Backends are constructed only through `createVectorBackend()` in `backend-factory.ts`. The factory wires the fallback chain; do not instantiate backends directly in `vector-search.ts`
- `VectorKind` distinguishes content vectors from tag vectors — backends must maintain separate indexes per kind
- Strategy selection is config-driven (`vectorBackend` in `config.ts`); `usearch-first` is the default and must remain a safe choice across platforms
- `FallbackAwareBackend` degrades to exact-scan after 3 transient errors and resets after 60s of error-free operation — preserve this recovery behavior

## Work Guidance

- Adding a backend: implement `VectorBackend`, add a strategy key to `VectorBackendFactoryOptions` and `VectorBackendConfig` (`src/config.ts`), register it in `createVectorBackend()`, add `tests/vector-backends/<name>-backend.test.ts`
- The usearch native binding is platform-sensitive (Linux/macOS primary); exact-scan is the cross-platform safety net. Keep exact-scan dependency-free
- Backend operations take `ShardInfo` and `db: unknown` — backends must not assume a specific driver

## Verification

- `tests/vector-backends/usearch-backend.test.ts`, `tests/vector-backends/exact-scan-backend.test.ts`, `tests/vector-backends/migration-fallback.test.ts`, `tests/vector-backends/backend-factory.test.ts`
- `tests/vector-search-backend-integration.test.ts` covers integration with `vector-search.ts`

## Child DOX Index

No child AGENTS.md files. This is a leaf boundary.
