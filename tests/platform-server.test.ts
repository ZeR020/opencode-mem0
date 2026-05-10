import { describe, it, expect, vi } from "vitest";

vi.mock("../src/services/logger.js", () => ({
  log: () => {},
}));

const { serve } = await import("../src/services/platform-server.js");

describe("platform-server", () => {
  it("creates and stops a Node.js server", async () => {
    const port = 19999;
    const server = await serve({
      port,
      hostname: "127.0.0.1",
      fetch: () => new Response("OK"),
    });

    expect(server).toBeDefined();
    expect(typeof server.stop).toBe("function");
    expect(typeof server.requestIP).toBe("function");

    // Test that requestIP returns a value (Bun may return object instead of null)
    const req = new Request("http://localhost/");
    const ip = server.requestIP(req);
    expect(ip === null || (ip && typeof ip === "object")).toBe(true);

    server.stop();
  });

  it("handles requests through fetch callback", async () => {
    const port = 19998;
    let receivedRequest: Request | null = null;

    const server = await serve({
      port,
      hostname: "127.0.0.1",
      fetch: (req: Request) => {
        receivedRequest = req;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    // Make a request to the server
    const response = await fetch(`http://127.0.0.1:${port}/test`, {
      method: "POST",
      body: JSON.stringify({ test: true }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(receivedRequest).not.toBeNull();

    server.stop();
  });

  it("handles GET requests", async () => {
    const port = 19997;
    const server = await serve({
      port,
      hostname: "127.0.0.1",
      fetch: (req: Request) => {
        if (req.method === "GET") {
          return new Response("GET response", { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const response = await fetch(`http://127.0.0.1:${port}/test`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe("GET response");

    server.stop();
  });

  it("handles 404 responses", async () => {
    const port = 19996;
    const server = await serve({
      port,
      hostname: "127.0.0.1",
      fetch: () => new Response("Not found", { status: 404 }),
    });

    const response = await fetch(`http://127.0.0.1:${port}/nonexistent`);
    expect(response.status).toBe(404);

    server.stop();
  });

  it("handles errors in fetch callback", async () => {
    const port = 19995;
    const server = await serve({
      port,
      hostname: "127.0.0.1",
      // skipcq: JS-0116 — Intentionally async to return rejected Promise for error handling test
      fetch: async () => {
        throw new Error("Test error");
      },
    });

    // Server should not crash even if fetch throws
    // Response may be 500 or connection may be closed - both are acceptable
    try {
      const response = await fetch(`http://127.0.0.1:${port}/test`);
      expect(response.status).toBeGreaterThanOrEqual(500);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }

    server.stop();
  });

  it("handles empty body requests", async () => {
    const port = 19994;

    const server = await serve({
      port,
      hostname: "127.0.0.1",
      fetch: async (req: Request) => {
        await req.text().catch(() => null);
        return new Response("OK", { status: 200 });
      },
    });

    const response = await fetch(`http://127.0.0.1:${port}/test`, {
      method: "POST",
    });
    expect(response.status).toBe(200);

    server.stop();
  });

  it("preserves request headers", async () => {
    const port = 19993;
    let receivedHeaders: Headers | null = null;

    const server = await serve({
      port,
      hostname: "127.0.0.1",
      fetch: (req: Request) => {
        receivedHeaders = req.headers;
        return new Response("OK");
      },
    });

    await fetch(`http://127.0.0.1:${port}/test`, {
      headers: { "X-Custom-Header": "test-value" },
    });

    expect(receivedHeaders?.get("x-custom-header")).toBe("test-value");

    server.stop();
  });
});
