import { existsSync, readFileSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stripJsoncComments } from "./services/jsonc.js";
import { resolveSecretValue } from "./services/secret-resolver.js";
import { log, setLogLevel } from "./services/logger.js";
import { z } from "zod";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const DATA_DIR = join(homedir(), ".opencode-mem0");
const CONFIG_FILES = [
  join(CONFIG_DIR, "opencode-mem0.jsonc"),
  join(CONFIG_DIR, "opencode-mem0.json"),
];

if (!existsSync(CONFIG_DIR)) {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

// Migrate data from old opencode-mem directory if present
const OLD_DATA_DIR = join(homedir(), ".opencode-mem");
if (existsSync(OLD_DATA_DIR) && !existsSync(DATA_DIR)) {
  try {
    cpSync(OLD_DATA_DIR, DATA_DIR, { recursive: true });
    log(`
✓ Migrated data from ${OLD_DATA_DIR} to ${DATA_DIR}`);
    log("  Your existing memories and settings have been preserved.\n");
  } catch {
    // If migration fails, just create the new directory
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

interface OpenCodeMemConfig {
  storagePath?: string;
  userEmailOverride?: string;
  userNameOverride?: string;
  memory?: {
    defaultScope?: "project" | "all-projects";
  };
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingApiUrl?: string;
  embeddingApiKey?: string;
  similarityThreshold?: number;
  maxMemories?: number;
  maxProfileItems?: number;
  injectProfile?: boolean;
  containerTagPrefix?: string;
  autoCaptureEnabled?: boolean;
  autoCaptureMaxIterations?: number;
  autoCaptureIterationTimeout?: number;
  autoCaptureLanguage?: string;
  memoryProvider?: "openai-chat" | "openai-responses" | "anthropic" | "google-gemini";
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  vectorBackend?: "usearch-first" | "usearch" | "exact-scan";
  aiSessionRetentionDays?: number;
  webServerEnabled?: boolean;
  webServerPort?: number;
  webServerHost?: string;
  webServerApiKey?: string;
  maxVectorsPerShard?: number;
  autoCleanupEnabled?: boolean;
  autoCleanupRetentionDays?: number;
  deduplicationEnabled?: boolean;
  deduplicationSimilarityThreshold?: number;
  deduplicationIngestEnabled?: boolean;
  userProfileAnalysisInterval?: number;
  userProfileMaxPreferences?: number;
  userProfileMaxPatterns?: number;
  userProfileMaxWorkflows?: number;
  userProfileConfidenceDecayDays?: number;
  userProfileChangelogRetentionCount?: number;
  showAutoCaptureToasts?: boolean;
  showUserProfileToasts?: boolean;
  showErrorToasts?: boolean;
  transcriptStorage?: {
    enabled?: boolean;
    maxAgeDays?: number;
  };
  memoryScoring?: {
    enabled?: boolean;
    recalculationIntervalMinutes?: number;
    recencyHalfLifeDays?: number;
    utilityHalfLifeDays?: number;
  };
  memoryLifecycle?: {
    stmDecayDays?: number;
    ltmDecayDays?: number;
    promotionThreshold?: number;
    archiveThreshold?: number;
    archiveAfterDays?: number;
    checkIntervalMinutes?: number;
  };
  compaction?: {
    enabled?: boolean;
    memoryLimit?: number;
  };
  chatMessage?: {
    enabled?: boolean;
    maxMemories?: number;
    excludeCurrentSession?: boolean;
    maxAgeDays?: number;
    injectOn?: "first" | "always";
  };
  retrieval?: {
    maxResults?: number;
    diversityThreshold?: number;
    contextBoost?: number;
  };
  injection?: {
    tokenBudget?: number;
    format?: "plain" | "xml" | "yaml";
    queryAwareFiltering?: boolean;
    relevanceThreshold?: number;
  };
  contextualDecay?: {
    enabled?: boolean;
    baseDecayRate?: number;
    strengthBoostFactor?: number;
    accessBoostFactor?: number;
    minDecayRate?: number;
    maxDecayRate?: number;
  };
  logLevel?: "debug" | "info" | "warn" | "error";
  warmupTimeoutMs?: number;
}

const OpenCodeMemConfigSchema = z.object({
  storagePath: z.string().optional(),
  userEmailOverride: z.string().optional(),
  userNameOverride: z.string().optional(),
  memory: z
    .object({
      defaultScope: z.enum(["project", "all-projects"]).optional(),
    })
    .optional(),
  embeddingModel: z.string().optional(),
  embeddingDimensions: z.number().positive().optional(),
  embeddingApiUrl: z.url().optional(),
  embeddingApiKey: z.string().optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  maxMemories: z.number().positive().optional(),
  maxProfileItems: z.number().positive().optional(),
  injectProfile: z.boolean().optional(),
  containerTagPrefix: z.string().optional(),
  autoCaptureEnabled: z.boolean().optional(),
  autoCaptureMaxIterations: z.number().positive().optional(),
  autoCaptureIterationTimeout: z.number().positive().optional(),
  autoCaptureLanguage: z.string().optional(),
  memoryProvider: z
    .enum(["openai-chat", "openai-responses", "anthropic", "google-gemini"])
    .optional(),
  memoryModel: z.string().optional(),
  memoryApiUrl: z.url().optional(),
  memoryApiKey: z.string().optional(),
  memoryTemperature: z.union([z.number(), z.literal(false)]).optional(),
  memoryExtraParams: z.record(z.string(), z.unknown()).optional(),
  opencodeProvider: z.string().optional(),
  opencodeModel: z.string().optional(),
  vectorBackend: z.enum(["usearch-first", "usearch", "exact-scan"]).optional(),
  aiSessionRetentionDays: z.number().positive().optional(),
  webServerEnabled: z.boolean().optional(),
  webServerPort: z.number().positive().max(65535).optional(),
  webServerHost: z.string().optional(),
  webServerApiKey: z.string().optional(),
  maxVectorsPerShard: z.number().positive().optional(),
  autoCleanupEnabled: z.boolean().optional(),
  autoCleanupRetentionDays: z.number().positive().optional(),
  deduplicationEnabled: z.boolean().optional(),
  deduplicationSimilarityThreshold: z.number().min(0).max(1).optional(),
  deduplicationIngestEnabled: z.boolean().optional(),
  userProfileAnalysisInterval: z.number().positive().optional(),
  userProfileMaxPreferences: z.number().positive().optional(),
  userProfileMaxPatterns: z.number().positive().optional(),
  userProfileMaxWorkflows: z.number().positive().optional(),
  userProfileConfidenceDecayDays: z.number().positive().optional(),
  userProfileChangelogRetentionCount: z.number().positive().optional(),
  showAutoCaptureToasts: z.boolean().optional(),
  showUserProfileToasts: z.boolean().optional(),
  showErrorToasts: z.boolean().optional(),
  transcriptStorage: z
    .object({
      enabled: z.boolean().optional(),
      maxAgeDays: z.number().positive().optional(),
    })
    .optional(),
  memoryScoring: z
    .object({
      enabled: z.boolean().optional(),
      recalculationIntervalMinutes: z.number().positive().optional(),
      recencyHalfLifeDays: z.number().positive().optional(),
      utilityHalfLifeDays: z.number().positive().optional(),
    })
    .optional(),
  memoryLifecycle: z
    .object({
      stmDecayDays: z.number().positive().optional(),
      ltmDecayDays: z.number().positive().optional(),
      promotionThreshold: z.number().min(0).max(1).optional(),
      archiveThreshold: z.number().min(0).max(1).optional(),
      archiveAfterDays: z.number().positive().optional(),
      checkIntervalMinutes: z.number().positive().optional(),
    })
    .optional(),
  compaction: z
    .object({
      enabled: z.boolean().optional(),
      memoryLimit: z.number().positive().optional(),
    })
    .optional(),
  chatMessage: z
    .object({
      enabled: z.boolean().optional(),
      maxMemories: z.number().positive().optional(),
      excludeCurrentSession: z.boolean().optional(),
      maxAgeDays: z.number().positive().optional(),
      injectOn: z.enum(["first", "always"]).optional(),
    })
    .optional(),
  retrieval: z
    .object({
      maxResults: z.number().positive().optional(),
      diversityThreshold: z.number().min(0).max(1).optional(),
      contextBoost: z.number().optional(),
    })
    .optional(),
  injection: z
    .object({
      tokenBudget: z.number().positive().optional(),
      format: z.enum(["plain", "xml", "yaml"]).optional(),
      queryAwareFiltering: z.boolean().optional(),
      relevanceThreshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
  contextualDecay: z
    .object({
      enabled: z.boolean().optional(),
      baseDecayRate: z.number().min(0).max(1).optional(),
      strengthBoostFactor: z.number().min(0).max(1).optional(),
      accessBoostFactor: z.number().min(0).max(1).optional(),
      minDecayRate: z.number().min(0).max(1).optional(),
      maxDecayRate: z.number().min(0).max(1).optional(),
    })
    .optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  warmupTimeoutMs: z.number().positive().optional(),
});

const DEFAULTS: Required<
  Omit<
    OpenCodeMemConfig,
    | "embeddingApiUrl"
    | "embeddingApiKey"
    | "memoryModel"
    | "memoryApiUrl"
    | "memoryApiKey"
    | "memoryProvider"
    | "memoryTemperature"
    | "memoryExtraParams"
    | "webServerApiKey"
    | "opencodeProvider"
    | "opencodeModel"
    | "autoCaptureLanguage"
    | "userEmailOverride"
    | "userNameOverride"
  >
> & {
  embeddingApiUrl?: string;
  embeddingApiKey?: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryProvider?: "openai-chat" | "openai-responses" | "anthropic" | "google-gemini";
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  vectorBackend?: "usearch-first" | "usearch" | "exact-scan";
  autoCaptureLanguage?: string;
  memory?: {
    defaultScope?: "project" | "all-projects";
  };
  injection?: {
    tokenBudget?: number;
    format?: "plain" | "xml" | "yaml";
    queryAwareFiltering?: boolean;
    relevanceThreshold?: number;
  };
} = {
  storagePath: join(DATA_DIR, "data"),
  embeddingModel: "Xenova/nomic-embed-text-v1",
  embeddingDimensions: 768,
  similarityThreshold: 0.6,
  maxMemories: 10,
  maxProfileItems: 5,
  injectProfile: true,
  containerTagPrefix: "opencode",
  autoCaptureEnabled: true,
  autoCaptureMaxIterations: 5,
  autoCaptureIterationTimeout: 30000,
  vectorBackend: "usearch-first",
  aiSessionRetentionDays: 7,
  webServerEnabled: true,
  webServerPort: 4747,
  webServerHost: "127.0.0.1",
  maxVectorsPerShard: 50000,
  autoCleanupEnabled: true,
  autoCleanupRetentionDays: 30,
  deduplicationEnabled: true,
  deduplicationSimilarityThreshold: 0.9,
  deduplicationIngestEnabled: true,
  userProfileAnalysisInterval: 10,
  userProfileMaxPreferences: 20,
  userProfileMaxPatterns: 15,
  userProfileMaxWorkflows: 10,
  userProfileConfidenceDecayDays: 30,
  userProfileChangelogRetentionCount: 5,
  showAutoCaptureToasts: true,
  showUserProfileToasts: true,
  showErrorToasts: true,
  memory: {
    defaultScope: "project",
  },
  transcriptStorage: {
    enabled: true,
    maxAgeDays: 30,
  },
  memoryScoring: {
    enabled: true,
    recalculationIntervalMinutes: 60,
    recencyHalfLifeDays: 7,
    utilityHalfLifeDays: 3,
  },
  memoryLifecycle: {
    stmDecayDays: 7,
    ltmDecayDays: 90,
    promotionThreshold: 0.7,
    archiveThreshold: 0.2,
    archiveAfterDays: 30,
    checkIntervalMinutes: 60,
  },
  compaction: {
    enabled: true,
    memoryLimit: 10,
  },
  chatMessage: {
    enabled: true,
    maxMemories: 3,
    excludeCurrentSession: true,
    injectOn: "first",
    maxAgeDays: undefined,
  },
  retrieval: {
    maxResults: 20,
    diversityThreshold: 0.9,
    contextBoost: 1.5,
  },
  injection: {
    tokenBudget: 4000,
    format: "plain",
    queryAwareFiltering: true,
    relevanceThreshold: 0.3,
  },
  contextualDecay: {
    enabled: true,
    baseDecayRate: 0.05,
    strengthBoostFactor: 0.5,
    accessBoostFactor: 0.3,
    minDecayRate: 0.005,
    maxDecayRate: 0.15,
  },
  logLevel: "info",
  warmupTimeoutMs: 30000,
};

// skipcq: JS-0067
function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

// skipcq: JS-0067
function loadConfigFromPaths(paths: string[]): OpenCodeMemConfig {
  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const json = stripJsoncComments(content);
        return JSON.parse(json) as OpenCodeMemConfig;
      } catch (error) {
        console.error(`Failed to load config from ${path}: ${error}`);
        throw new Error(`Config error in ${path}: ${error}`);
      }
    }
  }
  return {};
}

const CONFIG_TEMPLATE = `{
  // ============================================
  // OpenCode Memory Plugin Configuration
  // ============================================
  
  // Storage location for vector database
  "storagePath": "~/.opencode-mem0/data",

  "userEmailOverride": "",
  "userNameOverride": "",
  
  // ============================================
  // Embedding Model (for similarity search)
  // ============================================
  
  // Default: Nomic Embed v1 (768 dimensions, 8192 context, multilingual)
  "embeddingModel": "Xenova/nomic-embed-text-v1",
  
  // Auto-detected dimensions (no need to set manually)
  // "embeddingDimensions": 768,
  
  // Other recommended models:
  // "embeddingModel": "Xenova/jina-embeddings-v2-base-en",  // 768 dims, English-only, 8192 context
  // "embeddingModel": "Xenova/jina-embeddings-v2-small-en", // 512 dims, faster, 8192 context
  // "embeddingModel": "Xenova/all-MiniLM-L6-v2",            // 384 dims, very fast, 512 context
  // "embeddingModel": "Xenova/all-mpnet-base-v2",           // 768 dims, good quality, 512 context
  
  // Optional: Use OpenAI-compatible API for embeddings
  // "embeddingApiUrl": "https://api.openai.com/v1",
  // "embeddingApiKey": "sk-...",
  // "embeddingModel": "text-embedding-3-small",  // 1536 dims, auto-detected
  
  // ============================================
  // Web Server Settings
  // ============================================
  
  // Enable web UI for managing memories (accessible at http://localhost:4747)
  "webServerEnabled": true,
  
  // Port for web UI server
  "webServerPort": 4747,
  
  // Host address for web UI (use 127.0.0.1 for local only, 0.0.0.0 for network access)
  "webServerHost": "127.0.0.1",

  // Optional API key for non-localhost web UI access. Send as x-opencode-mem-key.
  // "webServerApiKey": "change-me",
   
  // ============================================
  // Database Settings
  // ============================================
  
  // Maximum vectors per database shard (auto-creates new shard when limit reached)
  "maxVectorsPerShard": 50000,
  
  // Automatically delete old memories based on retention period
  "autoCleanupEnabled": true,
  
  // Days to keep memories before auto-cleanup (only if autoCleanupEnabled is true)
  "autoCleanupRetentionDays": 30,
  
  // Automatically detect and remove duplicate memories
  "deduplicationEnabled": true,
  
   // Similarity threshold (0-1) for detecting duplicates (higher = stricter)
   "deduplicationSimilarityThreshold": 0.90,
   
  // ============================================
  // Memory Scope Settings
  // ============================================

  // Default scope for memory list/search queries
  // "project" keeps queries within the current project, "all-projects" searches across all project shards
  "memory": {
    "defaultScope": "project"
  },

  // ============================================
  // OpenCode Provider Settings (RECOMMENDED)
  // ============================================

   // Use opencode's already-configured providers for auto-capture and user profile learning.
   // When set, no separate API key is needed — uses your existing opencode authentication
   // (including Claude Pro/Max plans via OAuth, or any API key configured in opencode).
   //
   // If NOT set, falls back to the manual config (memoryApiKey/memoryApiUrl/memoryModel below).
   //
   // Examples:
   //   Anthropic (OAuth/API key): "opencodeProvider": "anthropic", "opencodeModel": "claude-haiku-4-5-20251001"
   //   OpenAI (API key):          "opencodeProvider": "openai",     "opencodeModel": "gpt-4o-mini"
   //
   // The provider name must match a connected provider in opencode (check with: opencode providers list)
   // "opencodeProvider": "anthropic",
   // "opencodeModel": "claude-haiku-4-5-20251001",

   // ============================================
   // Auto-Capture Settings (REQUIRES EXTERNAL API)
   // ============================================
  
  // IMPORTANT: Auto-capture ONLY works with external API
  // It runs in background without blocking your main session
  // Note: Ollama may not support tool calling. Use OpenAI, Anthropic, or Groq for best results.
  
  "autoCaptureEnabled": true,
  
  // Provider type: "openai-chat" | "openai-responses" | "anthropic"
  // Note: "openai-chat" is a generic OpenAI API-compatible mode.
  // Any service that follows the OpenAI Chat Completions API can use it via custom "memoryApiUrl".
  "memoryProvider": "openai-chat",
  
  // REQUIRED for auto-capture (all 3 must be set):
  "memoryModel": "gpt-4o-mini",
  "memoryApiUrl": "https://api.openai.com/v1",
  "memoryApiKey": "sk-...",

  // API Key Formats:
  // Direct value:        "sk-..."
  // From file:           "file://~/.config/litellm-key.txt"
  // From env variable:   "env://LITELLM_API_KEY"
  
  // Examples for different providers:
  // Any OpenAI-compatible endpoint can use the "openai-chat" provider pattern below.
  // Common examples: DeepSeek, Qwen (via Alibaba Cloud ModelStudio),
  // Zhipu GLM (BigModel platform), and Kimi (Moonshot AI platform).

  // OpenAI Chat Completion (default, backward compatible):
  //   "memoryProvider": "openai-chat"
  //   "memoryModel": "gpt-4o-mini"
  //   "memoryApiUrl": "https://api.openai.com/v1"
  //   "memoryApiKey": "sk-..."

  // DeepSeek (OpenAI-compatible example):
  //   "memoryProvider": "openai-chat"
  //   "memoryModel": "deepseek-chat"
  //   "memoryApiUrl": "https://api.deepseek.com/v1"
  //   "memoryApiKey": "sk-..."
  
  // OpenAI Responses API (recommended, with session support):
  //   "memoryProvider": "openai-responses"
  //   "memoryModel": "gpt-4o"
  //   "memoryApiUrl": "https://api.openai.com/v1"
  //   "memoryApiKey": "sk-..."
  
  // Anthropic (with session support):
  //   "memoryProvider": "anthropic"
  //   "memoryModel": "claude-3-5-haiku-20241022"
  //   "memoryApiUrl": "https://api.anthropic.com/v1"
  //   "memoryApiKey": "sk-ant-..."
  
  // Groq (OpenAI-compatible, use openai-chat provider):
  //   "memoryProvider": "openai-chat"
  //   "memoryModel": "llama-3.3-70b-versatile"
  //   "memoryApiUrl": "https://api.groq.com/openai/v1"
  //   "memoryApiKey": "gsk_..."
  
  // Maximum iterations for multi-turn AI analysis (for openai-responses and anthropic)
  "autoCaptureMaxIterations": 5,
   
  // Timeout per iteration in milliseconds (30 seconds default)
  "autoCaptureIterationTimeout": 30000,
   
  // Days to keep AI session history before cleanup
  "aiSessionRetentionDays": 7,

  // Temperature for AI API requests (set to false to omit parameter for models that don't support it)
  // Some reasoning models (like o1, o3, gpt-5) don't support temperature parameter
  // Set to false and add "memoryTemperature": false in config when using such models
  "memoryTemperature": 0.3,

  // Extra parameters to include in API request body
  // Useful for local inference servers (e.g. llama-server with --jinja) that support
  // additional parameters like disabling thinking/reasoning mode
  // Example for Qwen3 models: { "enable_thinking": false }
  // "memoryExtraParams": {},

  // Language for auto-capture summaries (default: "auto" for auto-detection)
  // Options: "auto", "en", "id", "zh", "ja", "es", "fr", "de", "ru", "pt", "ar", "ko"
  // "autoCaptureLanguage": "auto",

  // ============================================
  // Toast Notifications
  // ============================================

  // Show toast when memory is auto-captured
  "showAutoCaptureToasts": true,

  // Show toast when user profile is updated
  "showUserProfileToasts": true,

  // Show toast for error messages
  "showErrorToasts": true,

  // ============================================
  // User Profile System
  // ============================================

  // Analyze user prompts every N prompts to build/update your user profile
  // When N uncaptured prompts accumulate, AI will analyze them to identify:
  // - User preferences (code style, communication style, tool preferences)
  // - User patterns (recurring topics, problem domains, technical interests)
  // - User workflows (development habits, sequences, learning style)
  // - Skill level (overall and per-domain assessment)
  "userProfileAnalysisInterval": 10,
  
  // Maximum number of preferences to keep in user profile (sorted by confidence)
  // Preferences are things like "prefers code without comments", "likes concise responses"
  "userProfileMaxPreferences": 20,
  
  // Maximum number of patterns to keep in user profile (sorted by frequency)
  // Patterns are recurring topics like "often asks about database optimization"
  "userProfileMaxPatterns": 15,
  
  // Maximum number of workflows to keep in user profile (sorted by frequency)
  // Workflows are sequences like "usually asks for tests after implementation"
  "userProfileMaxWorkflows": 10,
  
  // Days before preference confidence starts to decay (if not reinforced)
  // Preferences that aren't seen again will gradually lose confidence and be removed
  "userProfileConfidenceDecayDays": 30,
  
  // Number of profile versions to keep in changelog (for rollback/debugging)
  // Older versions are automatically cleaned up
  "userProfileChangelogRetentionCount": 5,
  
  // ============================================
  // Search Settings
  // ============================================
  
  // Minimum similarity score (0-1) for memory search results
  "similarityThreshold": 0.6,

  // Maximum number of memories to return in search results
  "maxMemories": 10,

  // ============================================
  // ============================================
  // Transcript Storage Settings
  // ============================================

  // Automatically save full conversation transcripts for later review
  "transcriptStorage": {
    "enabled": true,
    "maxAgeDays": 30
  },

  // ============================================
  // Memory Scoring System
  // ============================================

  // Multi-dimensional memory scoring with automatic recalculation
  // Each memory gets scores for: recency, frequency, importance, utility,
  // novelty, confidence, and interference. These combine into a "strength"
  // score that determines search ranking and retention priority.
  "memoryScoring": {
    "enabled": true,
    "recalculationIntervalMinutes": 60,
    "recencyHalfLifeDays": 7,
    "utilityHalfLifeDays": 3
  },

  // ============================================
  // Memory Lifecycle (STM/LTM)
  // ============================================

  // Dual-store memory system with forgetting curve.
  // Memories are classified into Short-Term (STM) or Long-Term (LTM) on creation.
  // STM decays fast (decay_rate=0.05), LTM decays slow (decay_rate=0.01) or never (0.0).
  // High-strength, frequently-accessed STM memories get promoted to LTM.
  // Weak old memories are archived when strength drops below threshold.
  "memoryLifecycle": {
    "stmDecayDays": 7,
    "ltmDecayDays": 90,
    "promotionThreshold": 0.7,
    "archiveThreshold": 0.2,
    "archiveAfterDays": 30,
    "checkIntervalMinutes": 60
  },

  // ============================================
  // Advanced Settings
  // ============================================
  
  // ============================================
  // Intelligent Retrieval Settings
  // ============================================

  // Multi-factor memory retrieval with diversity filtering and context awareness.
  // Re-ranks results by strength (40%), recency (30%), and semantic similarity (30%).
  // Applies diversity penalty to avoid returning nearly identical memories.
  "retrieval": {
    // Maximum number of memories to return (overrides maxMemories for search)
    "maxResults": 20,
    // Diversity threshold: if similarity between two results > this, apply penalty
    // (0.9 = very strict, 0.7 = moderate, 0.5 = lenient)
    "diversityThreshold": 0.9,
    // Context boost multiplier: memories matching current project/files/queries
    // get multiplied by this factor (1.5 = 50% boost)
    "contextBoost": 1.5
  },

  // ============================================
  // Memory Injection Format
  // ============================================

  // Controls how memories are injected into the AI context.
  // - tokenBudget: max tokens for memory injection (default 4000)
  // - format: "plain" (- [92%] content), "xml" (<memory ...>), or "yaml" (- similarity: ...)
  // - queryAwareFiltering: analyze query intent and filter memories by relevance
  // - relevanceThreshold: minimum relevance score (0-1) to include a memory
  "injection": {
    "tokenBudget": 4000,
    "format": "plain",
    "queryAwareFiltering": true,
    "relevanceThreshold": 0.3
  },

  // Inject user profile into AI context (preferences, patterns, workflows)
  "injectProfile": true
}
`;

// skipcq: JS-0067
function ensureConfigExists(): void {
  const configPath = join(CONFIG_DIR, "opencode-mem0.jsonc");

  if (!existsSync(configPath)) {
    try {
      writeFileSync(configPath, CONFIG_TEMPLATE, { encoding: "utf-8", mode: 0o600 });
      log(`\n✓ Created config template: ${configPath}`);
      log("  Edit this file to customize opencode-mem0 settings.\n");
    } catch (err) {
      log("Failed to create config template", { error: String(err) });
    }
  }
}

ensureConfigExists();

// skipcq: JS-0067
function getEmbeddingDimensions(model: string): number {
  const dimensionMap: Record<string, number> = {
    // Local Xenova models
    "Xenova/nomic-embed-text-v1": 768,
    "Xenova/nomic-embed-text-v1-unsupervised": 768,
    "Xenova/nomic-embed-text-v1-ablated": 768,
    "Xenova/jina-embeddings-v2-base-en": 768,
    "Xenova/jina-embeddings-v2-base-zh": 768,
    "Xenova/jina-embeddings-v2-base-de": 768,
    "Xenova/jina-embeddings-v2-small-en": 512,
    "Xenova/all-MiniLM-L6-v2": 384,
    "Xenova/all-MiniLM-L12-v2": 384,
    "Xenova/all-mpnet-base-v2": 768,
    "Xenova/bge-base-en-v1.5": 768,
    "Xenova/bge-small-en-v1.5": 384,
    "Xenova/gte-small": 384,
    "Xenova/GIST-small-Embedding-v0": 384,
    "Xenova/text-embedding-ada-002": 1536,

    // OpenAI API models
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,

    // Cohere API models
    "embed-english-v3.0": 1024,
    "embed-multilingual-v3.0": 1024,
    "embed-english-light-v3.0": 384,
    "embed-multilingual-light-v3.0": 384,

    // Google API models
    "text-embedding-004": 768,
    "text-multilingual-embedding-002": 768,

    // Voyage AI models
    "voyage-3": 1024,
    "voyage-3-lite": 512,
    "voyage-code-3": 1024,
  };
  return dimensionMap[model] || 768;
}

// skipcq: JS-0067
function coalesce<T>(value: T | undefined, defaultValue: T): T {
  return value ?? defaultValue;
}

// skipcq: JS-0067
function buildMemoryConfig(f: OpenCodeMemConfig) {
  return { defaultScope: coalesce(f.memory?.defaultScope, DEFAULTS.memory.defaultScope) };
}

// skipcq: JS-0067
function buildCompactionConfig(f: OpenCodeMemConfig) {
  return {
    enabled: coalesce(f.compaction?.enabled, DEFAULTS.compaction.enabled),
    memoryLimit: coalesce(f.compaction?.memoryLimit, DEFAULTS.compaction.memoryLimit),
  };
}

// skipcq: JS-0067
function buildTranscriptConfig(f: OpenCodeMemConfig) {
  return {
    enabled: coalesce(f.transcriptStorage?.enabled, DEFAULTS.transcriptStorage.enabled),
    maxAgeDays: coalesce(f.transcriptStorage?.maxAgeDays, DEFAULTS.transcriptStorage.maxAgeDays),
  };
}

// skipcq: JS-0067
function buildScoringConfig(f: OpenCodeMemConfig) {
  return {
    enabled: coalesce(f.memoryScoring?.enabled, DEFAULTS.memoryScoring.enabled),
    recalculationIntervalMinutes: coalesce(
      f.memoryScoring?.recalculationIntervalMinutes,
      DEFAULTS.memoryScoring.recalculationIntervalMinutes
    ),
    recencyHalfLifeDays: coalesce(
      f.memoryScoring?.recencyHalfLifeDays,
      DEFAULTS.memoryScoring.recencyHalfLifeDays
    ),
    utilityHalfLifeDays: coalesce(
      f.memoryScoring?.utilityHalfLifeDays,
      DEFAULTS.memoryScoring.utilityHalfLifeDays
    ),
  };
}

// skipcq: JS-0067
function buildLifecycleConfig(f: OpenCodeMemConfig) {
  return {
    stmDecayDays: coalesce(f.memoryLifecycle?.stmDecayDays, DEFAULTS.memoryLifecycle.stmDecayDays),
    ltmDecayDays: coalesce(f.memoryLifecycle?.ltmDecayDays, DEFAULTS.memoryLifecycle.ltmDecayDays),
    promotionThreshold: coalesce(
      f.memoryLifecycle?.promotionThreshold,
      DEFAULTS.memoryLifecycle.promotionThreshold
    ),
    archiveThreshold: coalesce(
      f.memoryLifecycle?.archiveThreshold,
      DEFAULTS.memoryLifecycle.archiveThreshold
    ),
    archiveAfterDays: coalesce(
      f.memoryLifecycle?.archiveAfterDays,
      DEFAULTS.memoryLifecycle.archiveAfterDays
    ),
    checkIntervalMinutes: coalesce(
      f.memoryLifecycle?.checkIntervalMinutes,
      DEFAULTS.memoryLifecycle.checkIntervalMinutes
    ),
  };
}

// skipcq: JS-0067
function buildChatConfig(f: OpenCodeMemConfig) {
  return {
    enabled: coalesce(f.chatMessage?.enabled, DEFAULTS.chatMessage.enabled),
    maxMemories: coalesce(f.chatMessage?.maxMemories, DEFAULTS.chatMessage.maxMemories),
    excludeCurrentSession: coalesce(
      f.chatMessage?.excludeCurrentSession,
      DEFAULTS.chatMessage.excludeCurrentSession
    ),
    maxAgeDays: f.chatMessage?.maxAgeDays,
    injectOn: coalesce(f.chatMessage?.injectOn, DEFAULTS.chatMessage.injectOn) as
      | "first"
      | "always",
  };
}

// skipcq: JS-0067
function buildRetrievalConfig(f: OpenCodeMemConfig) {
  return {
    maxResults: coalesce(f.retrieval?.maxResults, DEFAULTS.retrieval.maxResults),
    diversityThreshold: coalesce(
      f.retrieval?.diversityThreshold,
      DEFAULTS.retrieval.diversityThreshold
    ),
    contextBoost: coalesce(f.retrieval?.contextBoost, DEFAULTS.retrieval.contextBoost),
  };
}

// skipcq: JS-0067
function buildInjectionConfig(f: OpenCodeMemConfig) {
  return {
    tokenBudget: coalesce(f.injection?.tokenBudget, DEFAULTS.injection.tokenBudget),
    format: coalesce(f.injection?.format, DEFAULTS.injection.format),
    queryAwareFiltering: coalesce(
      f.injection?.queryAwareFiltering,
      DEFAULTS.injection.queryAwareFiltering
    ),
    relevanceThreshold: coalesce(
      f.injection?.relevanceThreshold,
      DEFAULTS.injection.relevanceThreshold
    ),
  };
}

// skipcq: JS-0067
function buildDecayConfig(f: OpenCodeMemConfig) {
  return {
    enabled: coalesce(f.contextualDecay?.enabled, DEFAULTS.contextualDecay.enabled),
    baseDecayRate: coalesce(
      f.contextualDecay?.baseDecayRate,
      DEFAULTS.contextualDecay.baseDecayRate
    ),
    strengthBoostFactor: coalesce(
      f.contextualDecay?.strengthBoostFactor,
      DEFAULTS.contextualDecay.strengthBoostFactor
    ),
    accessBoostFactor: coalesce(
      f.contextualDecay?.accessBoostFactor,
      DEFAULTS.contextualDecay.accessBoostFactor
    ),
    minDecayRate: coalesce(f.contextualDecay?.minDecayRate, DEFAULTS.contextualDecay.minDecayRate),
    maxDecayRate: coalesce(f.contextualDecay?.maxDecayRate, DEFAULTS.contextualDecay.maxDecayRate),
  };
}

// skipcq: JS-0067
function mergeConfigWithDefaults(fileConfig: OpenCodeMemConfig) {
  const f = fileConfig;
  const d = DEFAULTS;
  return {
    storagePath: expandPath(coalesce(f.storagePath, d.storagePath)),
    userEmailOverride: f.userEmailOverride,
    userNameOverride: f.userNameOverride,
    embeddingModel: coalesce(f.embeddingModel, d.embeddingModel),
    embeddingDimensions: coalesce(
      f.embeddingDimensions,
      getEmbeddingDimensions(coalesce(f.embeddingModel, d.embeddingModel))
    ),
    embeddingApiUrl: f.embeddingApiUrl,
    embeddingApiKey: f.embeddingApiUrl
      ? resolveSecretValue(coalesce(f.embeddingApiKey, process.env.OPENAI_API_KEY))
      : undefined,
    similarityThreshold: coalesce(f.similarityThreshold, d.similarityThreshold),
    maxMemories: coalesce(f.maxMemories, d.maxMemories),
    maxProfileItems: coalesce(f.maxProfileItems, d.maxProfileItems),
    injectProfile: coalesce(f.injectProfile, d.injectProfile),
    containerTagPrefix: coalesce(f.containerTagPrefix, d.containerTagPrefix),
    autoCaptureEnabled: coalesce(f.autoCaptureEnabled, d.autoCaptureEnabled),
    autoCaptureMaxIterations: coalesce(f.autoCaptureMaxIterations, d.autoCaptureMaxIterations),
    autoCaptureIterationTimeout: coalesce(
      f.autoCaptureIterationTimeout,
      d.autoCaptureIterationTimeout
    ),
    autoCaptureLanguage: f.autoCaptureLanguage,
    memoryProvider: coalesce(f.memoryProvider, "openai-chat") as
      | "openai-chat"
      | "openai-responses"
      | "anthropic"
      | "google-gemini",
    memoryModel: f.memoryModel,
    memoryApiUrl: f.memoryApiUrl,
    memoryApiKey: resolveSecretValue(f.memoryApiKey),
    memoryTemperature: f.memoryTemperature,
    memoryExtraParams: f.memoryExtraParams,
    opencodeProvider: f.opencodeProvider,
    opencodeModel: f.opencodeModel,
    vectorBackend: coalesce(f.vectorBackend, "usearch-first") as
      | "usearch-first"
      | "usearch"
      | "exact-scan",
    aiSessionRetentionDays: coalesce(f.aiSessionRetentionDays, d.aiSessionRetentionDays),
    webServerEnabled: coalesce(f.webServerEnabled, d.webServerEnabled),
    webServerPort: coalesce(f.webServerPort, d.webServerPort),
    webServerHost: coalesce(f.webServerHost, d.webServerHost),
    webServerApiKey: f.webServerApiKey,
    maxVectorsPerShard: coalesce(f.maxVectorsPerShard, d.maxVectorsPerShard),
    autoCleanupEnabled: coalesce(f.autoCleanupEnabled, d.autoCleanupEnabled),
    autoCleanupRetentionDays: coalesce(f.autoCleanupRetentionDays, d.autoCleanupRetentionDays),
    deduplicationEnabled: coalesce(f.deduplicationEnabled, d.deduplicationEnabled),
    deduplicationSimilarityThreshold: coalesce(
      f.deduplicationSimilarityThreshold,
      d.deduplicationSimilarityThreshold
    ),
    deduplicationIngestEnabled: coalesce(f.deduplicationIngestEnabled, true),
    userProfileAnalysisInterval: coalesce(
      f.userProfileAnalysisInterval,
      d.userProfileAnalysisInterval
    ),
    userProfileMaxPreferences: coalesce(f.userProfileMaxPreferences, d.userProfileMaxPreferences),
    userProfileMaxPatterns: coalesce(f.userProfileMaxPatterns, d.userProfileMaxPatterns),
    userProfileMaxWorkflows: coalesce(f.userProfileMaxWorkflows, d.userProfileMaxWorkflows),
    userProfileConfidenceDecayDays: coalesce(
      f.userProfileConfidenceDecayDays,
      d.userProfileConfidenceDecayDays
    ),
    userProfileChangelogRetentionCount: coalesce(
      f.userProfileChangelogRetentionCount,
      d.userProfileChangelogRetentionCount
    ),
    showAutoCaptureToasts: coalesce(f.showAutoCaptureToasts, d.showAutoCaptureToasts),
    showUserProfileToasts: coalesce(f.showUserProfileToasts, d.showUserProfileToasts),
    showErrorToasts: coalesce(f.showErrorToasts, d.showErrorToasts),
    memory: buildMemoryConfig(f),
    compaction: buildCompactionConfig(f),
    transcriptStorage: buildTranscriptConfig(f),
    memoryScoring: buildScoringConfig(f),
    memoryLifecycle: buildLifecycleConfig(f),
    chatMessage: buildChatConfig(f),
    retrieval: buildRetrievalConfig(f),
    injection: buildInjectionConfig(f),
    contextualDecay: buildDecayConfig(f),
    logLevel: coalesce(f.logLevel, d.logLevel),
    warmupTimeoutMs: coalesce(f.warmupTimeoutMs, d.warmupTimeoutMs),
  };
}

// skipcq: JS-0067
function buildConfig(fileConfig: OpenCodeMemConfig) {
  const validation = OpenCodeMemConfigSchema.safeParse(fileConfig);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(`Invalid opencode-mem0 config: ${issues}`);
  }
  const result = mergeConfigWithDefaults(fileConfig);

  // Apply log level from config
  if (fileConfig.logLevel) {
    setLogLevel(fileConfig.logLevel);
  }

  return result;
}

const _globalFileConfig = loadConfigFromPaths(CONFIG_FILES);
export const CONFIG = buildConfig(_globalFileConfig);

if (!existsSync(CONFIG.storagePath)) {
  mkdirSync(CONFIG.storagePath, { recursive: true });
}

// skipcq: JS-0067
function isPlainObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// skipcq: JS-0067
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key];
    if (srcVal === undefined) continue;
    if (isPlainObject(srcVal) && isPlainObject(result[key as string])) {
      result[key as string] = deepMerge(result[key as string] as object, srcVal as object);
    } else {
      result[key as string] = srcVal;
    }
  }
  return result as T;
}

// skipcq: JS-0067
export function initConfig(directory: string): void {
  const projectPaths = [
    join(directory, ".opencode", "opencode-mem0.jsonc"),
    join(directory, ".opencode", "opencode-mem0.json"),
  ];
  const globalConfig = loadConfigFromPaths(CONFIG_FILES);
  const projectConfig = loadConfigFromPaths(projectPaths);
  const merged = deepMerge(globalConfig, projectConfig);
  Object.assign(CONFIG, buildConfig(merged));
}

// skipcq: JS-0067
export function isConfigured(): boolean {
  return Boolean(_globalFileConfig) && existsSync(CONFIG.storagePath);
}
