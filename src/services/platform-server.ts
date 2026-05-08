import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface PlatformServer {
  stop(): void;
  requestIP(req: Request): { address: string } | null;
}

interface ServeOptions {
  port: number;
  hostname: string;
  fetch: (req: Request) => Promise<Response> | Response;
}

function normalizeHeaders(rawHeaders: IncomingMessage["headers"]): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        headers.append(key, v);
      }
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

async function createNodeServer(options: ServeOptions): Promise<PlatformServer> {
  const requestIPs = new WeakMap<Request, string>();

  const nodeServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const host = req.headers.host || `${options.hostname}:${options.port}`;
      const url = `http://${host}${req.url}`;

      const MAX_BODY_BYTES = 262_144; // 256 KiB for JSON API payloads
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (totalBytes > MAX_BODY_BYTES) {
          req.destroy();
          res.statusCode = 413;
          res.end("Payload too large");
          return;
        }
        chunks.push(buf);
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      const request = new Request(url, {
        method: req.method,
        headers: normalizeHeaders(req.headers),
        body: body && body.length > 0 ? body : undefined,
      });

      requestIPs.set(request, req.socket.remoteAddress || "127.0.0.1");

      const response = await options.fetch(request);

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      const responseBody = await response.arrayBuffer();
      res.end(Buffer.from(responseBody));
    } catch (error) {
      console.error("Platform server error:", error);
      res.statusCode = 500;
      res.end("Internal server error");
    }
  });

  return new Promise<PlatformServer>((resolve, reject) => {
    nodeServer.listen(options.port, options.hostname);

    nodeServer.once("error", (err) => {
      reject(err);
    });

    nodeServer.once("listening", () => {
      nodeServer.off("error", reject);
      resolve({
        stop() {
          nodeServer.close();
        },
        requestIP(req: Request) {
          const ip = requestIPs.get(req);
          return ip ? { address: ip } : null;
        },
      });
    });
  });
}

export function serve(options: ServeOptions): Promise<PlatformServer> {
  if (typeof Bun !== "undefined" && Bun.serve) {
    const bunServer = Bun.serve(options);
    return Promise.resolve({
      stop: () => bunServer.stop(),
      requestIP: (req: Request) => bunServer.requestIP(req),
    });
  }

  return createNodeServer(options);
}
// audit: src/services/platform-server.ts
