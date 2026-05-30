import { CONFIG } from "../../config.js";
import { log } from "../logger.js";
import { ExactScanBackend } from "./exact-scan-backend.js";
import type { VectorBackend, VectorBackendFactoryOptions } from "./types.js";
import { USearchBackend } from "./usearch-backend.js";

function logDegradation(
  strategy: string,
  severity: string,
  operation: string,
  error: unknown
): void {
  log("Vector backend degraded to exact-scan", {
    strategy,
    severity,
    operation,
    error: String(error),
  });
}

class FallbackAwareBackend implements VectorBackend {
  private activeBackend: VectorBackend;
  private errorCount = 0;
  private lastErrorTime = 0;

  constructor(
    private readonly strategy: "usearch-first" | "usearch" | "nsw-first" | "nsw",
    private readonly primary: VectorBackend,
    private readonly fallback: VectorBackend
  ) {
    this.activeBackend = primary;
  }

  getBackendName(): string {
    return this.activeBackend.getBackendName();
  }

  async insert(args: Parameters<VectorBackend["insert"]>[0]): Promise<void> {
    await this.activeBackend.insert(args);
  }

  async insertBatch(args: Parameters<VectorBackend["insertBatch"]>[0]): Promise<void> {
    await this.activeBackend.insertBatch(args);
  }

  async delete(args: Parameters<VectorBackend["delete"]>[0]): Promise<void> {
    await this.activeBackend.delete(args);
  }

  async search(args: Parameters<VectorBackend["search"]>[0]) {
    // Retry loop: allow up to 3 transient errors before falling back
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const result = await this.activeBackend.search(args);
        // Recovery window: reset error count after 60s of error-free operation
        if (this.errorCount > 0 && Date.now() - this.lastErrorTime > 60000) {
          log("Vector backend recovered — resetting error count", {
            previousErrorCount: this.errorCount,
            lastErrorTime: new Date(this.lastErrorTime).toISOString(),
          });
          this.errorCount = 0;
        }
        return result;
      } catch (error) {
        this.errorCount++;
        this.lastErrorTime = Date.now();
        if (this.errorCount <= 3) {
          log("Vector backend transient error — retrying primary backend", {
            attempt: attempt + 1,
            errorCount: this.errorCount,
            maxRetries: 3,
            error: String(error),
          });
          continue; // retry with primary
        }
        // Exceeded retry limit — degrade to fallback
        this.logDegrade("search", error);
        this.activeBackend = this.fallback;
        return this.fallback.search(args);
      }
    }
    // Unreachable (loop always returns or degrades)
    return this.fallback.search(args);
  }

  async rebuildFromShard(args: Parameters<VectorBackend["rebuildFromShard"]>[0]): Promise<void> {
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        await this.activeBackend.rebuildFromShard(args);
        // Recovery window: reset error count after 60s of error-free operation
        if (this.errorCount > 0 && Date.now() - this.lastErrorTime > 60000) {
          this.errorCount = 0;
        }
        return;
      } catch (error) {
        this.errorCount++;
        this.lastErrorTime = Date.now();
        if (this.errorCount <= 3) {
          log("Vector backend transient error — retrying primary backend", {
            attempt: attempt + 1,
            errorCount: this.errorCount,
            maxRetries: 3,
            error: String(error),
          });
          continue;
        }
        this.logDegrade("rebuild", error);
        this.activeBackend = this.fallback;
        await this.fallback.rebuildFromShard(args);
        return;
      }
    }
    // Unreachable — fallback always called on last retry
  }

  async deleteShardIndexes(
    args: Parameters<VectorBackend["deleteShardIndexes"]>[0]
  ): Promise<void> {
    await this.primary.deleteShardIndexes(args);
    await this.fallback.deleteShardIndexes(args);
  }

  private logDegrade(operation: string, error: unknown): void {
    logDegradation(
      this.strategy,
      this.strategy.endsWith("-first") ? "info" : "warning",
      operation,
      error
    );
  }
}

async function defaultUSearchProbe(): Promise<boolean> {
  try {
    await import("usearch");
    return true;
  } catch {
    return false;
  }
}

export async function createVectorBackend(
  options: VectorBackendFactoryOptions
): Promise<VectorBackend> {
  const exactScanBackend = new ExactScanBackend();

  if (options.vectorBackend === "exact-scan") {
    return exactScanBackend;
  }

  const isNSW = options.vectorBackend === "nsw" || options.vectorBackend === "nsw-first";
  const isUSearch =
    options.vectorBackend === "usearch" || options.vectorBackend === "usearch-first";

  if (isNSW) {
    try {
      const nswBackend =
        options.createNSWBackend?.() ??
        new (await import("./nsw-backend.js")).NSWBackend({
          dimensions: CONFIG.embeddingDimensions,
        });

      if (options.vectorBackend === "nsw-first") {
        return new FallbackAwareBackend(options.vectorBackend, nswBackend, exactScanBackend);
      }
      return nswBackend;
    } catch (error) {
      logDegradation(
        options.vectorBackend,
        options.vectorBackend === "nsw" ? "warning" : "info",
        "create",
        error
      );
      return exactScanBackend;
    }
  }

  const probeUSearch = options.probeUSearch ?? defaultUSearchProbe;
  if (!(await probeUSearch())) {
    if (isUSearch) {
      logDegradation(options.vectorBackend, "warning", "probe", "USearch unavailable");
    }
    return exactScanBackend;
  }

  try {
    const usearchBackend =
      options.createUSearchBackend?.() ??
      new USearchBackend({
        baseDir: CONFIG.storagePath,
        dimensions: CONFIG.embeddingDimensions,
      });

    return new FallbackAwareBackend(options.vectorBackend, usearchBackend, exactScanBackend);
  } catch (error) {
    logDegradation(options.vectorBackend, isUSearch ? "warning" : "info", "create", error);
    return exactScanBackend;
  }
}
