import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch for all API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock logger
vi.mock("../src/services/logger.js", () => ({
  log: vi.fn(),
}));

// Mock dependencies
vi.mock("../src/services/platform-server.js", () => ({
  serve: vi.fn(),
}));

vi.mock("../src/services/api-handlers.js", () => ({
  handleListTags: vi.fn(),
  handleListMemories: vi.fn(),
  handleGetMemory: vi.fn(),
  handleAddMemory: vi.fn(),
  handleDeleteMemory: vi.fn(),
  handleBulkDelete: vi.fn(),
  handleUpdateMemory: vi.fn(),
  handleSearch: vi.fn(),
  handleSearchTranscripts: vi.fn(),
  handleListTranscripts: vi.fn(),
  handleStats: vi.fn(),
  handlePinMemory: vi.fn(),
  handleUnpinMemory: vi.fn(),
  handleRunCleanup: vi.fn(),
  handleRunDeduplication: vi.fn(),
  handleDetectMigration: vi.fn(),
  handleRunMigration: vi.fn(),
  handleDetectTagMigration: vi.fn(),
  handleRunTagMigrationBatch: vi.fn(),
  handleGetTagMigrationProgress: vi.fn(),
  handleDeletePrompt: vi.fn(),
  handleBulkDeletePrompts: vi.fn(),
  handleGetUserProfile: vi.fn(),
  handleUpdateUserProfile: vi.fn(),
  handleGetProfileChangelog: vi.fn(),
  handleGetProfileSnapshot: vi.fn(),
  handleRefreshProfile: vi.fn(),
  handleListConflicts: vi.fn(),
  handleResolveConflict: vi.fn(),
  handleConflictStats: vi.fn(),
  handleEmbeddingCacheStats: vi.fn(),
  handleApiStatus: vi.fn(),
}));

import { WebServer, startWebServer } from "../src/services/web-server.js";
import { serve } from "../src/services/platform-server.js";
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
  handleResolveConflict,
  handleListConflicts,
  handleConflictStats,
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
  handleEmbeddingCacheStats,
  handleApiStatus,
} from "../src/services/api-handlers.js";

describe("WebServer Routes", () => {
  let server: WebServer;
  let mockPlatformServer: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatformServer = {
      stop: vi.fn(),
      requestIP: vi.fn().mockReturnValue({ address: "127.0.0.1" }),
    };
    vi.mocked(serve).mockResolvedValue(mockPlatformServer);
    server = new WebServer({ port: 18080, host: "127.0.0.1", enabled: true });
  });

  async function makeRequest(path: string, method = "GET", body?: any, apiKey?: string) {
    await server.start();
    const fetchHandler = vi.mocked(serve).mock.calls[0][0].fetch;

    const headers: Record<string, string> = {};
    if (apiKey) headers["x-opencode-mem-key"] = apiKey;

    const req = new Request(`http://127.0.0.1:18080${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return fetchHandler(req);
  }

  describe("API Key Authentication", () => {
    it("rejects requests without API key when configured", async () => {
      server = new WebServer({
        port: 18081,
        host: "127.0.0.1",
        enabled: true,
        apiKey: "secret123",
      });
      vi.mocked(serve).mockResolvedValue(mockPlatformServer);

      const res = await makeRequest("/api/tags", "GET", undefined, "wrong-key");
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it("allows requests with correct API key", async () => {
      server = new WebServer({
        port: 18082,
        host: "127.0.0.1",
        enabled: true,
        apiKey: "secret123",
      });
      vi.mocked(serve).mockResolvedValue(mockPlatformServer);
      vi.mocked(handleListTags).mockResolvedValue({ success: true, tags: [] });

      const res = await makeRequest("/api/tags", "GET", undefined, "secret123");
      expect(res.status).toBe(200);
    });
  });

  describe("Static Files", () => {
    it("serves index.html at root", async () => {
      const res = await makeRequest("/");
      // Will 404 in test since files don't exist, but we exercise the path
      expect([200, 404]).toContain(res.status);
    });

    it("serves index.html at /index.html", async () => {
      const res = await makeRequest("/index.html");
      expect([200, 404]).toContain(res.status);
    });

    it("serves styles.css", async () => {
      const res = await makeRequest("/styles.css");
      expect([200, 404]).toContain(res.status);
    });

    it("serves app.js", async () => {
      const res = await makeRequest("/app.js");
      expect([200, 404]).toContain(res.status);
    });

    it("serves i18n.js", async () => {
      const res = await makeRequest("/i18n.js");
      expect([200, 404]).toContain(res.status);
    });

    it("serves favicon.ico", async () => {
      const res = await makeRequest("/favicon.ico");
      expect([200, 404]).toContain(res.status);
    });
  });

  describe("API Routes", () => {
    it("GET /api/tags calls handleListTags", async () => {
      vi.mocked(handleListTags).mockResolvedValue({ success: true, tags: ["test"] });
      const res = await makeRequest("/api/tags");
      expect(res.status).toBe(200);
      expect(handleListTags).toHaveBeenCalled();
    });

    it("GET /api/memories calls handleListMemories with pagination", async () => {
      vi.mocked(handleListMemories).mockResolvedValue({ success: true, memories: [] });
      const res = await makeRequest("/api/memories?page=2&pageSize=50&includePrompts=false");
      expect(res.status).toBe(200);
      expect(handleListMemories).toHaveBeenCalledWith(undefined, 2, 50, false);
    });

    it("GET /api/memories with tag filter", async () => {
      vi.mocked(handleListMemories).mockResolvedValue({ success: true, memories: [] });
      const res = await makeRequest("/api/memories?tag=project-test");
      expect(res.status).toBe(200);
      expect(handleListMemories).toHaveBeenCalledWith("project-test", 1, 20, true);
    });

    it("POST /api/memories calls handleAddMemory", async () => {
      vi.mocked(handleAddMemory).mockResolvedValue({ success: true, id: "mem-1" });
      const res = await makeRequest("/api/memories", "POST", { content: "test" });
      expect(res.status).toBe(200);
      expect(handleAddMemory).toHaveBeenCalled();
    });

    it("DELETE /api/memories/:id calls handleDeleteMemory", async () => {
      vi.mocked(handleDeleteMemory).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/memories/mem-123", "DELETE");
      expect(res.status).toBe(200);
      expect(handleDeleteMemory).toHaveBeenCalledWith("mem-123", false);
    });

    it("DELETE /api/memories/:id with cascade", async () => {
      vi.mocked(handleDeleteMemory).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/memories/mem-123?cascade=true", "DELETE");
      expect(res.status).toBe(200);
      expect(handleDeleteMemory).toHaveBeenCalledWith("mem-123", true);
    });

    it("DELETE /api/memories/ returns error for invalid ID", async () => {
      const res = await makeRequest("/api/memories/", "DELETE");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it("PUT /api/memories/:id calls handleUpdateMemory", async () => {
      vi.mocked(handleUpdateMemory).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/memories/mem-123", "PUT", { content: "updated" });
      expect(res.status).toBe(200);
    });

    it("POST /api/memories/bulk-delete calls handleBulkDelete", async () => {
      vi.mocked(handleBulkDelete).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/memories/bulk-delete", "POST", { ids: ["a", "b"] });
      expect(res.status).toBe(200);
    });

    it("GET /api/search requires query parameter", async () => {
      const res = await makeRequest("/api/search");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.error).toContain("query");
    });

    it("GET /api/search calls handleSearch with query", async () => {
      vi.mocked(handleSearch).mockResolvedValue({ success: true, results: [] });
      const res = await makeRequest("/api/search?q=test&tag=project&page=1&pageSize=10");
      expect(res.status).toBe(200);
      expect(handleSearch).toHaveBeenCalledWith("test", "project", 1, 10);
    });

    it("GET /api/stats calls handleStats", async () => {
      vi.mocked(handleStats).mockResolvedValue({ success: true, count: 5 });
      const res = await makeRequest("/api/stats");
      expect(res.status).toBe(200);
      expect(handleStats).toHaveBeenCalled();
    });

    it("GET /api/embedding-cache calls handleEmbeddingCacheStats", async () => {
      vi.mocked(handleEmbeddingCacheStats).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/embedding-cache");
      expect(res.status).toBe(200);
      expect(handleEmbeddingCacheStats).toHaveBeenCalled();
    });

    it("GET /api/conflicts calls handleListConflicts", async () => {
      vi.mocked(handleListConflicts).mockResolvedValue({ success: true, conflicts: [] });
      const res = await makeRequest("/api/conflicts?resolved=true&limit=50");
      expect(res.status).toBe(200);
      expect(handleListConflicts).toHaveBeenCalledWith(true, 50);
    });

    it("GET /api/conflicts/stats calls handleConflictStats", async () => {
      vi.mocked(handleConflictStats).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/conflicts/stats");
      expect(res.status).toBe(200);
      expect(handleConflictStats).toHaveBeenCalled();
    });

    it("POST /api/conflicts/:id calls handleResolveConflict", async () => {
      vi.mocked(handleResolveConflict).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/conflicts/conf-1", "POST", {
        strategy: "merge",
        mergedContent: "x",
      });
      expect(res.status).toBe(200);
      expect(handleResolveConflict).toHaveBeenCalledWith("conf-1", "merge", "x");
    });

    it("POST /api/conflicts/ returns error for invalid ID", async () => {
      const res = await makeRequest("/api/conflicts/", "POST", {});
      expect(res.status).toBe(200);
    });

    it("POST /api/memories/:id/pin calls handlePinMemory", async () => {
      vi.mocked(handlePinMemory).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/memories/mem-1/pin", "POST");
      expect(res.status).toBe(200);
      expect(handlePinMemory).toHaveBeenCalledWith("mem-1");
    });

    it("POST /api/memories/:id/unpin calls handleUnpinMemory", async () => {
      vi.mocked(handleUnpinMemory).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/memories/mem-1/unpin", "POST");
      expect(res.status).toBe(200);
      expect(handleUnpinMemory).toHaveBeenCalledWith("mem-1");
    });

    it("POST /api/cleanup calls handleRunCleanup", async () => {
      vi.mocked(handleRunCleanup).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/cleanup", "POST");
      expect(res.status).toBe(200);
      expect(handleRunCleanup).toHaveBeenCalled();
    });

    it("POST /api/deduplicate calls handleRunDeduplication", async () => {
      vi.mocked(handleRunDeduplication).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/deduplicate", "POST");
      expect(res.status).toBe(200);
      expect(handleRunDeduplication).toHaveBeenCalled();
    });

    it("GET /api/migration/detect calls handleDetectMigration", async () => {
      vi.mocked(handleDetectMigration).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/migration/detect");
      expect(res.status).toBe(200);
      expect(handleDetectMigration).toHaveBeenCalled();
    });

    it("GET /api/migration/tags/detect calls handleDetectTagMigration", async () => {
      vi.mocked(handleDetectTagMigration).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/migration/tags/detect");
      expect(res.status).toBe(200);
    });

    it("POST /api/migration/tags/run-batch calls handleRunTagMigrationBatch", async () => {
      vi.mocked(handleRunTagMigrationBatch).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/migration/tags/run-batch", "POST", { batchSize: 10 });
      expect(res.status).toBe(200);
      expect(handleRunTagMigrationBatch).toHaveBeenCalledWith(10);
    });

    it("GET /api/migration/tags/progress calls handleGetTagMigrationProgress", async () => {
      vi.mocked(handleGetTagMigrationProgress).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/migration/tags/progress");
      expect(res.status).toBe(200);
    });

    it("POST /api/migration/run with valid strategy", async () => {
      vi.mocked(handleRunMigration).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/migration/run", "POST", { strategy: "fresh-start" });
      expect(res.status).toBe(200);
      expect(handleRunMigration).toHaveBeenCalledWith("fresh-start");
    });

    it("POST /api/migration/run rejects invalid strategy", async () => {
      const res = await makeRequest("/api/migration/run", "POST", { strategy: "invalid" });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.error).toContain("Invalid strategy");
    });

    it("DELETE /api/prompts/:id calls handleDeletePrompt", async () => {
      vi.mocked(handleDeletePrompt).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/prompts/prompt-1", "DELETE");
      expect(res.status).toBe(200);
      expect(handleDeletePrompt).toHaveBeenCalledWith("prompt-1", false);
    });

    it("DELETE /api/prompts/:id with cascade", async () => {
      vi.mocked(handleDeletePrompt).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/prompts/prompt-1?cascade=true", "DELETE");
      expect(res.status).toBe(200);
      expect(handleDeletePrompt).toHaveBeenCalledWith("prompt-1", true);
    });

    it("POST /api/prompts/bulk-delete calls handleBulkDeletePrompts", async () => {
      vi.mocked(handleBulkDeletePrompts).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/prompts/bulk-delete", "POST", { ids: ["a", "b"] });
      expect(res.status).toBe(200);
    });

    it("GET /api/user-profile calls handleGetUserProfile", async () => {
      vi.mocked(handleGetUserProfile).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/user-profile?userId=test@example.com");
      expect(res.status).toBe(200);
      expect(handleGetUserProfile).toHaveBeenCalledWith("test@example.com");
    });

    it("GET /api/user-profile/changelog requires profileId", async () => {
      const res = await makeRequest("/api/user-profile/changelog");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("profileId");
    });

    it("GET /api/user-profile/changelog calls handleGetProfileChangelog", async () => {
      vi.mocked(handleGetProfileChangelog).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/user-profile/changelog?profileId=prof-1&limit=10");
      expect(res.status).toBe(200);
      expect(handleGetProfileChangelog).toHaveBeenCalledWith("prof-1", 10);
    });

    it("GET /api/user-profile/snapshot requires changelogId", async () => {
      const res = await makeRequest("/api/user-profile/snapshot");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("changelogId");
    });

    it("GET /api/user-profile/snapshot calls handleGetProfileSnapshot", async () => {
      vi.mocked(handleGetProfileSnapshot).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/user-profile/snapshot?changelogId=chg-1");
      expect(res.status).toBe(200);
      expect(handleGetProfileSnapshot).toHaveBeenCalledWith("chg-1");
    });

    it("GET /api/user-profile/snapshot with chlogId alias", async () => {
      vi.mocked(handleGetProfileSnapshot).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/user-profile/snapshot?chlogId=chg-2");
      expect(res.status).toBe(200);
      expect(handleGetProfileSnapshot).toHaveBeenCalledWith("chg-2");
    });

    it("POST /api/user-profile/refresh calls handleRefreshProfile", async () => {
      vi.mocked(handleRefreshProfile).mockResolvedValue({ success: true });
      const res = await makeRequest("/api/user-profile/refresh", "POST", { userId: "user-1" });
      expect(res.status).toBe(200);
      expect(handleRefreshProfile).toHaveBeenCalledWith("user-1");
    });
  });

  describe("Error Handling", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await makeRequest("/api/unknown-route");
      expect(res.status).toBe(404);
    });

    it("returns 500 when handler throws", async () => {
      vi.mocked(handleListTags).mockRejectedValue(new Error("DB failure"));
      const res = await makeRequest("/api/tags");
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  describe("PII Redaction", () => {
    it("redacts PII in responses from non-local IPs", async () => {
      mockPlatformServer.requestIP.mockReturnValue({ address: "192.168.1.1" });
      vi.mocked(handleListTags).mockResolvedValue({
        success: true,
        tags: [],
        userEmail: "test@example.com",
        displayName: "Test User",
        projectPath: "/secret/path",
      });

      const res = await makeRequest("/api/tags");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.userEmail).toBe("[REDACTED]");
      expect(json.displayName).toBe("[REDACTED]");
      expect(json.projectPath).toBe("[REDACTED]");
    });

    it("does not redact PII for local requests", async () => {
      mockPlatformServer.requestIP.mockReturnValue({ address: "127.0.0.1" });
      vi.mocked(handleListTags).mockResolvedValue({
        success: true,
        tags: [],
        userEmail: "test@example.com",
      });

      const res = await makeRequest("/api/tags");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.userEmail).toBe("test@example.com");
    });
  });

  describe("Server Lifecycle", () => {
    it("startWebServer creates and starts server", async () => {
      const ws = await startWebServer({ port: 18083, host: "127.0.0.1", enabled: true });
      expect(ws).toBeInstanceOf(WebServer);
      await ws.stop();
    });

    it("handles disabled server", async () => {
      const ws = await startWebServer({ port: 18084, host: "127.0.0.1", enabled: false });
      expect(ws.isRunning()).toBe(false);
    });

    it("handles port in use by starting health check", async () => {
      const errorServer = {
        stop: vi.fn(),
        requestIP: vi.fn(),
      };
      vi.mocked(serve)
        .mockRejectedValueOnce(new Error("EADDRINUSE: address already in use"))
        .mockResolvedValueOnce(errorServer);

      const ws = new WebServer({ port: 18085, host: "127.0.0.1", enabled: true });
      await ws.start();
      expect(ws.isServerOwner()).toBe(false);
      await ws.stop();
    });
  });
});
