# Vector Backend Management

> 26 nodes · cohesion 0.12

## Key Concepts

- **VectorSearch** (20 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **FallbackAwareBackend** (11 connections) — `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`
- **.insertVector()** (9 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.searchInShard()** (8 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.getBackend()** (7 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.updateVector()** (7 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **getLatestProjectMemory()** (4 connections) — `/home/verge/projects/opencode-mem0/src/services/auto-capture.ts`
- **createVectorBackend()** (4 connections) — `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`
- **.logDegrade()** (4 connections) — `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`
- **.rebuildFromShard()** (4 connections) — `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`
- **toBlob()** (4 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.insert()** (3 connections) — `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`
- **.search()** (3 connections) — `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`
- **.deleteShardIndexes()** (3 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.listMemories()** (3 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.rebuildIndexForShard()** (3 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.unpinMemory()** (3 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.getBackendName()** (2 connections) — `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`
- **.constructor()** (2 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.countAllVectors()** (2 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.getMemoriesBySessionID()** (2 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.searchAcrossShards()** (2 connections) — `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- **.constructor()** (1 connections) — `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`
- **.deleteShardIndexes()** (1 connections) — `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`
- **.insertBatch()** (1 connections) — `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`
- *... and 1 more nodes in this community*

## Relationships

- No strong cross-community connections detected

## Source Files

- `/home/verge/projects/opencode-mem0/src/services/auto-capture.ts`
- `/home/verge/projects/opencode-mem0/src/services/sqlite/vector-search.ts`
- `/home/verge/projects/opencode-mem0/src/services/vector-backends/backend-factory.ts`

## Audit Trail

- EXTRACTED: 78 (68%)
- INFERRED: 36 (32%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*