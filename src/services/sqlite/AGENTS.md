# src/services/sqlite/

## Purpose

The database layer. Persists all memories, transcripts, and shard metadata to local SQLite databases with WAL journaling, schema migrations, sharding, and hybrid vector + FTS5 search. Runtime-agnostic: uses native `bun:sqlite` under Bun or `better-sqlite3` under Node.

## Ownership

- `sqlite-bootstrap.ts` — Runtime abstraction over SQLite. Detects Bun vs Node, defines the `Database` and `Statement` interfaces used throughout the layer, and wraps the underlying driver into a common shape. All other modules import `Database`/`Statement` types from here
- `connection-manager.ts` — `ConnectionManager` (exported as `connectionManager` singleton). LRU connection pool (max 20 connections). Handles WAL mode, 64MB cache, schema migrations, batch writes, and checkpointing. The single owner of open database handles
- `shard-manager.ts` — `ShardManager` (exported as `shardManager` singleton). Manages shards per scope (`user`/`project`) and scope hash. Auto-creates new shards when `maxVectorsPerShard` (default 50,000) is reached. Exports `extractScopeFromContainerTag`
- `vector-search.ts` — `VectorSearch` (exported as `vectorSearch` singleton). Hybrid search engine: vector similarity via pluggable backend + FTS5 text search + multi-factor ranking with context boost and diversity filtering. `insertVector` writes records with all scoring/metadata/vector blob fields
- `transcript-manager.ts` — `TranscriptManager`. Stores raw session transcripts with FTS5 full-text search. Retention via `transcriptStorage.maxAgeDays`
- `schema.ts` — Schema version tracking and migrations. `CURRENT_SCHEMA_VERSION`, `MIGRATIONS` map, `getCurrentVersion`, `runMigrations`. Idempotent migration runner that skips already-applied `ALTER TABLE`/`ADD COLUMN`
- `types.ts` — Shared SQLite-layer types: `ShardInfo`, `MemoryRecord` (with scoring + lifecycle fields), `SearchResult` (with retrieval scoring fields), `MemoryConflict`

## Local Contracts

- All database access goes through `connection-manager.ts`. Do not open SQLite handles directly elsewhere
- Schema changes require a new migration entry in `MIGRATIONS` and a bumped `CURRENT_SCHEMA_VERSION`. Migrations must be idempotent (the runner skips already-applied alters)
- `Database`/`Statement` interfaces from `sqlite-bootstrap.ts` are the only SQL surface — never import the raw Bun/Node driver directly in other modules
- `MemoryRecord`, `SearchResult`, `ShardInfo`, `MemoryConflict` in `types.ts` are the row/record contracts shared with `client.ts` and the scoring/lifecycle services
- Storage layout (under `storagePath`, default `~/.opencode-mem0/data/`): `metadata.db` (shard registry), `users/` and `projects/` shard DBs, `transcripts.db`, `.cache/` (embedding model cache). Preserve this layout
- Vector blobs are written by `vector-search.ts` alongside scoring, lifecycle, and metadata columns in the `memories` table — keep the column set in sync with `MemoryRecord`

## Work Guidance

- New SQL columns: add a migration in `schema.ts`, extend `MemoryRecord`/`SearchResult` in `types.ts`, update `vector-search.ts` insert/read queries, and account for the `as` casts noted as tech debt in `src/config.ts`
- Connection pool exhaustion (max 20) is a real ceiling under heavy concurrency — profile before raising it
- WAL checkpointing and batch writes are owned by `connection-manager.ts`; rely on them rather than ad-hoc `PRAGMA` calls

## Verification

- `tests/connection-manager`, `tests/shard-manager`, `tests/vector-search-backend-integration.test.ts`, `tests/schema-version.test.ts`, `tests/wal-batch.test.ts` cover this layer
- `tests/vector-backends/` covers the backend integration with `vector-search.ts`
- `bun run typecheck` enforces the `Database`/`Statement` interface usage

## Child DOX Index

No child AGENTS.md files. This is a leaf boundary.
