import { CONFIG } from "../../config.js";
import { log } from "../logger.js";
import { ExactScanBackend } from "./exact-scan-backend.js";
import type { VectorBackend, VectorBackendFactoryOptions } from "./types.js";
import { USearchBackend } from "./usearch-backend.js";

class FallbackAwareBackend implements VectorBackend {
  private activeBackend: VectorBackend;

  constructor(
    private readonly strategy: "usearch-first" | "usearch",
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
    log("Vector backend degraded to exact-scan", {
      strategy: this.strategy,
      severity: this.strategy === "usearch" ? "warning" : "info",
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

  const probeUSearch = options.probeUSearch ?? defaultUSearchProbe;
  if (!(await probeUSearch())) {
    if (options.vectorBackend === "usearch") {
      log("Vector backend degraded to exact-scan", {
        strategy: "usearch",
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
      severity: options.vectorBackend === "usearch" ? "warning" : "info",
      operation: "create",
      error: String(error),
    });
    return exactScanBackend;
  }
}
