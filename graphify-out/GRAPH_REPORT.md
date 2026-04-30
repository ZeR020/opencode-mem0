# Graph Report - opencode-mem0  (2026-04-30)

## Corpus Check
- 77 files · ~51,778 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 572 nodes · 1520 edges · 17 communities detected
- Extraction: 65% EXTRACTED · 35% INFERRED · 0% AMBIGUOUS · INFERRED: 531 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 21|Community 21]]

## God Nodes (most connected - your core abstractions)
1. `log()` - 85 edges
2. `run()` - 55 edges
3. `getConnection()` - 40 edges
4. `t()` - 29 edges
5. `getAllShards()` - 29 edges
6. `handleRequest()` - 26 edges
7. `fetchAPI()` - 22 edges
8. `UserPromptManager` - 22 edges
9. `loadMemories()` - 21 edges
10. `handleSearch()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `OpenCodeMemPlugin()` --calls--> `createPlugin()`  [INFERRED]
  src/index.ts → tests/profile-tool-runtime.test.ts
- `recalculateAllScores()` --calls--> `getAllShards()`  [INFERRED]
  src/services/memory-scoring-service.ts → tests/memory-scope.test.ts
- `recalculateAllScores()` --calls--> `getConnection()`  [INFERRED]
  src/services/memory-scoring-service.ts → tests/memory-scope.test.ts
- `recalculateAllScores()` --calls--> `run()`  [INFERRED]
  src/services/memory-scoring-service.ts → tests/project-scope.test.ts
- `detectConflicts()` --calls--> `getAllShards()`  [INFERRED]
  src/services/memory-conflicts.ts → tests/memory-scope.test.ts

## Hyperedges (group relationships)
- **Memory Management Workflow** — index_cleanup, index_deduplication, index_bulk_operations, index_add_memory, index_edit_memory [INFERRED 0.85]
- **Model Dimension Migration Strategy** — index_fresh_start, index_reembed [INFERRED 0.90]
- **External Library Dependencies** — index_lucide_icons, index_marked_js, index_dompurify, index_jsonrepair [INFERRED 0.90]
- **cross-module query tools** — agentsmd_graphify_query, agentsmd_graphify_path, agentsmd_graphify_explain [INFERRED 0.80]
- **graphify exploration workflow** — agentsmd_graphify, agentsmd_graph_report_md, agentsmd_graphify_query, agentsmd_graphify_path, agentsmd_graphify_explain [INFERRED 0.75]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (51): extractScopeFromTag(), getProjectPathFromTag(), handleAddMemory(), handleBulkDelete(), handleBulkDeletePrompts(), handleConflictStats(), handleDeleteMemory(), handleDeletePrompt() (+43 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (16): AISessionManager, buildMarkdownContext(), extractAIContent(), getLatestProjectMemory(), performAutoCapture(), ConnectionManager, closeAll(), safeArray() (+8 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (28): CleanupService, buildConfig(), ensureConfigExists(), expandPath(), getEmbeddingDimensions(), initConfig(), isConfigured(), loadConfigFromPaths() (+20 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (12): FakeSessionManager, AnthropicMessagesProvider, FakeSessionManager, applySafeExtraParams(), GoogleGeminiProvider, hasNonEmptyChoices(), isErrorResponseBody(), OpenAIChatCompletionProvider (+4 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (55): addMemory(), bulkDelete(), changePage(), checkMigrationStatus(), clearSearch(), closeMergeModal(), closeModal(), deleteMemoryWithLink() (+47 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (6): createVectorBackend(), FallbackAwareBackend, calculateDiversityPenalty(), ContextTracker, toBlob(), VectorSearch

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (21): AIProviderFactory, generateSummary(), detectLanguage(), getLanguageName(), checkContradictionHeuristic(), checkContradictionWithLLM(), detectConflicts(), extractScopeFromContainerTag() (+13 more)

### Community 7 - "Community 7"
Cohesion: 0.25
Nodes (1): USearchBackend

### Community 8 - "Community 8"
Cohesion: 0.27
Nodes (12): getGitCommonDir(), getGitEmail(), getGitName(), getGitRepoUrl(), getGitTopLevel(), getProjectIdentity(), getProjectName(), getProjectRoot() (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.18
Nodes (2): startWebServer(), WebServer

### Community 10 - "Community 10"
Cohesion: 0.21
Nodes (6): getDatabase(), cleanupOldTranscripts(), performTranscriptCapture(), approximateTokenCount(), getTranscriptDbPath(), TranscriptManager

### Community 11 - "Community 11"
Cohesion: 0.39
Nodes (10): calculateAllScores(), calculateConfidence(), calculateFrequency(), calculateImportance(), calculateInterference(), calculateNovelty(), calculateRecency(), calculateUtility() (+2 more)

### Community 12 - "Community 12"
Cohesion: 0.2
Nodes (1): ExactScanBackend

### Community 13 - "Community 13"
Cohesion: 0.36
Nodes (10): community structure, god nodes, GRAPH_REPORT.md, graphify, graphify explain CLI command, graphify-out/ directory, graphify path CLI command, graphify query CLI command (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.33
Nodes (1): FakeSessionManager

### Community 15 - "Community 15"
Cohesion: 0.67
Nodes (2): isFullyPrivate(), stripPrivateContent()

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (1): opencode-mem0

## Knowledge Gaps
- **2 isolated node(s):** `opencode-mem0`, `graphify update . CLI command`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 7`** (19 nodes): `USearchBackend`, `.addItems()`, `.constructor()`, `.createEmptyIndex()`, `.decodeVector()`, `.delete()`, `.deleteShardIndexes()`, `.ensureKey()`, `.getBackendName()`, `.getIndexKey()`, `.getOrCreateIndex()`, `.insert()`, `.insertBatch()`, `.insertManyForTest()`, `.loadUSearch()`, `.rebuildFromShard()`, `.search()`, `.searchForTest()`, `.upsertItem()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 9`** (15 nodes): `startWebServer()`, `WebServer`, `.attemptTakeover()`, `.checkServerAvailable()`, `.constructor()`, `.getUrl()`, `.isRunning()`, `.isServerOwner()`, `.jsonResponse()`, `.serveStaticFile()`, `.setOnTakeoverCallback()`, `.start()`, `.startHealthCheckLoop()`, `.stop()`, `.stopHealthCheckLoop()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 12`** (11 nodes): `ExactScanBackend`, `.cosineSimilarity()`, `.decodeVector()`, `.delete()`, `.deleteShardIndexes()`, `.getBackendName()`, `.insert()`, `.insertBatch()`, `.rankVectors()`, `.rebuildFromShard()`, `.search()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (6 nodes): `FakeSessionManager`, `.addMessage()`, `.createSession()`, `.getLastSequence()`, `.getMessages()`, `.getSession()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (4 nodes): `isFullyPrivate()`, `stripPrivateContent()`, `privacy.ts`, `privacy.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (1 nodes): `opencode-mem0`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 9`, `Community 10`, `Community 11`?**
  _High betweenness centrality (0.262) - this node is a cross-community bridge._
- **Why does `run()` connect `Community 1` to `Community 0`, `Community 2`, `Community 5`, `Community 6`, `Community 10`, `Community 11`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Community 4` to `Community 1`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Are the 82 inferred relationships involving `log()` (e.g. with `OpenCodeMemPlugin()` and `ensureConfigExists()`) actually correct?**
  _`log()` has 82 INFERRED edges - model-reasoned connections that need verification._
- **Are the 53 inferred relationships involving `run()` (e.g. with `recalculateAllScores()` and `saveConflict()`) actually correct?**
  _`run()` has 53 INFERRED edges - model-reasoned connections that need verification._
- **Are the 38 inferred relationships involving `getConnection()` (e.g. with `recalculateAllScores()` and `.detectAndRemoveDuplicates()`) actually correct?**
  _`getConnection()` has 38 INFERRED edges - model-reasoned connections that need verification._
- **Are the 27 inferred relationships involving `t()` (e.g. with `populateTagDropdowns()` and `renderMemories()`) actually correct?**
  _`t()` has 27 INFERRED edges - model-reasoned connections that need verification._