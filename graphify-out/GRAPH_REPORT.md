# Graph Report - .  (2026-04-30)

## Corpus Check
- 79 files · ~50,403 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 713 nodes · 2071 edges · 19 communities detected
- Extraction: 75% EXTRACTED · 25% INFERRED · 0% AMBIGUOUS · INFERRED: 517 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_AI Provider Tests|AI Provider Tests]]
- [[_COMMUNITY_API Handlers|API Handlers]]
- [[_COMMUNITY_Backend & Cleanup Services|Backend & Cleanup Services]]
- [[_COMMUNITY_Web UI Application|Web UI Application]]
- [[_COMMUNITY_AI Session Management|AI Session Management]]
- [[_COMMUNITY_Core Plugin Services|Core Plugin Services]]
- [[_COMMUNITY_Auto Capture|Auto Capture]]
- [[_COMMUNITY_Context & User Profile|Context & User Profile]]
- [[_COMMUNITY_HTML UI Components|HTML UI Components]]
- [[_COMMUNITY_Plugin Index Operations|Plugin Index Operations]]
- [[_COMMUNITY_Backend Factory|Backend Factory]]
- [[_COMMUNITY_USearch Vector Backend|USearch Vector Backend]]
- [[_COMMUNITY_Memory Scoring|Memory Scoring]]
- [[_COMMUNITY_Transcript Storage|Transcript Storage]]
- [[_COMMUNITY_Conflict Resolution|Conflict Resolution]]
- [[_COMMUNITY_Exact Scan Backend|Exact Scan Backend]]
- [[_COMMUNITY_Documentation & Graphify|Documentation & Graphify]]
- [[_COMMUNITY_Plugin Loader Tests|Plugin Loader Tests]]
- [[_COMMUNITY_Tool Scope Tests|Tool Scope Tests]]

## God Nodes (most connected - your core abstractions)
1. `log()` - 58 edges
2. `run()` - 45 edges
3. `getConnection()` - 31 edges
4. `t()` - 30 edges
5. `handleRequest()` - 27 edges
6. `fetchAPI()` - 24 edges
7. `loadMemories()` - 23 edges
8. `UserPromptManager` - 23 edges
9. `OpenCode Memory Explorer` - 22 edges
10. `Main Application Script` - 22 edges

## Surprising Connections (you probably didn't know these)
- `opencode-mem0` --conceptually_related_to--> `OpenCode Memory Explorer`  [INFERRED]
  README.md → src/web/index.html
- `OpenCodeMemPlugin()` --calls--> `initConfig()`  [INFERRED]
  /home/verge/projects/opencode-mem0/src/index.ts → /home/verge/projects/opencode-mem0/src/config.ts
- `OpenCodeMemPlugin()` --calls--> `getTags()`  [INFERRED]
  /home/verge/projects/opencode-mem0/src/index.ts → /home/verge/projects/opencode-mem0/src/services/tags.ts
- `OpenCodeMemPlugin()` --calls--> `isConfigured()`  [INFERRED]
  /home/verge/projects/opencode-mem0/src/index.ts → /home/verge/projects/opencode-mem0/src/config.ts
- `OpenCodeMemPlugin()` --calls--> `log()`  [INFERRED]
  /home/verge/projects/opencode-mem0/src/index.ts → /home/verge/projects/opencode-mem0/src/services/logger.ts

## Hyperedges (group relationships)
- **Memory Management Workflow** — index_cleanup, index_deduplication, index_bulk_operations, index_add_memory, index_edit_memory [INFERRED 0.85]
- **Model Dimension Migration Strategy** — index_fresh_start, index_reembed [INFERRED 0.90]
- **External Library Dependencies** — index_lucide_icons, index_marked_js, index_dompurify, index_jsonrepair [INFERRED 0.90]
- **cross-module query tools** — agentsmd_graphify_query, agentsmd_graphify_path, agentsmd_graphify_explain [INFERRED 0.80]
- **graphify exploration workflow** — agentsmd_graphify, agentsmd_graph_report_md, agentsmd_graphify_query, agentsmd_graphify_path, agentsmd_graphify_explain [INFERRED 0.75]

## Communities

### Community 0 - "AI Provider Tests"
Cohesion: 0.04
Nodes (18): FakeSessionManager, AIProviderFactory, AnthropicMessagesProvider, FakeSessionManager, applySafeExtraParams(), constructor(), GoogleGeminiProvider, hasNonEmptyChoices() (+10 more)

### Community 1 - "API Handlers"
Cohesion: 0.09
Nodes (47): extractScopeFromTag(), getProjectPathFromTag(), handleAddMemory(), handleBulkDelete(), handleBulkDeletePrompts(), handleConflictStats(), handleDeleteMemory(), handleDeletePrompt() (+39 more)

### Community 2 - "Backend & Cleanup Services"
Cohesion: 0.07
Nodes (20): defaultUSearchProbe(), createThrowingBackend(), CleanupService, buildConfig(), ensureConfigExists(), expandPath(), getEmbeddingDimensions(), initConfig() (+12 more)

### Community 3 - "Web UI Application"
Cohesion: 0.14
Nodes (59): addMemory(), bulkDelete(), changePage(), checkMigrationStatus(), clearSearch(), closeMergeModal(), closeModal(), deleteMemoryWithLink() (+51 more)

### Community 4 - "AI Session Management"
Cohesion: 0.06
Nodes (6): AISessionManager, ConnectionManager, createRepoWithWorktree(), run(), ShardManager, UserPromptManager

### Community 5 - "Core Plugin Services"
Cohesion: 0.06
Nodes (20): formatMemoriesForCompaction(), formatSearchResults(), OpenCodeMemPlugin(), detectLanguage(), getLanguageName(), applyDecay(), archiveMemory(), classifyMemory() (+12 more)

### Community 6 - "Auto Capture"
Cohesion: 0.12
Nodes (26): buildMarkdownContext(), extractAIContent(), generateSummary(), getLatestProjectMemory(), performAutoCapture(), createOAuthFetch(), createOpencodeAIProvider(), findAuthJsonPath() (+18 more)

### Community 7 - "Context & User Profile"
Cohesion: 0.09
Nodes (10): formatContextForPrompt(), getUserProfileContext(), safeArray(), safeObject(), buildMemoryProviderConfig(), analyzeUserProfile(), buildUserAnalysisContext(), generateChangeSummary() (+2 more)

### Community 8 - "HTML UI Components"
Cohesion: 0.09
Nodes (38): OpenCode Memory Explorer Web UI, Add Memory Form, Add New Memory Section, Bulk Actions Panel, Changelog List Container, Profile Version History Modal, Conflicts List Container, Memory Conflicts Section (+30 more)

### Community 9 - "Plugin Index Operations"
Cohesion: 0.1
Nodes (27): Add Memory Form, app.js Application Script, Bulk Operations, Profile Changelog, Cleanup Operation, Deduplication Operation, DOMPurify Sanitizer, Edit Memory Modal (+19 more)

### Community 10 - "Backend Factory"
Cohesion: 0.13
Nodes (4): createVectorBackend(), FallbackAwareBackend, toBlob(), VectorSearch

### Community 11 - "USearch Vector Backend"
Cohesion: 0.25
Nodes (1): USearchBackend

### Community 12 - "Memory Scoring"
Cohesion: 0.29
Nodes (15): calculateAllScores(), calculateConfidence(), calculateFrequency(), calculateImportance(), calculateInterference(), calculateNovelty(), calculateRecency(), calculateUtility() (+7 more)

### Community 13 - "Transcript Storage"
Cohesion: 0.22
Nodes (5): cleanupOldTranscripts(), performTranscriptCapture(), approximateTokenCount(), getTranscriptDbPath(), TranscriptManager

### Community 14 - "Conflict Resolution"
Cohesion: 0.26
Nodes (12): safeJSONParse(), safeToISOString(), checkContradictionHeuristic(), checkContradictionWithLLM(), detectConflicts(), extractScopeFromContainerTag(), findExistingConflict(), findSimilarMemories() (+4 more)

### Community 15 - "Exact Scan Backend"
Cohesion: 0.2
Nodes (1): ExactScanBackend

### Community 16 - "Documentation & Graphify"
Cohesion: 0.36
Nodes (10): community structure, god nodes, GRAPH_REPORT.md, graphify, graphify explain CLI command, graphify-out/ directory, graphify path CLI command, graphify query CLI command (+2 more)

### Community 17 - "Plugin Loader Tests"
Cohesion: 0.67
Nodes (2): loadDistPlugin(), readPackageJson()

### Community 18 - "Tool Scope Tests"
Cohesion: 0.67
Nodes (1): runScenario()

## Knowledge Gaps
- **20 isolated node(s):** `opencode-mem0`, `Memory Search`, `Tag Filtering`, `Bulk Operations`, `Memory List Pagination` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `USearch Vector Backend`** (19 nodes): `USearchBackend`, `.addItems()`, `.constructor()`, `.createEmptyIndex()`, `.decodeVector()`, `.delete()`, `.deleteShardIndexes()`, `.ensureKey()`, `.getBackendName()`, `.getIndexKey()`, `.getOrCreateIndex()`, `.insert()`, `.insertBatch()`, `.insertManyForTest()`, `.loadUSearch()`, `.rebuildFromShard()`, `.search()`, `.searchForTest()`, `.upsertItem()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Exact Scan Backend`** (11 nodes): `ExactScanBackend`, `.cosineSimilarity()`, `.decodeVector()`, `.delete()`, `.deleteShardIndexes()`, `.getBackendName()`, `.insert()`, `.insertBatch()`, `.rankVectors()`, `.rebuildFromShard()`, `.search()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Plugin Loader Tests`** (4 nodes): `plugin-loader-contract.test.ts`, `loadDistPlugin()`, `readPackageJson()`, `plugin-loader-contract.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Tool Scope Tests`** (3 nodes): `tool-scope.test.ts`, `tool-scope.test.ts`, `runScenario()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `API Handlers` to `AI Provider Tests`, `Backend & Cleanup Services`, `AI Session Management`, `Core Plugin Services`, `Auto Capture`, `Context & User Profile`, `Backend Factory`?**
  _High betweenness centrality (0.145) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Web UI Application` to `Auto Capture`, `Context & User Profile`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `handleRunCleanup()` connect `API Handlers` to `Web UI Application`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Are the 54 inferred relationships involving `log()` (e.g. with `OpenCodeMemPlugin()` and `ensureConfigExists()`) actually correct?**
  _`log()` has 54 INFERRED edges - model-reasoned connections that need verification._
- **Are the 42 inferred relationships involving `run()` (e.g. with `handleRunTagMigrationBatch()` and `.initDatabase()`) actually correct?**
  _`run()` has 42 INFERRED edges - model-reasoned connections that need verification._
- **Are the 28 inferred relationships involving `getConnection()` (e.g. with `.detectAndRemoveDuplicates()` and `.detectDimensionMismatch()`) actually correct?**
  _`getConnection()` has 28 INFERRED edges - model-reasoned connections that need verification._
- **Are the 27 inferred relationships involving `t()` (e.g. with `populateTagDropdowns()` and `renderMemories()`) actually correct?**
  _`t()` has 27 INFERRED edges - model-reasoned connections that need verification._