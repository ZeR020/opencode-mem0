# Graph Report - opencode-mem0  (2026-04-30)

## Corpus Check
- 72 files · ~42,863 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 516 nodes · 1291 edges · 16 communities detected
- Extraction: 68% EXTRACTED · 32% INFERRED · 0% AMBIGUOUS · INFERRED: 414 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 20|Community 20]]

## God Nodes (most connected - your core abstractions)
1. `log()` - 64 edges
2. `run()` - 47 edges
3. `getConnection()` - 31 edges
4. `t()` - 29 edges
5. `handleRequest()` - 26 edges
6. `UserPromptManager` - 22 edges
7. `loadMemories()` - 21 edges
8. `getAllShards()` - 20 edges
9. `fetchAPI()` - 19 edges
10. `USearchBackend` - 19 edges

## Surprising Connections (you probably didn't know these)
- `OpenCodeMemPlugin()` --calls--> `createPlugin()`  [INFERRED]
  src/index.ts → tests/profile-tool-runtime.test.ts
- `handleRunTagMigrationBatch()` --calls--> `run()`  [INFERRED]
  src/services/api-handlers.ts → tests/project-scope.test.ts
- `ensureConfigExists()` --calls--> `log()`  [INFERRED]
  src/config.ts → src/services/logger.ts
- `getProjectPathFromTag()` --calls--> `getAllShards()`  [INFERRED]
  src/services/api-handlers.ts → tests/memory-scope.test.ts
- `getProjectPathFromTag()` --calls--> `getConnection()`  [INFERRED]
  src/services/api-handlers.ts → tests/memory-scope.test.ts

## Hyperedges (group relationships)
- **Memory Management Workflow** — index_cleanup, index_deduplication, index_bulk_operations, index_add_memory, index_edit_memory [INFERRED 0.85]
- **Model Dimension Migration Strategy** — index_fresh_start, index_reembed [INFERRED 0.90]
- **External Library Dependencies** — index_lucide_icons, index_marked_js, index_dompurify, index_jsonrepair [INFERRED 0.90]
- **cross-module query tools** — agentsmd_graphify_query, agentsmd_graphify_path, agentsmd_graphify_explain [INFERRED 0.80]
- **graphify exploration workflow** — agentsmd_graphify, agentsmd_graph_report_md, agentsmd_graphify_query, agentsmd_graphify_path, agentsmd_graphify_explain [INFERRED 0.75]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (40): extractScopeFromTag(), getProjectPathFromTag(), handleAddMemory(), handleBulkDelete(), handleBulkDeletePrompts(), handleDeleteMemory(), handleDeletePrompt(), handleDetectMigration() (+32 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (12): FakeSessionManager, AnthropicMessagesProvider, FakeSessionManager, applySafeExtraParams(), GoogleGeminiProvider, hasNonEmptyChoices(), isErrorResponseBody(), OpenAIChatCompletionProvider (+4 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (22): buildMarkdownContext(), extractAIContent(), createVectorBackend(), CleanupService, extractScopeFromContainerTag(), resolveScopeValue(), buildConfig(), ensureConfigExists() (+14 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (9): AISessionManager, getLatestProjectMemory(), performAutoCapture(), ConnectionManager, closeAll(), createRepoWithWorktree(), run(), ShardManager (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (50): addMemory(), bulkDelete(), changePage(), checkMigrationStatus(), clearSearch(), closeModal(), deleteMemoryWithLink(), deletePromptWithLink() (+42 more)

### Community 5 - "Community 5"
Cohesion: 0.1
Nodes (7): formatContextForPrompt(), getUserProfileContext(), safeArray(), buildUserAnalysisContext(), generateChangeSummary(), performUserProfileLearning(), UserProfileManager

### Community 6 - "Community 6"
Cohesion: 0.14
Nodes (13): AIProviderFactory, generateSummary(), detectLanguage(), getLanguageName(), createOAuthFetch(), createOpencodeAIProvider(), findAuthJsonPath(), generateStructuredOutput() (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (3): FallbackAwareBackend, toBlob(), VectorSearch

### Community 8 - "Community 8"
Cohesion: 0.17
Nodes (15): isConfigured(), OpenCodeMemPlugin(), createPlugin(), getGitCommonDir(), getGitEmail(), getGitName(), getGitRepoUrl(), getGitTopLevel() (+7 more)

### Community 9 - "Community 9"
Cohesion: 0.25
Nodes (1): USearchBackend

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (2): startWebServer(), WebServer

### Community 11 - "Community 11"
Cohesion: 0.23
Nodes (5): cleanupOldTranscripts(), performTranscriptCapture(), approximateTokenCount(), getTranscriptDbPath(), TranscriptManager

### Community 12 - "Community 12"
Cohesion: 0.2
Nodes (1): ExactScanBackend

### Community 13 - "Community 13"
Cohesion: 0.36
Nodes (10): community structure, god nodes, GRAPH_REPORT.md, graphify, graphify explain CLI command, graphify-out/ directory, graphify path CLI command, graphify query CLI command (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.33
Nodes (1): FakeSessionManager

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (1): opencode-mem0

## Knowledge Gaps
- **2 isolated node(s):** `opencode-mem0`, `graphify update . CLI command`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 9`** (19 nodes): `USearchBackend`, `.addItems()`, `.constructor()`, `.createEmptyIndex()`, `.decodeVector()`, `.delete()`, `.deleteShardIndexes()`, `.ensureKey()`, `.getBackendName()`, `.getIndexKey()`, `.getOrCreateIndex()`, `.insert()`, `.insertBatch()`, `.insertManyForTest()`, `.loadUSearch()`, `.rebuildFromShard()`, `.search()`, `.searchForTest()`, `.upsertItem()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 10`** (16 nodes): `web-server.ts`, `startWebServer()`, `WebServer`, `.attemptTakeover()`, `.checkServerAvailable()`, `.constructor()`, `.getUrl()`, `.isRunning()`, `.isServerOwner()`, `.jsonResponse()`, `.serveStaticFile()`, `.setOnTakeoverCallback()`, `.start()`, `.startHealthCheckLoop()`, `.stop()`, `.stopHealthCheckLoop()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 12`** (11 nodes): `ExactScanBackend`, `.cosineSimilarity()`, `.decodeVector()`, `.delete()`, `.deleteShardIndexes()`, `.getBackendName()`, `.insert()`, `.insertBatch()`, `.rankVectors()`, `.rebuildFromShard()`, `.search()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (6 nodes): `FakeSessionManager`, `.addMessage()`, `.createSession()`, `.getLastSequence()`, `.getMessages()`, `.getSession()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (1 nodes): `opencode-mem0`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 6`, `Community 7`, `Community 8`, `Community 10`, `Community 11`?**
  _High betweenness centrality (0.232) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Community 4` to `Community 3`, `Community 5`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `run()` connect `Community 3` to `Community 0`, `Community 11`, `Community 5`, `Community 7`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Are the 61 inferred relationships involving `log()` (e.g. with `OpenCodeMemPlugin()` and `ensureConfigExists()`) actually correct?**
  _`log()` has 61 INFERRED edges - model-reasoned connections that need verification._
- **Are the 45 inferred relationships involving `run()` (e.g. with `handleRunTagMigrationBatch()` and `.initDatabase()`) actually correct?**
  _`run()` has 45 INFERRED edges - model-reasoned connections that need verification._
- **Are the 29 inferred relationships involving `getConnection()` (e.g. with `.detectAndRemoveDuplicates()` and `.detectDimensionMismatch()`) actually correct?**
  _`getConnection()` has 29 INFERRED edges - model-reasoned connections that need verification._
- **Are the 27 inferred relationships involving `t()` (e.g. with `populateTagDropdowns()` and `renderMemories()`) actually correct?**
  _`t()` has 27 INFERRED edges - model-reasoned connections that need verification._