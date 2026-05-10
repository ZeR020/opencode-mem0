import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";
import { tool } from "@opencode-ai/plugin";

import { memoryClient } from "./services/client.js";
import { formatContextForPrompt } from "./services/context.js";
import { getTags } from "./services/tags.js";
import { stripPrivateContent, isFullyPrivate } from "./services/privacy.js";
import { performAutoCapture } from "./services/auto-capture.js";
import { performUserProfileLearning } from "./services/user-memory-learning.js";
import { userPromptManager } from "./services/user-prompt/user-prompt-manager.js";
import { performTranscriptCapture, cleanupOldTranscripts } from "./services/transcript-capture.js";
import { startWebServer, WebServer } from "./services/web-server.js";
import { safeJSONParse } from "./services/utils/safe-transforms.js";
import {
  startScoringRecalculation,
  stopScoringRecalculation,
  runOneTimeScoringRecalculation,
} from "./services/memory-scoring-service.js";
import {
  startLifecycleJob,
  stopLifecycleJob,
  runLifecycleMaintenance,
} from "./services/memory-lifecycle.js";
import { AIProviderFactory } from "./services/ai/ai-provider-factory.js";
import { embeddingService } from "./services/embedding.js";

import { isConfigured, CONFIG, initConfig } from "./config.js";
import { log } from "./services/logger.js";
import type { MemoryType } from "./types/index.js";
import { getLanguageName } from "./services/language-detector.js";
import type { MemoryScope } from "./services/client.js";

const helpResponseCache = new Map<string, string>();
const MAX_HELP_CACHE = 20;

function getHelpResponse(langName: string): string {
  let cached = helpResponseCache.get(langName);
  if (cached) return cached;

  cached = JSON.stringify({
    success: true,
    message: "Memory System Usage Guide",
    commands: [
      {
        command: "add",
        description: `Store new memory (MATCH USER LANGUAGE: ${langName})`,
        args: ["content", "type?", "tags?"],
      },
      {
        command: "search",
        description: `Search memories via keywords (MATCH USER LANGUAGE: ${langName})`,
        args: ["query"],
      },
      {
        command: "profile",
        description: "View user profile or save an explicit preference (provide content to write)",
        args: ["content?"],
      },
      { command: "list", description: "List recent memories", args: ["limit?"] },
      { command: "forget", description: "Remove memory", args: ["memoryId"] },
    ],
    tagGuidance: "Use technical keywords for search. Tags rank highest.",
  });
  if (helpResponseCache.size >= MAX_HELP_CACHE) {
    const firstKey = helpResponseCache.keys().next().value;
    if (firstKey !== undefined) helpResponseCache.delete(firstKey);
  }
  helpResponseCache.set(langName, cached);
  return cached;
}

export const OpenCodeMemPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  initConfig(directory);
  const tags = getTags(directory);
  let webServer: WebServer | null = null;
  const sessionIdleTimers = new Map<string, NodeJS.Timeout>();

  // Periodic sweep to prevent leaks if sessions end without firing idle timers
  const sessionIdleSweep = setInterval(() => {
    sessionIdleTimers.forEach((timer, sessionID) => {
      // Timers that have already fired are deleted in the finally block,
      // so any remaining entries are pending. Nothing to do here unless
      // we add a session-end event in the future.
    });
    // Keep the Map size bounded by clearing if it grows unexpectedly large
    if (sessionIdleTimers.size > 10000) {
      log("sessionIdleTimers exceeded 10k entries — clearing all pending timers");
      sessionIdleTimers.forEach((timer) => clearTimeout(timer));
      sessionIdleTimers.clear();
    }
  }, 3600_000);

  const GLOBAL_PLUGIN_WARMUP_KEY = Symbol.for("opencode-mem0.plugin.warmedup");

  if (!(globalThis as any)[GLOBAL_PLUGIN_WARMUP_KEY] && isConfigured()) {
    try {
      const timeoutMs = CONFIG.warmupTimeoutMs ?? 30000;
      await Promise.race([
        memoryClient.warmup(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Warmup timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      (globalThis as any)[GLOBAL_PLUGIN_WARMUP_KEY] = true;
    } catch (error) {
      log("Plugin warmup failed", { error: String(error) });
      if (error instanceof Error && error.message.includes("timed out")) {
        embeddingService.embeddingAvailable = false;
        log(
          "Embedding model warmup timed out — marking embeddings unavailable. Searches will use text-only fallback."
        );
      }
    }
  }

  // Wire opencode state path and provider list — fire-and-forget to avoid blocking init
  // These calls can hang if opencode isn't fully bootstrapped yet
  (async () => {
    try {
      const { setStatePath, setConnectedProviders } =
        await import("./services/ai/opencode-provider.js");
      const pathResult = await ctx.client.path.get();
      if (pathResult.data?.state) {
        setStatePath(pathResult.data.state);
      }
      const providerResult = await ctx.client.provider.list();
      if (providerResult.data?.connected) {
        setConnectedProviders(providerResult.data.connected);
      }
    } catch (error) {
      log("Failed to initialize opencode provider state", { error: String(error) });
    }
  })();

  if (CONFIG.webServerEnabled) {
    startWebServer({
      port: CONFIG.webServerPort,
      host: CONFIG.webServerHost,
      enabled: CONFIG.webServerEnabled,
      apiKey: CONFIG.webServerApiKey,
    })
      .then((server) => {
        webServer = server;
        const url = webServer.getUrl();

        webServer.setOnTakeoverCallback(async () => {
          try {
            if (ctx.client?.tui) {
              await ctx.client.tui
                .showToast({
                  body: {
                    title: "Memory Explorer",
                    message: "Took over web server ownership",
                    variant: "success",
                    duration: 3000,
                  },
                })
                .catch((err) => log("Toast display failed", { error: String(err) }));
            }
          } catch (err) {
            log("Toast display failed", { error: String(err) });
          }
        });

        if (webServer.isServerOwner()) {
          if (ctx.client?.tui) {
            ctx.client.tui
              .showToast({
                body: {
                  title: "Memory Explorer",
                  message: `Web UI started at ${url}`,
                  variant: "success",
                  duration: 5000,
                },
              })
              .catch((err) => log("Toast display failed", { error: String(err) }));
          }
        } else {
          if (ctx.client?.tui) {
            ctx.client.tui
              .showToast({
                body: {
                  title: "Memory Explorer",
                  message: `Web UI available at ${url}`,
                  variant: "info",
                  duration: 3000,
                },
              })
              .catch((err) => log("Toast display failed", { error: String(err) }));
          }
        }
      })
      .catch((error) => {
        log("Web server failed to start", { error: String(error) });

        try {
          if (ctx.client?.tui) {
            ctx.client.tui
              .showToast({
                body: {
                  title: "Memory Explorer Error",
                  message: `Failed to start: ${String(error)}`,
                  variant: "error",
                  duration: 5000,
                },
              })
              .catch((err) => log("Toast display failed", { error: String(err) }));
          }
        } catch (err) {
          log("Toast display failed", { error: String(err) });
        }
      });
  }

  // Start background memory scoring recalculation
  if (CONFIG.memoryScoring.enabled) {
    startScoringRecalculation();
    // Run one-time recalculation on startup to ensure existing memories are scored
    runOneTimeScoringRecalculation().catch((error) => {
      log("Initial scoring recalculation failed", { error: String(error) });
    });
  }

  // Start memory lifecycle job (STM/LTM decay, promotion, archiving)
  startLifecycleJob();
  // Run initial lifecycle maintenance on startup
  runLifecycleMaintenance().catch((error) => {
    log("Initial lifecycle maintenance failed", { error: String(error) });
  });

  // Start cleanup schedule for expired sessions
  AIProviderFactory.startCleanupSchedule(3600 * 1000);

  const shutdownHandler = async () => {
    try {
      clearInterval(sessionIdleSweep);
      stopScoringRecalculation();
      stopLifecycleJob();
      AIProviderFactory.stopCleanupSchedule();
      if (webServer) {
        await webServer.stop();
      }
      memoryClient.close();
      // Do not call process.exit(); let the host decide.
    } catch (error) {
      log("Shutdown error", { error: String(error) });
    }
  };

  // Expose shutdown handler for host to call explicitly
  (globalThis as any)[Symbol.for("opencode-mem0.shutdown")] = shutdownHandler;

  return {
    "chat.message": async (input, output) => {
      if (!isConfigured() || !CONFIG.chatMessage.enabled) return;

      try {
        const textParts = output.parts.filter(
          (p): p is Part & { type: "text"; text: string } => p.type === "text"
        );

        if (textParts.length === 0) return;
        const userMessage = textParts.map((p) => p.text).join("\n");
        if (!userMessage.trim()) return;

        try {
          userPromptManager.savePrompt(input.sessionID, output.message.id, directory, userMessage);
        } catch (error) {
          log("Failed to save user prompt", { error: String(error) });
        }

        const messagesResponse = await ctx.client.session.messages({
          path: { id: input.sessionID },
        });
        const messages = messagesResponse.data || [];

        const hasNonSyntheticUserMessages = messages.some(
          (m) =>
            m.info.role === "user" &&
            !m.parts.every((p) => p.type !== "text" || p.synthetic === true)
        );

        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        const isAfterCompaction = lastMessage?.info?.summary === true;

        const shouldInject =
          CONFIG.chatMessage.injectOn === "always" ||
          !hasNonSyntheticUserMessages ||
          (isAfterCompaction &&
            messages.filter(
              (m) =>
                m.info.role === "user" &&
                !m.parts.every((p) => p.type !== "text" || p.synthetic === true)
            ).length === 1);

        if (!shouldInject) return;

        const listResult = await memoryClient.listMemories(
          tags.project.tag,
          CONFIG.chatMessage.maxMemories
        );

        let memories = listResult.success ? listResult.memories : [];

        if (CONFIG.chatMessage.excludeCurrentSession) {
          memories = memories.filter((m: any) => m.metadata?.sessionID !== input.sessionID);
        }

        if (CONFIG.chatMessage.maxAgeDays) {
          const cutoffDate = Date.now() - CONFIG.chatMessage.maxAgeDays * 86400000;
          memories = memories.filter((m: any) => new Date(m.createdAt).getTime() > cutoffDate);
        }

        if (memories.length === 0) return;

        const projectMemories = {
          results: memories.map((m: any) => ({
            similarity: 1.0,
            memory: m.summary,
          })),
          total: memories.length,
          timing: 0,
        };

        const userId = tags.user.userEmail || null;
        const memoryContext = formatContextForPrompt(userId, projectMemories, {
          query: userMessage,
          format: CONFIG.injection?.format,
          tokenBudget: CONFIG.injection?.tokenBudget,
        });

        if (memoryContext) {
          const contextPart: Part = {
            id: `prt-memory-context-${Date.now()}`,
            sessionID: input.sessionID,
            messageID: output.message.id,
            type: "text",
            text: memoryContext,
            synthetic: true,
          } as any;
          output.parts.unshift(contextPart);
        }
      } catch (error) {
        log("chat.message: ERROR", { error: String(error) });
        if (ctx.client?.tui && CONFIG.showErrorToasts) {
          await ctx.client.tui
            .showToast({
              body: {
                title: "Memory System Error",
                message: String(error),
                variant: "error",
                duration: 5000,
              },
            })
            .catch((err) => log("Toast display failed", { error: String(err) }));
        }
      }
    },

    tool: {
      memory: tool({
        description: `Manage and query project memory (MATCH USER LANGUAGE: ${getLanguageName(CONFIG.autoCaptureLanguage || "en")}). Use 'search' with technical keywords/tags, 'add' to store knowledge, 'profile' for preferences. Search/list scope: project or all-projects.`,
        args: {
          mode: tool.schema.enum(["add", "search", "profile", "list", "forget", "help"]).optional(),
          content: tool.schema.string().optional(),
          query: tool.schema.string().optional(),
          tags: tool.schema.string().optional(),
          type: tool.schema.string().optional(),
          memoryId: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
          scope: tool.schema.enum(["project", "all-projects"]).optional(),
        },
        async execute(
          args: {
            mode?: "add" | "search" | "profile" | "list" | "forget" | "help";
            content?: string;
            query?: string;
            tags?: string;
            type?: MemoryType;
            memoryId?: string;
            limit?: number;
            scope?: MemoryScope;
          },
          toolCtx: { sessionID: string }
        ) {
          if (!isConfigured()) {
            return JSON.stringify({
              success: false,
              error: "Memory system not configured properly.",
            });
          }

          const needsWarmup = !(await memoryClient.isReady());
          if (needsWarmup) {
            return JSON.stringify({ success: false, error: "Memory system is initializing." });
          }

          const mode = args.mode || "help";
          const langName = getLanguageName(CONFIG.autoCaptureLanguage || "en");

          try {
            switch (mode) {
              case "help":
                return getHelpResponse(langName);

              case "add":
                if (!args.content)
                  return JSON.stringify({ success: false, error: "content required" });
                const sanitizedContent = stripPrivateContent(args.content);
                if (isFullyPrivate(args.content))
                  return JSON.stringify({ success: false, error: "Private content blocked" });
                const tagInfo = tags.project;
                const parsedTags = args.tags
                  ? args.tags.split(",").map((t) => t.trim().toLowerCase())
                  : undefined;
                const result = await memoryClient.addMemory(sanitizedContent, tagInfo.tag, {
                  type: args.type,
                  tags: parsedTags,
                  displayName: tagInfo.displayName,
                  userName: tagInfo.userName,
                  userEmail: tagInfo.userEmail,
                  projectPath: tagInfo.projectPath,
                  projectName: tagInfo.projectName,
                  gitRepoUrl: tagInfo.gitRepoUrl,
                });
                return JSON.stringify({
                  success: result.success,
                  message: `Memory added`,
                  id: result.id,
                  tags: parsedTags,
                });

              case "search":
                if (!args.query) return JSON.stringify({ success: false, error: "query required" });
                const searchRes = await memoryClient.searchMemories(
                  args.query,
                  tags.project.tag,
                  args.scope ?? CONFIG.memory.defaultScope
                );
                if (!searchRes.success)
                  return JSON.stringify({ success: false, error: searchRes.error });
                if (searchRes.degraded && ctx.client?.tui && CONFIG.showErrorToasts) {
                  await ctx.client.tui
                    .showToast({
                      body: {
                        title: "Memory Search Degraded",
                        message:
                          "Embedding model unavailable — using text-only search. Results may be less accurate.",
                        variant: "warning",
                        duration: 5000,
                      },
                    })
                    .catch((err) => log("Toast display failed", { error: String(err) }));
                }
                return formatSearchResults(args.query, searchRes, args.limit);

              case "profile": {
                if (args.query) {
                  return JSON.stringify({
                    success: false,
                    error:
                      "query is not valid for profile mode. Use content to write a preference or omit all args to read.",
                  });
                }

                const { userProfileManager } =
                  await import("./services/user-profile/user-profile-manager.js");

                const userId = tags.user.userEmail || "unknown";

                // --- WRITE: explicit preference ---
                if (args.content !== undefined) {
                  const trimmed = args.content.trim();
                  if (!trimmed) {
                    return JSON.stringify({ success: false, error: "content must not be blank" });
                  }

                  if (!tags.user.userEmail) {
                    return JSON.stringify({
                      success: false,
                      error:
                        "Cannot save profile preference because no user email could be resolved. Configure userEmailOverride or git user.email.",
                    });
                  }

                  const sanitizedContent = stripPrivateContent(trimmed);
                  const hasNonPrivateContent =
                    sanitizedContent.replace(/\[REDACTED\]/g, "").trim().length > 0;

                  if (isFullyPrivate(trimmed) || !hasNonPrivateContent) {
                    return JSON.stringify({ success: false, error: "Private content blocked" });
                  }

                  const newPreference = {
                    category: "explicit",
                    description: sanitizedContent,
                    confidence: 1.0,
                    evidence: ["manual-write"],
                    lastUpdated: Date.now(),
                  };

                  const existingProfile = userProfileManager.getActiveProfile(userId);

                  if (existingProfile) {
                    const existingData = safeJSONParse(existingProfile.profileData) as any;
                    const mergedData = userProfileManager.mergeProfileData(existingData, {
                      preferences: [newPreference],
                    });
                    userProfileManager.updateProfile(
                      existingProfile.id,
                      mergedData,
                      0,
                      `Explicit preference added: ${sanitizedContent.slice(0, 80)}`
                    );
                    return JSON.stringify({
                      success: true,
                      message: "Preference saved to profile",
                    });
                  } else {
                    userProfileManager.createProfile(
                      userId,
                      tags.user.displayName || userId,
                      tags.user.userName || userId,
                      tags.user.userEmail || userId,
                      { preferences: [newPreference], patterns: [], workflows: [] },
                      0
                    );
                    return JSON.stringify({
                      success: true,
                      message: "Profile created with preference",
                    });
                  }
                }

                // --- READ: no content provided ---
                const profile = userProfileManager.getActiveProfile(userId);
                if (!profile) return JSON.stringify({ success: true, profile: null });
                const pData = safeJSONParse(profile.profileData) as any;
                return JSON.stringify({
                  success: true,
                  profile: {
                    ...pData,
                    version: profile.version,
                    lastAnalyzed: profile.lastAnalyzedAt,
                  },
                });
              }

              case "list":
                const listRes = await memoryClient.listMemories(
                  tags.project.tag,
                  args.limit || 20,
                  args.scope ?? CONFIG.memory.defaultScope
                );
                if (!listRes.success)
                  return JSON.stringify({ success: false, error: listRes.error });
                return JSON.stringify({
                  success: true,
                  count: listRes.memories?.length,
                  memories: listRes.memories?.map((m: any) => ({
                    id: m.id,
                    content: m.summary,
                    createdAt: m.createdAt,
                  })),
                });

              case "forget":
                if (!args.memoryId)
                  return JSON.stringify({ success: false, error: "memoryId required" });
                const delRes = await memoryClient.deleteMemory(args.memoryId);
                return JSON.stringify({ success: delRes.success, message: `Memory removed` });

              default:
                return JSON.stringify({ success: false, error: `Unknown mode: ${mode}` });
            }
          } catch (error) {
            return JSON.stringify({ success: false, error: String(error) });
          }
        },
      }),
    },

    event: async (input: { event: { type: string; properties?: any } }) => {
      const event = input.event;
      if (event.type === "session.idle") {
        if (!isConfigured() || !CONFIG.autoCaptureEnabled) return;
        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;

        const existing = sessionIdleTimers.get(sessionID);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
          try {
            await performAutoCapture(ctx, sessionID, directory);

            if (webServer?.isServerOwner()) {
              await performUserProfileLearning(ctx, directory);
              const { cleanupService } = await import("./services/cleanup-service.js");
              if (await cleanupService.shouldRunCleanup()) await cleanupService.runCleanup();
              await cleanupOldTranscripts();
              const { connectionManager } = await import("./services/sqlite/connection-manager.js");
              connectionManager.checkpointAll();
            }
          } catch (error) {
            log("Idle processing error", { error: String(error) });
          } finally {
            sessionIdleTimers.delete(sessionID);
          }
        }, 10000);
        sessionIdleTimers.set(sessionID, timer);
      }

      if (event.type === "session.compacted") {
        if (!isConfigured() || !CONFIG.compaction.enabled) return;

        const sessionID = event.properties?.sessionID;
        if (!sessionID) return;

        try {
          const tags = getTags(directory);

          const memoriesResult = await memoryClient.searchMemoriesBySessionID(
            sessionID,
            tags.project.tag,
            CONFIG.compaction.memoryLimit
          );

          if (!memoriesResult.success || memoriesResult.results.length === 0) {
            return;
          }

          const memoryContext = formatMemoriesForCompaction(memoriesResult.results);

          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              parts: [{ id: `prt-compaction-${Date.now()}`, type: "text", text: memoryContext }],
              noReply: true,
            },
          });

          if (ctx.client?.tui) {
            await ctx.client.tui
              .showToast({
                body: {
                  title: "Memory Restored",
                  message: `${memoriesResult.results.length} memories injected after compaction`,
                  variant: "success",
                  duration: 3000,
                },
              })
              .catch((err) => log("Toast display failed", { error: String(err) }));
          }

          log("Compaction memory injected", {
            sessionID,
            count: memoriesResult.results.length,
          });
        } catch (error) {
          log("Compaction handler error", { error: String(error) });
        }
      }
    },
  };
};

function formatSearchResults(query: string, results: any, limit?: number): string {
  const memoryResults = results.results || [];
  return JSON.stringify({
    success: true,
    query,
    count: memoryResults.length,
    results: memoryResults.slice(0, limit || 10).map((r: any) => {
      let sim = Math.round(r.similarity * 100);
      if (sim > 100) sim = 100;
      if (sim < 0) sim = 0;
      return {
        id: r.id,
        content: r.memory || r.chunk,
        similarity: sim,
      };
    }),
  });
}

function formatMemoriesForCompaction(memories: any[]): string {
  const sections: string[] = ["## Restored Session Memory\n"];

  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    sections.push(`### Memory ${i + 1}`);
    sections.push(m.memory);
    if (m.tags && m.tags.length > 0) {
      sections.push(`Tags: ${m.tags.join(", ")}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}
