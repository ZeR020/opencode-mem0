import { CONFIG } from "../../config.js";
import { log } from "../logger.js";
import { ExactScanBackend } from "./exact-scan-backend.js";
import type { VectorBackend, VectorBackendFactoryOptions } from "./types.js";
import { USearchBackend } from "./usearch-backend.js";

class FallbackAwareBackend implements VectorBackend {
  private activeBackend: VectorBackend;

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
    try {
      return await this.activeBackend.search(args);
    } catch (error) {
      this.logDegrade("search", error);
      this.activeBackend = this.fallback;
      return this.fallback.search(args);
    }
  }

  async rebuildFromShard(args: Parameters<VectorBackend["rebuildFromShard"]>[0]): Promise<void> {
    try {
      await this.activeBackend.rebuildFromShard(args);
    } catch (error) {
      this.logDegrade("rebuild", error);
      this.activeBackend = this.fallback;
      await this.fallback.rebuildFromShard(args);
    }
  }

  async deleteShardIndexes(
    args: Parameters<VectorBackend["deleteShardIndexes"]>[0]
  ): Promise<void> {
    await this.primary.deleteShardIndexes(args);
    await this.fallback.deleteShardIndexes(args);
  }

  private logDegrade(operation: string, error: unknown): void {
    const isStrict = this.strategy === "usearch" || this.strategy === "nsw";
    log("Vector backend degraded to exact-scan", {
      strategy: this.strategy,
      severity: isStrict ? "warning" : "info",
      operation,
      error: String(error),
    });
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
      log("Vector backend degraded to exact-scan", {
        strategy: options.vectorBackend,
        severity: options.vectorBackend === "nsw" ? "warning" : "info",
        operation: "create",
        error: String(error),
      });
      return exactScanBackend;
    }
  }

  const probeUSearch = options.probeUSearch ?? defaultUSearchProbe;
  if (!(await probeUSearch())) {
    if (isUSearch) {
      log("Vector backend degraded to exact-scan", {
        strategy: options.vectorBackend,
        severity: "warning",
        operation: "probe",
        error: "USearch unavailable",
      });
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
    log("Vector backend degraded to exact-scan", {
      strategy: options.vectorBackend,
      severity: isUSearch ? "warning" : "info",
      operation: "create",
      error: String(error),
    });
    return exactScanBackend;
  }
}
// audit: src/services/vector-backends/backend-factory.ts
