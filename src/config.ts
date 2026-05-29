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
  maxProfileItems?: number;
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
  memoryProvider?: AIProviderType;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  vectorBackend?: VectorBackendConfig;
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
  return { defaultScope: f.memory?.defaultScope ?? DEFAULTS.memory.defaultScope };
}

function buildCompactionConfig(f: OpenCodeMemConfig) {
  return {
    enabled: f.compaction?.enabled ?? DEFAULTS.compaction.enabled,
    memoryLimit: f.compaction?.memoryLimit ?? DEFAULTS.compaction.memoryLimit,
  };
}

function buildTranscriptConfig(f: OpenCodeMemConfig) {
  return {
    enabled: f.transcriptStorage?.enabled ?? DEFAULTS.transcriptStorage.enabled,
    maxAgeDays: f.transcriptStorage?.maxAgeDays ?? DEFAULTS.transcriptStorage.maxAgeDays,
  };
}

function buildScoringConfig(f: OpenCodeMemConfig) {
  return {
    enabled: f.memoryScoring?.enabled ?? DEFAULTS.memoryScoring.enabled,
    recalculationIntervalMinutes:
      f.memoryScoring?.recalculationIntervalMinutes ??
      DEFAULTS.memoryScoring.recalculationIntervalMinutes,
    recalculationBatchSize:
      f.memoryScoring?.recalculationBatchSize ?? DEFAULTS.memoryScoring.recalculationBatchSize,
    recencyHalfLifeDays:
      f.memoryScoring?.recencyHalfLifeDays ?? DEFAULTS.memoryScoring.recencyHalfLifeDays,
    utilityHalfLifeDays:
      f.memoryScoring?.utilityHalfLifeDays ?? DEFAULTS.memoryScoring.utilityHalfLifeDays,
  };
}

function buildLifecycleConfig(f: OpenCodeMemConfig) {
  return {
    stmDecayDays: f.memoryLifecycle?.stmDecayDays ?? DEFAULTS.memoryLifecycle.stmDecayDays,
    ltmDecayDays: f.memoryLifecycle?.ltmDecayDays ?? DEFAULTS.memoryLifecycle.ltmDecayDays,
    promotionThreshold:
      f.memoryLifecycle?.promotionThreshold ?? DEFAULTS.memoryLifecycle.promotionThreshold,
    archiveThreshold:
      f.memoryLifecycle?.archiveThreshold ?? DEFAULTS.memoryLifecycle.archiveThreshold,
    archiveAfterDays:
      f.memoryLifecycle?.archiveAfterDays ?? DEFAULTS.memoryLifecycle.archiveAfterDays,
    checkIntervalMinutes:
      f.memoryLifecycle?.checkIntervalMinutes ?? DEFAULTS.memoryLifecycle.checkIntervalMinutes,
  };
}

function buildChatConfig(f: OpenCodeMemConfig) {
  return {
    enabled: f.chatMessage?.enabled ?? DEFAULTS.chatMessage.enabled,
    maxMemories: f.chatMessage?.maxMemories ?? DEFAULTS.chatMessage.maxMemories,
    excludeCurrentSession:
      f.chatMessage?.excludeCurrentSession ?? DEFAULTS.chatMessage.excludeCurrentSession,
    maxAgeDays: f.chatMessage?.maxAgeDays,
    injectOn: (f.chatMessage?.injectOn ?? DEFAULTS.chatMessage.injectOn) as "first" | "always",
    mode: (f.chatMessage?.mode ?? DEFAULTS.chatMessage.mode) as "relevant" | "fast",
  };
}

function buildRetrievalConfig(f: OpenCodeMemConfig) {
  return {
    maxResults: f.retrieval?.maxResults ?? DEFAULTS.retrieval.maxResults,
    diversityThreshold: f.retrieval?.diversityThreshold ?? DEFAULTS.retrieval.diversityThreshold,
    contextBoost: f.retrieval?.contextBoost ?? DEFAULTS.retrieval.contextBoost,
  };
}

function buildInjectionConfig(f: OpenCodeMemConfig) {
  return {
    tokenBudget: f.injection?.tokenBudget ?? DEFAULTS.injection.tokenBudget,
    format: f.injection?.format ?? DEFAULTS.injection.format,
    queryAwareFiltering: f.injection?.queryAwareFiltering ?? DEFAULTS.injection.queryAwareFiltering,
    relevanceThreshold: f.injection?.relevanceThreshold ?? DEFAULTS.injection.relevanceThreshold,
  };
}

function buildDecayConfig(f: OpenCodeMemConfig) {
  return {
    enabled: f.contextualDecay?.enabled ?? DEFAULTS.contextualDecay.enabled,
    baseDecayRate: f.contextualDecay?.baseDecayRate ?? DEFAULTS.contextualDecay.baseDecayRate,
    strengthBoostFactor:
      f.contextualDecay?.strengthBoostFactor ?? DEFAULTS.contextualDecay.strengthBoostFactor,
    accessBoostFactor:
      f.contextualDecay?.accessBoostFactor ?? DEFAULTS.contextualDecay.accessBoostFactor,
    minDecayRate: f.contextualDecay?.minDecayRate ?? DEFAULTS.contextualDecay.minDecayRate,
    maxDecayRate: f.contextualDecay?.maxDecayRate ?? DEFAULTS.contextualDecay.maxDecayRate,
  };
}

function mergeConfigWithDefaults(fileConfig: OpenCodeMemConfig) {
  const cfg = fileConfig;
  const defaults = DEFAULTS;
  return {
    storagePath: expandPath(cfg.storagePath ?? defaults.storagePath),
    userEmailOverride: cfg.userEmailOverride,
    userNameOverride: cfg.userNameOverride,
    embeddingModel: cfg.embeddingModel ?? defaults.embeddingModel,
    embeddingDimensions:
      cfg.embeddingDimensions ??
      getEmbeddingDimensions(cfg.embeddingModel ?? defaults.embeddingModel),
    embeddingApiUrl: cfg.embeddingApiUrl,
    embeddingApiKey: cfg.embeddingApiUrl
      ? resolveSecretValue(cfg.embeddingApiKey ?? process.env.OPENAI_API_KEY)
      : undefined,
    similarityThreshold: cfg.similarityThreshold ?? defaults.similarityThreshold,
    maxMemories: cfg.maxMemories ?? defaults.maxMemories,
    maxProfileItems: cfg.maxProfileItems ?? defaults.maxProfileItems,
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
  const merged = deepMerge(globalConfig, projectConfig);
  Object.assign(CONFIG, buildConfig(merged));
}

export function isConfigured(): boolean {
  return Boolean(_globalFileConfig) && existsSync(CONFIG.storagePath);
}
