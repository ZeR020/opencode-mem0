/** Known tech debt (2026-05-29 audit): 85+ 'as' casts on SQL results from bun:sqlite .all() returning unknown[]. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stripJsoncComments } from "./services/jsonc.js";
import { resolveSecretValue } from "./services/secret-resolver.js";
import { log, setLogLevel } from "./services/logger.js";
import { z } from "zod";
import { type AIProviderType } from "./types/index.js";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const DATA_DIR = join(homedir(), ".opencode-mem0");
const CONFIG_FILES = [
  join(CONFIG_DIR, "opencode-mem0.jsonc"),
  join(CONFIG_DIR, "opencode-mem0.json"),
];

export type VectorBackendConfig = "usearch-first" | "usearch" | "exact-scan";

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
  injectProfile?: boolean;
  containerTagPrefix?: string;
  autoCaptureEnabled?: boolean;
  autoCaptureMaxIterations?: number;
  autoCaptureIterationTimeout?: number;
  autoCaptureLanguage?: string;
  memoryProvider?: AIProviderType;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  vectorBackend?: VectorBackendConfig;
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
    recalculationBatchSize?: number;
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
    decayBatchSize?: number;
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
    mode?: "relevant" | "fast";
  };
  retrieval?: {
    maxResults?: number;
    diversityThreshold?: number;
    contextBoost?: number;
  };
  injection?: {
    tokenBudget?: number;
    format?: "plain" | "xml" | "yaml";
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
  rateLimitEnabled?: boolean;
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
      recalculationBatchSize: z.number().positive().optional(),
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
      decayBatchSize: z.number().positive().optional(),
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
      mode: z.enum(["fast", "relevant"]).optional(),
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
  rateLimitEnabled: z.boolean().optional(),
});

// DEFAULTS uses Partial<OpenCodeMemConfig> for simplicity. The object literal
// guarantees every key is populated, so non-null assertions in build helpers
// below are safe — they assert against the Partial type, not runtime nulls.
const DEFAULTS: Partial<OpenCodeMemConfig> = {
  storagePath: join(DATA_DIR, "data"),
  embeddingModel: "Xenova/nomic-embed-text-v1",
  embeddingDimensions: 768,
  similarityThreshold: 0.6,
  maxMemories: 10,
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
    recalculationBatchSize: 500,
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
    decayBatchSize: 5000,
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
    mode: "relevant",
  },
  retrieval: {
    maxResults: 20,
    diversityThreshold: 0.9,
    contextBoost: 1.5,
  },
  injection: {
    tokenBudget: 4000,
    format: "plain",
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
  rateLimitEnabled: true,
};

function expandPath(path: string): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path === "~" ? homedir() : path;
}

function loadConfigFromPaths(paths: string[]): OpenCodeMemConfig {
  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const json = stripJsoncComments(content);
        return JSON.parse(json) as OpenCodeMemConfig;
      } catch (error) {
        log(`Failed to load config from ${path}: ${error}`, { level: "error" });
        throw new Error(`Config error in ${path}: ${error}`);
      }
    }
  }
  return {};
}

function getEmbeddingDimensions(model: string): number {
  const dimensionMap: Record<string, number> = {
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
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
    "embed-english-v3.0": 1024,
    "embed-multilingual-v3.0": 1024,
    "embed-english-light-v3.0": 384,
    "embed-multilingual-light-v3.0": 384,
    "text-embedding-004": 768,
    "text-multilingual-embedding-002": 768,
    "voyage-3": 1024,
    "voyage-3-lite": 512,
    "voyage-code-3": 1024,
  };
  return dimensionMap[model] || 768;
}

function buildMemoryConfig(f: OpenCodeMemConfig) {
  const D = DEFAULTS as Required<OpenCodeMemConfig>;
  return { defaultScope: f.memory?.defaultScope ?? D.memory!.defaultScope };
}

function buildCompactionConfig(f: OpenCodeMemConfig) {
  const D = DEFAULTS as Required<OpenCodeMemConfig>;
  return {
    enabled: f.compaction?.enabled ?? D.compaction!.enabled,
    memoryLimit: f.compaction?.memoryLimit ?? D.compaction!.memoryLimit,
  };
}

function buildTranscriptConfig(f: OpenCodeMemConfig) {
  const D = DEFAULTS as Required<OpenCodeMemConfig>;
  return {
    enabled: f.transcriptStorage?.enabled ?? D.transcriptStorage!.enabled,
    maxAgeDays: f.transcriptStorage?.maxAgeDays ?? D.transcriptStorage!.maxAgeDays,
  };
}

function buildScoringConfig(f: OpenCodeMemConfig) {
  const D = DEFAULTS as Required<OpenCodeMemConfig>;
  return {
    enabled: f.memoryScoring?.enabled ?? D.memoryScoring!.enabled,
    recalculationIntervalMinutes:
      f.memoryScoring?.recalculationIntervalMinutes ??
      D.memoryScoring!.recalculationIntervalMinutes,
    recalculationBatchSize:
      f.memoryScoring?.recalculationBatchSize ?? D.memoryScoring!.recalculationBatchSize,
    recencyHalfLifeDays:
      f.memoryScoring?.recencyHalfLifeDays ?? D.memoryScoring!.recencyHalfLifeDays,
    utilityHalfLifeDays:
      f.memoryScoring?.utilityHalfLifeDays ?? D.memoryScoring!.utilityHalfLifeDays,
  };
}

function buildLifecycleConfig(f: OpenCodeMemConfig) {
  const D = DEFAULTS as Required<OpenCodeMemConfig>;
  return {
    stmDecayDays: f.memoryLifecycle?.stmDecayDays ?? D.memoryLifecycle!.stmDecayDays,
    ltmDecayDays: f.memoryLifecycle?.ltmDecayDays ?? D.memoryLifecycle!.ltmDecayDays,
    promotionThreshold:
      f.memoryLifecycle?.promotionThreshold ?? D.memoryLifecycle!.promotionThreshold,
    archiveThreshold: f.memoryLifecycle?.archiveThreshold ?? D.memoryLifecycle!.archiveThreshold,
    archiveAfterDays: f.memoryLifecycle?.archiveAfterDays ?? D.memoryLifecycle!.archiveAfterDays,
    checkIntervalMinutes:
      f.memoryLifecycle?.checkIntervalMinutes ?? D.memoryLifecycle!.checkIntervalMinutes,
    decayBatchSize: f.memoryLifecycle?.decayBatchSize ?? D.memoryLifecycle!.decayBatchSize,
  };
}

function buildChatConfig(f: OpenCodeMemConfig) {
  const D = DEFAULTS as Required<OpenCodeMemConfig>;
  return {
    enabled: f.chatMessage?.enabled ?? D.chatMessage!.enabled,
    maxMemories: f.chatMessage?.maxMemories ?? D.chatMessage!.maxMemories,
    excludeCurrentSession:
      f.chatMessage?.excludeCurrentSession ?? D.chatMessage!.excludeCurrentSession,
    maxAgeDays: f.chatMessage?.maxAgeDays,
    injectOn: (f.chatMessage?.injectOn ?? D.chatMessage!.injectOn) as "first" | "always",
    mode: (f.chatMessage?.mode ?? D.chatMessage!.mode) as "relevant" | "fast",
  };
}

function buildRetrievalConfig(f: OpenCodeMemConfig) {
  const D = DEFAULTS as Required<OpenCodeMemConfig>;
  return {
    maxResults: f.retrieval?.maxResults ?? D.retrieval!.maxResults,
    diversityThreshold: f.retrieval?.diversityThreshold ?? D.retrieval!.diversityThreshold,
    contextBoost: f.retrieval?.contextBoost ?? D.retrieval!.contextBoost,
  };
}

function buildInjectionConfig(f: OpenCodeMemConfig) {
  const D = DEFAULTS as Required<OpenCodeMemConfig>;
  return {
    tokenBudget: f.injection?.tokenBudget ?? D.injection!.tokenBudget,
    format: f.injection?.format ?? D.injection!.format,
    relevanceThreshold: f.injection?.relevanceThreshold ?? D.injection!.relevanceThreshold,
  };
}

function buildDecayConfig(f: OpenCodeMemConfig) {
  const D = DEFAULTS as Required<OpenCodeMemConfig>;
  return {
    enabled: f.contextualDecay?.enabled ?? D.contextualDecay!.enabled,
    baseDecayRate: f.contextualDecay?.baseDecayRate ?? D.contextualDecay!.baseDecayRate,
    strengthBoostFactor:
      f.contextualDecay?.strengthBoostFactor ?? D.contextualDecay!.strengthBoostFactor,
    accessBoostFactor: f.contextualDecay?.accessBoostFactor ?? D.contextualDecay!.accessBoostFactor,
    minDecayRate: f.contextualDecay?.minDecayRate ?? D.contextualDecay!.minDecayRate,
    maxDecayRate: f.contextualDecay?.maxDecayRate ?? D.contextualDecay!.maxDecayRate,
  };
}

function mergeConfigWithDefaults(fileConfig: OpenCodeMemConfig) {
  const cfg = fileConfig;
  const defaults = DEFAULTS as Required<OpenCodeMemConfig>;
  return {
    storagePath: expandPath(cfg.storagePath ?? defaults.storagePath),
    userEmailOverride: cfg.userEmailOverride,
    userNameOverride: cfg.userNameOverride,
    embeddingModel: cfg.embeddingModel ?? defaults.embeddingModel,
    embeddingDimensions:
      cfg.embeddingDimensions ??
      getEmbeddingDimensions(cfg.embeddingModel ?? defaults.embeddingModel),
    embeddingApiUrl: cfg.embeddingApiUrl,
    embeddingApiKey: cfg.embeddingApiKey
      ? resolveSecretValue(cfg.embeddingApiKey)
      : resolveSecretValue(process.env.OPENAI_API_KEY),
    similarityThreshold: cfg.similarityThreshold ?? defaults.similarityThreshold,
    maxMemories: cfg.maxMemories ?? defaults.maxMemories,
    injectProfile: cfg.injectProfile ?? defaults.injectProfile,
    containerTagPrefix: cfg.containerTagPrefix ?? defaults.containerTagPrefix,
    autoCaptureEnabled: cfg.autoCaptureEnabled ?? defaults.autoCaptureEnabled,
    autoCaptureMaxIterations: cfg.autoCaptureMaxIterations ?? defaults.autoCaptureMaxIterations,
    autoCaptureIterationTimeout:
      cfg.autoCaptureIterationTimeout ?? defaults.autoCaptureIterationTimeout,
    autoCaptureLanguage: cfg.autoCaptureLanguage,
    memoryProvider: (cfg.memoryProvider ?? "openai-chat") as AIProviderType,
    memoryModel: cfg.memoryModel,
    memoryApiUrl: cfg.memoryApiUrl,
    memoryApiKey: resolveSecretValue(cfg.memoryApiKey),
    memoryTemperature: cfg.memoryTemperature,
    memoryExtraParams: cfg.memoryExtraParams,
    opencodeProvider: cfg.opencodeProvider,
    opencodeModel: cfg.opencodeModel,
    vectorBackend: (cfg.vectorBackend ?? "usearch-first") as VectorBackendConfig,
    aiSessionRetentionDays: cfg.aiSessionRetentionDays ?? defaults.aiSessionRetentionDays,
    webServerEnabled: cfg.webServerEnabled ?? defaults.webServerEnabled,
    webServerPort: cfg.webServerPort ?? defaults.webServerPort,
    webServerHost: cfg.webServerHost ?? defaults.webServerHost,
    webServerApiKey: cfg.webServerApiKey,
    maxVectorsPerShard: cfg.maxVectorsPerShard ?? defaults.maxVectorsPerShard,
    autoCleanupEnabled: cfg.autoCleanupEnabled ?? defaults.autoCleanupEnabled,
    autoCleanupRetentionDays: cfg.autoCleanupRetentionDays ?? defaults.autoCleanupRetentionDays,
    deduplicationEnabled: cfg.deduplicationEnabled ?? defaults.deduplicationEnabled,
    deduplicationSimilarityThreshold:
      cfg.deduplicationSimilarityThreshold ?? defaults.deduplicationSimilarityThreshold,
    deduplicationIngestEnabled: cfg.deduplicationIngestEnabled ?? true,
    userProfileAnalysisInterval:
      cfg.userProfileAnalysisInterval ?? defaults.userProfileAnalysisInterval,
    userProfileMaxPreferences: cfg.userProfileMaxPreferences ?? defaults.userProfileMaxPreferences,
    userProfileMaxPatterns: cfg.userProfileMaxPatterns ?? defaults.userProfileMaxPatterns,
    userProfileMaxWorkflows: cfg.userProfileMaxWorkflows ?? defaults.userProfileMaxWorkflows,
    userProfileConfidenceDecayDays:
      cfg.userProfileConfidenceDecayDays ?? defaults.userProfileConfidenceDecayDays,
    userProfileChangelogRetentionCount:
      cfg.userProfileChangelogRetentionCount ?? defaults.userProfileChangelogRetentionCount,
    showAutoCaptureToasts: cfg.showAutoCaptureToasts ?? defaults.showAutoCaptureToasts,
    showUserProfileToasts: cfg.showUserProfileToasts ?? defaults.showUserProfileToasts,
    showErrorToasts: cfg.showErrorToasts ?? defaults.showErrorToasts,
    memory: buildMemoryConfig(cfg),
    compaction: buildCompactionConfig(cfg),
    transcriptStorage: buildTranscriptConfig(cfg),
    memoryScoring: buildScoringConfig(cfg),
    memoryLifecycle: buildLifecycleConfig(cfg),
    chatMessage: buildChatConfig(cfg),
    retrieval: buildRetrievalConfig(cfg),
    injection: buildInjectionConfig(cfg),
    contextualDecay: buildDecayConfig(cfg),
    logLevel: cfg.logLevel ?? defaults.logLevel,
    warmupTimeoutMs: cfg.warmupTimeoutMs ?? defaults.warmupTimeoutMs,
    rateLimitEnabled: cfg.rateLimitEnabled ?? defaults.rateLimitEnabled,
  };
}

function buildConfig(fileConfig: OpenCodeMemConfig) {
  const validation = OpenCodeMemConfigSchema.safeParse(fileConfig);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(`Invalid opencode-mem0 config: ${issues}`);
  }
  const result = mergeConfigWithDefaults(fileConfig);

  if (fileConfig.logLevel) {
    setLogLevel(fileConfig.logLevel);
  }

  return result;
}

const _globalFileConfig = loadConfigFromPaths(CONFIG_FILES);

/**
 * Global CONFIG singleton — resolves from opencode-mem0.json and env.
 * TODO (future refactor): Replace with dependency injection so services
 * can be tested without global mutable state. See deferred item in
 * .planning/phases/04-code-audit-bug-fixes/04-CONTEXT.md.
 */
export const CONFIG = buildConfig(_globalFileConfig);

function isPlainObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export function initConfig(directory: string): void {
  const projectPaths = [
    join(directory, ".opencode", "opencode-mem0.jsonc"),
    join(directory, ".opencode", "opencode-mem0.json"),
  ];
  const globalConfig = loadConfigFromPaths(CONFIG_FILES);
  const projectConfig = loadConfigFromPaths(projectPaths);

  // Guard: if neither config source loaded (transient I/O failure), preserve
  // the existing CONFIG from module-level init instead of rebuilding from defaults.
  if (Object.keys(globalConfig).length === 0 && Object.keys(projectConfig).length === 0) {
    return;
  }

  const merged = deepMerge(globalConfig, projectConfig);
  Object.assign(CONFIG, buildConfig(merged));
}

export function isConfigured(): boolean {
  return Boolean(_globalFileConfig) && existsSync(CONFIG.storagePath);
}
