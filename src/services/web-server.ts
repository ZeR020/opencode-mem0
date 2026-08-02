import { readFileSync } from "node:fs";
import { randomInt, timingSafeEqual } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { serve, type PlatformServer } from "./platform-server.js";
import { CONFIG } from "../config.js";
import type { UserProfileData } from "./user-profile/types.js";
import {
  handleListTags,
  handleListMemories,
  handleGetMemory,
  handleAddMemory,
  handleDeleteMemory,
  handleBulkDelete,
  handleUpdateMemory,
  handleSearch,
  handleSearchTranscripts,
  handleListTranscripts,
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
  handleUpdateUserProfile,
  handleGetProfileChangelog,
  handleGetProfileSnapshot,
  handleRefreshProfile,
  handleListConflicts,
  handleGetConflict,
  handleResolveConflict,
  handleConflictStats,
  handleEmbeddingCacheStats,
  handleApiStatus,
  handleGetConfig,
  handleUpdateConfig,
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

function isLoopbackHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim().toLowerCase());
}

export class WebServer {
  private server: PlatformServer | null = null;
  private readonly config: WebServerConfig;
  private isOwner = false;
  private startPromise: Promise<void> | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private onTakeoverCallback: (() => Promise<void>) | null = null;
  private _currentRequestProtocol: string | null = null;
  private rateLimitBuckets = new Map<string, { tokens: number; lastRefill: number }>();

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

    if (!this.config.apiKey && !isLoopbackHost(this.config.host)) {
      throw new Error("webServerApiKey is required when webServerHost is not loopback");
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
        const response = await fetch(`${this.getUrl()}/api/health`, {
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

  private redactPII(obj: unknown): unknown {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.redactPII(item));

    const newObj: Record<string, unknown> = {};
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

    this._currentRequestProtocol = url.protocol;

    try {
      const remoteIp = this.server?.requestIP(req)?.address;
      const isLocal = remoteIp ? LOCAL_HOSTS.has(remoteIp) : false;

      const staticResponse = this._tryServeStatic(path);
      if (staticResponse) return staticResponse;

      if (path === "/api/health") {
        return this.jsonResponse(handleApiStatus(), 200, !isLocal);
      }

      if (this.config.apiKey && !this._isAuthorized(req)) {
        return this.jsonResponse({ success: false, error: "Unauthorized" }, 401);
      }

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
      "/theme-bootstrap.js": ["theme-bootstrap.js", "application/javascript"],
      "/vendor/lucide.min.js": ["vendor/lucide.min.js", "application/javascript"],
      "/vendor/marked.min.js": ["vendor/marked.min.js", "application/javascript"],
      "/vendor/dompurify.min.js": ["vendor/dompurify.min.js", "application/javascript"],
      "/favicon.svg": ["favicon.svg", "image/svg+xml"],
    };
    const entry = staticMap[path];
    if (entry) {
      return this.serveStaticFile(entry[0], entry[1]);
    }
    return null;
  }

  private _isAuthorized(req: Request): boolean {
    const apiKey = this.config.apiKey;
    if (!apiKey) return false;
    const headerKey = req.headers.get("x-opencode-mem-key") ?? "";
    const bearerKey = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    const keyBuf = Buffer.from(apiKey);
    // Compare both possible header sources in constant time
    const hBuf = Buffer.from(headerKey.padEnd(apiKey.length, "\0").slice(0, apiKey.length));
    const bBuf = Buffer.from(bearerKey.padEnd(apiKey.length, "\0").slice(0, apiKey.length));
    return (
      (headerKey.length === apiKey.length && timingSafeEqual(keyBuf, hBuf)) ||
      (bearerKey.length === apiKey.length && timingSafeEqual(keyBuf, bBuf))
    );
  }

  private async _dispatchApiRoute(
    req: Request,
    url: URL,
    path: string,
    method: string,
    isLocal: boolean
  ): Promise<Response> {
    const route = `${method} ${path}`;

    // Rate limiting: skip for health endpoint and local loopback
    if (CONFIG.rateLimitEnabled !== false && !isLocal && path !== "/api/health") {
      // Normalize parameterized paths to prevent unbounded bucket growth
      // e.g. "DELETE /api/memories/abc-123" → "DELETE /api/memories/:id"
      const rateLimitKey = `${method} ${path.replace(/\/api\/(memories|conflicts|prompts)\/[^/]+/, "/api/$1/:id")}`;
      const now = Date.now();
      let bucket = this.rateLimitBuckets.get(rateLimitKey);
      if (!bucket) {
        bucket = { tokens: 120, lastRefill: now };
        this.rateLimitBuckets.set(rateLimitKey, bucket);
      }
      // Token bucket refill: 2 tokens/second, max 120
      const elapsed = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(120, bucket.tokens + elapsed * 2);
      bucket.lastRefill = now;
      if (bucket.tokens < 1) {
        return this.jsonResponse({ success: false, error: "Rate limit exceeded" }, 429);
      }
      bucket.tokens--;
    }

    switch (route) {
      case "GET /api/tags":
        return this.jsonResponse(await handleListTags(), 200, !isLocal);
      case "GET /api/memories":
        return await this._apiListMemories(url, isLocal);
      case "POST /api/memories":
        return await this._apiAddMemory(req, isLocal);
      case "POST /api/memories/bulk-delete":
        return await this._apiBulkDeleteMemories(req, isLocal);
      case "GET /api/search":
        return await this._apiSearch(url, isLocal);
      case "GET /api/memories/search":
        return await this._apiSearch(url, isLocal);
      case "GET /api/transcripts":
        return this._apiListTranscripts(url, isLocal);
      case "GET /api/transcripts/search":
        return await this._apiSearchTranscripts(url, isLocal);
      case "GET /api/stats":
        return this.jsonResponse(handleStats(), 200, !isLocal);
      case "GET /api/config":
        return this.jsonResponse(handleGetConfig(), 200, !isLocal);
      case "PUT /api/config":
        return await this._apiUpdateConfig(req, isLocal);
      case "GET /api/status":
        return this.jsonResponse(handleApiStatus(), 200, !isLocal);
      case "GET /api/health":
        return this.jsonResponse(handleApiStatus(), 200, !isLocal);
      case "GET /api/embedding-cache":
        return this.jsonResponse(handleEmbeddingCacheStats(), 200, !isLocal);
      case "GET /api/conflicts":
        return await this._apiListConflicts(url, isLocal);
      case "GET /api/conflicts/stats":
        return this.jsonResponse(handleConflictStats(), 200, !isLocal);
      case "POST /api/cleanup":
        return this.jsonResponse(await handleRunCleanup(), 200, !isLocal);
      case "POST /api/deduplicate":
        return this.jsonResponse(await handleRunDeduplication(), 200, !isLocal);
      case "GET /api/migration/detect":
        return this.jsonResponse(await handleDetectMigration(), 200, !isLocal);
      case "GET /api/migration/tags/detect":
        return this.jsonResponse(handleDetectTagMigration(), 200, !isLocal);
      case "POST /api/migration/tags/run-batch":
        return await this._apiRunTagMigration(req, isLocal);
      case "GET /api/migration/tags/progress":
        return this.jsonResponse(handleGetTagMigrationProgress(), 200, !isLocal);
      case "POST /api/migration/run":
        return await this._apiRunMigration(req, isLocal);
      case "GET /api/user-profile":
        return await this._apiGetUserProfile(url, isLocal);
      case "PUT /api/user-profile":
        return await this._apiUpdateUserProfile(req, isLocal);
      case "GET /api/profile":
        return await this._apiGetUserProfile(url, isLocal);
      case "PUT /api/profile":
        return await this._apiUpdateUserProfile(req, isLocal);
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
    if (method === "GET" && path.startsWith("/api/memories/")) {
      return this._apiGetMemory(path, isLocal);
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
    if (method === "GET" && path.startsWith("/api/conflicts/")) {
      return this._apiGetConflict(path, isLocal);
    }
    if (method === "DELETE" && path.startsWith("/api/prompts/")) {
      return await this._apiDeletePrompt(url, path, isLocal);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async _apiListMemories(url: URL, isLocal: boolean): Promise<Response> {
    const tag = url.searchParams.get("tag") || undefined;
    const { page, pageSize } = this._parsePageParams(url);
    const includePrompts = url.searchParams.get("includePrompts") !== "false";
    const result = await handleListMemories(tag, page, pageSize, includePrompts);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiAddMemory(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json()) as Parameters<typeof handleAddMemory>[0];
    const result = await handleAddMemory(body);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiDeleteMemory(url: URL, path: string, isLocal: boolean): Promise<Response> {
    const id = this._extractIdFromPath(path);
    if (!id) {
      return this.jsonResponse({ success: false, error: "Invalid ID" });
    }
    const cascade = url.searchParams.get("cascade") === "true";
    const result = await handleDeleteMemory(id, cascade);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private _apiGetMemory(path: string, isLocal: boolean): Response {
    const id = this._extractIdFromPath(path, ["search"]);
    if (!id) {
      return this.jsonResponse({ success: false, error: "Invalid ID" });
    }
    const result = handleGetMemory(id);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiUpdateMemory(req: Request, path: string, isLocal: boolean): Promise<Response> {
    const parts = path.split("/");
    if (parts.length !== 4 || !parts[3]) {
      return this.jsonResponse({ success: false, error: "Invalid ID" });
    }
    const id = parts[3];
    const body = (await req.json()) as { content?: string; tags?: string[] };
    const result = await handleUpdateMemory(id, body);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiBulkDeleteMemories(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json()) as { ids?: string[]; cascade?: boolean };
    const cascade = body.cascade !== false;
    const result = await handleBulkDelete(body.ids || [], cascade);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiSearch(url: URL, isLocal: boolean): Promise<Response> {
    const query = url.searchParams.get("q");
    const tag = url.searchParams.get("tag") || undefined;
    const { page, pageSize } = this._parsePageParams(url);

    if (!query) {
      return this.jsonResponse({ success: false, error: "query parameter required" });
    }

    const result = await handleSearch(query, tag, page, pageSize);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiSearchTranscripts(url: URL, isLocal: boolean): Promise<Response> {
    const query = (url.searchParams.get("q") || "").trim();
    const { page, pageSize } = this._parsePageParams(url, "page", "limit");

    // Empty query → FTS5 MATCH throws on empty string; use list (getRecentTranscripts) instead
    if (!query) {
      const result = handleListTranscripts(page, pageSize);
      return this.jsonResponse(result, 200, !isLocal);
    }

    const result = await handleSearchTranscripts(query, page, pageSize);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private _apiListTranscripts(url: URL, isLocal: boolean): Response {
    const { page, pageSize } = this._parsePageParams(url, "page", "pageSize", "limit");
    const projectPath = url.searchParams.get("project") || undefined;
    const result = handleListTranscripts(page, pageSize, projectPath);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiListConflicts(url: URL, isLocal: boolean): Promise<Response> {
    const resolved = url.searchParams.get("resolved") === "true";
    const limit = Number.parseInt(url.searchParams.get("limit") || "100");
    const result = handleListConflicts(resolved, limit);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiResolveConflict(
    req: Request,
    path: string,
    isLocal: boolean
  ): Promise<Response> {
    const conflictId = this._extractIdFromPath(path, ["stats"]);
    if (!conflictId) {
      return this.jsonResponse({ success: false, error: "Invalid conflict ID" });
    }
    const body = (await req.json().catch(() => ({}))) as {
      strategy?: string;
      mergedContent?: string;
    };
    const result = await handleResolveConflict(
      conflictId,
      body.strategy || "keep_newer",
      body.mergedContent
    );
    return this.jsonResponse(result, 200, !isLocal);
  }

  private _apiGetConflict(path: string, isLocal: boolean): Response {
    const conflictId = this._extractIdFromPath(path, ["stats"]);
    if (!conflictId) {
      return this.jsonResponse({ success: false, error: "Invalid conflict ID" });
    }
    // R7: direct id lookup across all shards — no 1000-row list cap, and
    // resolved conflicts are readable history too.
    const result = handleGetConflict(conflictId);
    return this.jsonResponse(result, result.success ? 200 : 404, !isLocal);
  }

  private async _apiPinMemory(path: string, isLocal: boolean): Promise<Response> {
    return this._apiPinAction(path, handlePinMemory, isLocal);
  }

  private async _apiUnpinMemory(path: string, isLocal: boolean): Promise<Response> {
    return this._apiPinAction(path, handleUnpinMemory, isLocal);
  }

  private async _apiPinAction(
    path: string,
    handler: (id: string) => unknown,
    isLocal: boolean
  ): Promise<Response> {
    const id = this._extractIdFromPath(path);
    if (!id) {
      return this.jsonResponse({ success: false, error: "Invalid ID" });
    }
    const result = handler(id);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiRunTagMigration(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json()) as { batchSize?: number };
    const batchSize = body?.batchSize || 5;
    const result = await handleRunTagMigrationBatch(batchSize);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiRunMigration(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json()) as { strategy?: string };
    const strategy = body.strategy || "fresh-start";
    if (strategy !== "fresh-start" && strategy !== "re-embed") {
      return this.jsonResponse({ success: false, error: "Invalid strategy" });
    }
    const result = await handleRunMigration(strategy);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiDeletePrompt(url: URL, path: string, isLocal: boolean): Promise<Response> {
    const id = this._extractIdFromPath(path);
    if (!id) {
      return this.jsonResponse({ success: false, error: "Invalid ID" });
    }
    const cascade = url.searchParams.get("cascade") === "true";
    const result = await handleDeletePrompt(id, cascade);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiBulkDeletePrompts(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json()) as { ids?: string[]; cascade?: boolean };
    const cascade = body.cascade !== false;
    const result = await handleBulkDeletePrompts(body.ids || [], cascade);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiGetUserProfile(url: URL, isLocal: boolean): Promise<Response> {
    const userId = url.searchParams.get("userId") || undefined;
    const result = await handleGetUserProfile(userId);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiUpdateUserProfile(req: Request, isLocal: boolean): Promise<Response> {
    let body: { userId?: string; profileData: unknown };
    try {
      body = (await req.json()) as { userId?: string; profileData: unknown };
    } catch (e) {
      return this.jsonResponse({ success: false, error: "Invalid JSON" }, 400, !isLocal);
    }
    if (!body || !body.profileData) {
      return this.jsonResponse({ success: false, error: "Invalid request body" }, 400, !isLocal);
    }
    const result = await handleUpdateUserProfile(body.userId, body.profileData as UserProfileData);
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
    const body = (await req.json().catch(() => ({}))) as { userId?: string };
    const userId = body.userId || undefined;
    const result = await handleRefreshProfile(userId);
    return this.jsonResponse(result, 200, !isLocal);
  }

  private async _apiUpdateConfig(req: Request, isLocal: boolean): Promise<Response> {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body === null) {
      return this.jsonResponse({ success: false, error: "invalid JSON body" }, 400, !isLocal);
    }
    const result = await handleUpdateConfig(body);
    return this.jsonResponse(result, result.success ? 200 : 400, !isLocal);
  }

  private _securityHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    };
    if (this._currentRequestProtocol === "https:") {
      headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
    }
    return headers;
  }

  private serveStaticFile(filename: string, contentType: string): Response {
    const webDir = join(__dirname, "..", "web");
    const filePath = join(webDir, filename);
    try {
      const isImage = contentType.startsWith("image/");
      const content = isImage ? readFileSync(filePath) : readFileSync(filePath, "utf-8");
      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Cache-Control": isImage ? "public, max-age=86400" : "no-cache",
        ...this._securityHeaders(),
      };
      return new Response(content, {
        headers,
      });
    } catch (error) {
      log("Static file serve error", { path: filePath, error: String(error) });
      return new Response("File not found", { status: 404 });
    }
  }

  private _parsePageParams(
    url: URL,
    pageKey = "page",
    pageSizeKey = "pageSize",
    pageSizeFallbackKey?: string
  ): { page: number; pageSize: number } {
    const rawPage = Number.parseInt(url.searchParams.get(pageKey) || "1");
    const rawPageSizeStr =
      url.searchParams.get(pageSizeKey) ||
      (pageSizeFallbackKey ? url.searchParams.get(pageSizeFallbackKey) : null) ||
      "20";
    const rawPageSize = Number.parseInt(rawPageSizeStr);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10000) : 1;
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= 100 ? rawPageSize : 20;
    return { page, pageSize };
  }

  private _extractIdFromPath(
    path: string,
    excludeSegments: string[] = ["bulk-delete", "search", "stats"]
  ): string | null {
    const parts = path.split("/");
    const id = parts[3];
    if (!id || excludeSegments.includes(id)) return null;
    return id;
  }

  private jsonResponse(data: unknown, status = 200, redact = false): Response {
    const finalData = redact ? this.redactPII(data) : data;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this._securityHeaders(),
    };
    return new Response(JSON.stringify(finalData), {
      status,
      headers,
    });
  }
}

export async function startWebServer(config: WebServerConfig): Promise<WebServer> {
  const server = new WebServer(config);
  await server.start();
  return server;
}
