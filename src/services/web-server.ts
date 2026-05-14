import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { serve, type PlatformServer } from "./platform-server.js";
import {
  handleListTags,
  handleListMemories,
  handleAddMemory,
  handleDeleteMemory,
  handleBulkDelete,
  handleUpdateMemory,
  handleSearch,
  handleStats,
  handlePinMemory,
  handleUnpinMemory,
  handleRunCleanup,
  handleRunDeduplication,
  handleDetectMigration,
  handleRunMigration,
  handleDetectTagMigration,
  handleRunTagMigrationBatch,
  handleGetTagMigrationProgress,
  handleDeletePrompt,
  handleBulkDeletePrompts,
  handleGetUserProfile,
  handleGetProfileChangelog,
  handleGetProfileSnapshot,
  handleRefreshProfile,
  handleListConflicts,
  handleResolveConflict,
  handleConflictStats,
  handleEmbeddingCacheStats,
} from "./api-handlers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const SENSITIVE_KEYS = new Set([
  "userEmail",
  "displayName",
  "userName",
  "projectPath",
  "projectName",
  "gitRepoUrl",
  "userId",
]);

interface WebServerConfig {
  port: number;
  host: string;
  enabled: boolean;
  apiKey?: string;
}

export class WebServer {
  private server: PlatformServer | null = null;
  private readonly config: WebServerConfig;
  private isOwner: boolean = false;
  private startPromise: Promise<void> | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private onTakeoverCallback: (() => Promise<void>) | null = null;

  constructor(config: WebServerConfig) {
    this.config = config;
  }

  setOnTakeoverCallback(callback: () => Promise<void>): void {
    this.onTakeoverCallback = callback;
  }

  start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this._start();
    return this.startPromise;
  }

  private async _start(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      this.server = await serve({
        port: this.config.port,
        hostname: this.config.host,
        fetch: this.handleRequest.bind(this),
      });
      this.isOwner = true;
    } catch (error) {
      const errorMsg = String(error);

      if (
        errorMsg.includes("EADDRINUSE") ||
        errorMsg.includes("address already in use") ||
        /Failed to start server.*Is port \d+ in use/.test(errorMsg)
      ) {
        this.isOwner = false;
        this.server = null;
        this.startHealthCheckLoop();
      } else {
        this.isOwner = false;
        this.server = null;
        log("Web server failed to start", { error: errorMsg });
        throw error;
      }
    }
  }

  private startHealthCheckLoop(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(async () => {
      const isAvailable = await this.checkServerAvailable();

      if (!isAvailable) {
        this.stopHealthCheckLoop();
        await this.attemptTakeover();
      }
    }, 5000);
  }

  private stopHealthCheckLoop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async attemptTakeover(): Promise<void> {
    // prevent thundering herd: multiple non-owners racing to bind port
    const jitterMs = randomInt(500, 1501);
    await new Promise((resolve) => setTimeout(resolve, jitterMs));

    if (await this.checkServerAvailable()) {
      this.startHealthCheckLoop();
      return;
    }

    try {
      // Reset startPromise so _start() can run again
      this.startPromise = null;
      await this._start();

      if (this.isOwner) {
        log("Web server takeover successful", { port: this.config.port });

        if (this.onTakeoverCallback) {
          try {
            await this.onTakeoverCallback();
          } catch (error) {
            log("Takeover callback error", { error: String(error) });
          }
        }
      }
    } catch (error) {
      log("Web server startup error", { error: String(error) });
      this.startHealthCheckLoop();
    }
  }

  stop(): void {
    this.stopHealthCheckLoop();
    this.startPromise = null;

    if (!this.isOwner || !this.server) {
      return;
    }

    this.server.stop();
    this.server = null;
    this.isOwner = false;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  isServerOwner(): boolean {
    return this.isOwner;
  }

  getUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  async checkServerAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const response = await fetch(`${this.getUrl()}/api/stats`, {
          method: "GET",
          signal: controller.signal,
        });
        return response.ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }

  // --- HTTP request handling ---

  private redactPII(obj: any): any {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.redactPII(item));

    const newObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(key)) {
        newObj[key] = value !== undefined && value !== null && value !== "" ? "[REDACTED]" : value;
      } else if (typeof value === "object") {
        newObj[key] = this.redactPII(value);
      } else {
        newObj[key] = value;
      }
    }
    return newObj;
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      const requiresAuth = Boolean(this.config.apiKey);
      const remoteIp = this.server?.requestIP(req)?.address;
      const isLocal = remoteIp ? LOCAL_HOSTS.has(remoteIp) : false;

      if (requiresAuth && req.headers.get("x-opencode-mem-key") !== this.config.apiKey) {
        return this.jsonResponse({ success: false, error: "Unauthorized" }, 401);
      }

      const staticResponse = this._tryServeStatic(path);
      if (staticResponse) return staticResponse;

      return await this._dispatchApiRoute(req, url, path, method, isLocal);
    } catch (error) {
      log("Web server request error", {
        path: url.pathname,
        method,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.jsonResponse(
        {
          success: false,
          error: "Internal server error",
        },
        500
      );
    }
  }

  private _tryServeStatic(path: string): Response | null {
    const staticMap: Record<string, [string, string]> = {
      "/": ["index.html", "text/html"],
      "/index.html": ["index.html", "text/html"],
      "/styles.css": ["styles.css", "text/css"],
      "/app.js": ["app.js", "application/javascript"],
      "/i18n.js": ["i18n.js", "application/javascript"],
      "/favicon.ico": ["favicon.ico", "image/x-icon"],
    };
    const entry = staticMap[path];
    if (entry) {
      return this.serveStaticFile(entry[0], entry[1]);
    }
    return null;
  }

  private async _dispatchApiRoute(
    req: Request,
    url: URL,
    path: string,
    method: string,
    isLocal: boolean
  ): Promise<Response> {
    const route = `${method} ${path}`;

    switch (route) {
      case "GET /api/tags":
        return await this._apiListTags(isLocal);
      case "GET /api/memories":
        return await this._apiListMemories(url, isLocal);
      case "POST /api/memories":
        return await this._apiAddMemory(req, isLocal);
      case "POST /api/memories/bulk-delete":
        return await this._apiBulkDeleteMemories(req, isLocal);
      case "GET /api/search":
        return await this._apiSearch(url, isLocal);
      case "GET /api/stats":
        return await this._apiStats(isLocal);
      case "GET /api/embedding-cache":
        return await this._apiEmbeddingCacheStats(isLocal);
      case "GET /api/conflicts":
        return await this._apiListConflicts(url, isLocal);
      case "GET /api/conflicts/stats":
        return await this._apiConflictStats(isLocal);
      case "POST /api/cleanup":
        return await this._apiCleanup(isLocal);
      case "POST /api/deduplicate":
        return await this._apiDeduplicate(isLocal);
      case "GET /api/migration/detect":
        return await this._apiDetectMigration(isLocal);
      case "GET /api/migration/tags/detect":
        return await this._apiDetectTagMigration(isLocal);
      case "POST /api/migration/tags/run-batch":
        return await this._apiRunTagMigration(req, isLocal);
      case "GET /api/migration/tags/progress":
        return await this._apiTagMigrationProgress(isLocal);
      case "POST /api/migration/run":
        return await this._apiRunMigration(req, isLocal);
      case "GET /api/user-profile":
        return await this._apiGetUserProfile(url, isLocal);
      case "GET /api/user-profile/changelog":
        return await this._apiGetProfileChangelog(url, isLocal);
      case "GET /api/user-profile/snapshot":
        return await this._apiGetProfileSnapshot(url, isLocal);
      case "POST /api/user-profile/refresh":
        return await this._apiRefreshProfile(req, isLocal);
      case "POST /api/prompts/bulk-delete":
        return await this._apiBulkDeletePrompts(req, isLocal);
      default:
        break;
    }

    // Parameterized routes
    if (method === "DELETE" && path.startsWith("/api/memories/")) {
      return await this._apiDeleteMemory(url, path, isLocal);
    }
    if (method === "PUT" && path.startsWith("/api/memories/")) {
      return await this._apiUpdateMemory(req, path, isLocal);
    }
    if (method === "POST" && /^\/api\/memories\/[^/]+\/pin$/.test(path)) {
      return await this._apiPinMemory(path, isLocal);
    }
    if (method === "POST" && /^\/api\/memories\/[^/]+\/unpin$/.test(path)) {
      return await this._apiUnpinMemory(path, isLocal);
    }
    if (method === "POST" && path.startsWith("/api/conflicts/")) {
      return await this._apiResolveConflict(req, path, isLocal);
    }
    if (method === "DELETE" && path.startsWith("/api/prompts/")) {
      return await this._apiDeletePrompt(url, path, isLocal);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async _apiListTags(isLocal: boolean): Promise<Response> {
    const result = await handleListTags();
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiListMemories(url: URL, isLocal: boolean): Promise<Response> {
    const tag = url.searchParams.get("tag") || undefined;
    const rawPage = Number.parseInt(url.searchParams.get("page") || "1");
    const rawPageSize = Number.parseInt(url.searchParams.get("pageSize") || "20");
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10000) : 1;
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= 100 ? rawPageSize : 20;
    const includePrompts = url.searchParams.get("includePrompts") !== "false";
    const result = await handleListMemories(tag, page, pageSize, includePrompts);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiAddMemory(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json()) as any;
    const result = await handleAddMemory(body);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiDeleteMemory(url: URL, path: string, isLocal: boolean): Promise<Response> {
    const parts = path.split("/");
    const id = parts[3];
    if (!id || id === "bulk-delete") {
      return this.jsonResponse({ success: false, error: "Invalid ID" });
    }
    const cascade = url.searchParams.get("cascade") === "true";
    const result = await handleDeleteMemory(id, cascade);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiUpdateMemory(req: Request, path: string, isLocal: boolean): Promise<Response> {
    const putParts = path.split("/");
    if (putParts.length !== 4 || !putParts[3]) {
      return this.jsonResponse({ success: false, error: "Invalid ID" });
    }
    const id = putParts[3];
    const body = (await req.json()) as any;
    const result = await handleUpdateMemory(id, body);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiBulkDeleteMemories(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json()) as any;
    const cascade = body.cascade !== false;
    const result = await handleBulkDelete(body.ids || [], cascade);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiSearch(url: URL, isLocal: boolean): Promise<Response> {
    const query = url.searchParams.get("q");
    const tag = url.searchParams.get("tag") || undefined;
    const rawPage = Number.parseInt(url.searchParams.get("page") || "1");
    const rawPageSize = Number.parseInt(url.searchParams.get("pageSize") || "20");
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10000) : 1;
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= 100 ? rawPageSize : 20;

    if (!query) {
      return this.jsonResponse({ success: false, error: "query parameter required" });
    }

    const result = await handleSearch(query, tag, page, pageSize);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiStats(isLocal: boolean): Promise<Response> {
    const result = handleStats();
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiEmbeddingCacheStats(isLocal: boolean): Promise<Response> {
    const result = handleEmbeddingCacheStats();
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiListConflicts(url: URL, isLocal: boolean): Promise<Response> {
    const resolved = url.searchParams.get("resolved") === "true";
    const limit = Number.parseInt(url.searchParams.get("limit") || "100");
    const result = handleListConflicts(resolved, limit);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiConflictStats(isLocal: boolean): Promise<Response> {
    const result = handleConflictStats();
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiResolveConflict(
    req: Request,
    path: string,
    isLocal: boolean
  ): Promise<Response> {
    const parts = path.split("/");
    const conflictId = parts[3];
    if (!conflictId || conflictId === "stats") {
      return this.jsonResponse({ success: false, error: "Invalid conflict ID" });
    }
    const body = (await req.json().catch(() => ({}))) as any;
    const result = await handleResolveConflict(conflictId, body.strategy, body.mergedContent);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiPinMemory(path: string, isLocal: boolean): Promise<Response> {
    const id = path.split("/")[3];
    if (!id) {
      return this.jsonResponse({ success: false, error: "Invalid ID" });
    }
    const result = handlePinMemory(id);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiUnpinMemory(path: string, isLocal: boolean): Promise<Response> {
    const id = path.split("/")[3];
    if (!id) {
      return this.jsonResponse({ success: false, error: "Invalid ID" });
    }
    const result = handleUnpinMemory(id);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiCleanup(isLocal: boolean): Promise<Response> {
    const result = await handleRunCleanup();
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiDeduplicate(isLocal: boolean): Promise<Response> {
    const result = await handleRunDeduplication();
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiDetectMigration(isLocal: boolean): Promise<Response> {
    const result = await handleDetectMigration();
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiDetectTagMigration(isLocal: boolean): Promise<Response> {
    const result = handleDetectTagMigration();
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiRunTagMigration(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json()) as any;
    const batchSize = body?.batchSize || 5;
    const result = await handleRunTagMigrationBatch(batchSize);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiTagMigrationProgress(isLocal: boolean): Promise<Response> {
    const result = handleGetTagMigrationProgress();
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiRunMigration(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json()) as any;
    const strategy = body.strategy || "fresh-start";
    if (strategy !== "fresh-start" && strategy !== "re-embed") {
      return this.jsonResponse({ success: false, error: "Invalid strategy" });
    }
    const result = await handleRunMigration(strategy);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiDeletePrompt(url: URL, path: string, isLocal: boolean): Promise<Response> {
    const parts = path.split("/");
    const id = parts[3];
    if (!id || id === "bulk-delete") {
      return this.jsonResponse({ success: false, error: "Invalid ID" });
    }
    const cascade = url.searchParams.get("cascade") === "true";
    const result = await handleDeletePrompt(id, cascade);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiBulkDeletePrompts(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json()) as any;
    const cascade = body.cascade !== false;
    const result = await handleBulkDeletePrompts(body.ids || [], cascade);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiGetUserProfile(url: URL, isLocal: boolean): Promise<Response> {
    const userId = url.searchParams.get("userId") || undefined;
    const result = await handleGetUserProfile(userId);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiGetProfileChangelog(url: URL, isLocal: boolean): Promise<Response> {
    const profileId = url.searchParams.get("profileId");
    const limit = Number.parseInt(url.searchParams.get("limit") || "5");
    if (!profileId) {
      return this.jsonResponse({ success: false, error: "profileId parameter required" });
    }
    const result = await handleGetProfileChangelog(profileId, limit);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiGetProfileSnapshot(url: URL, isLocal: boolean): Promise<Response> {
    const changelogId = url.searchParams.get("changelogId") ?? url.searchParams.get("chlogId");
    if (!changelogId) {
      return this.jsonResponse({ success: false, error: "changelogId parameter required" });
    }
    const result = await handleGetProfileSnapshot(changelogId);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiRefreshProfile(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as any;
    const userId = body.userId || undefined;
    const result = await handleRefreshProfile(userId);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private serveStaticFile(filename: string, contentType: string): Response {
    const webDir = join(__dirname, "..", "web");
    const filePath = join(webDir, filename);
    try {
      if (contentType.startsWith("image/")) {
        const content = readFileSync(filePath);
        return new Response(content, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      const content = readFileSync(filePath, "utf-8");

      return new Response(content, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      });
    } catch (error) {
      log("Static file serve error", { path: filePath, error: String(error) });
      return new Response("File not found", { status: 404 });
    }
  }

  private jsonResponse(data: any, status: number = 200, redact: boolean = false): Response {
    const finalData = redact ? this.redactPII(data) : data;
    return new Response(JSON.stringify(finalData), {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}

export async function startWebServer(config: WebServerConfig): Promise<WebServer> {
  const server = new WebServer(config);
  await server.start();
  return server;
}
