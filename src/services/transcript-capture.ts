import type { PluginInput } from "@opencode-ai/plugin";
import { transcriptManager } from "./sqlite/transcript-manager.js";
import { getTags } from "./tags.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";

let isCaptureRunning = false;

export async function performTranscriptCapture(
  ctx: PluginInput,
  sessionID: string,
  directory: string
): Promise<void> {
  if (isCaptureRunning) return;
  isCaptureRunning = true;

  try {
    if (!ctx.client) {
      log("Transcript capture: client not available");
      return;
    }

    const response = await ctx.client.session.messages({
      path: { id: sessionID },
    });

    if (!response.data || response.data.length === 0) {
      log("Transcript capture: no messages in session", { sessionID });
      return;
    }

    const messages = response.data;
    const tags = getTags(directory);

    // Strip out internal parts that are already tracked as memories to avoid bloat
    // We keep all user/assistant messages and tool calls, but skip synthetic parts
    const filteredMessages = messages.map((msg: any) => ({
      role: msg.info?.role,
      id: msg.info?.id,
      timestamp: msg.info?.timestamp,
      parts: msg.parts
        ?.filter((p: any) => !p.synthetic)
        .map((p: any) => ({
          type: p.type,
          text: p.text,
          tool: p.tool,
          state: p.state
            ? {
                status: p.state.status,
                input: p.state.input,
                output: p.state.output,
              }
            : undefined,
        })),
    }));

    const result = transcriptManager.saveTranscript(
      sessionID,
      tags.project.projectPath || directory,
      filteredMessages
    );

    if (result.id) {
      log("Transcript captured", { sessionID, transcriptId: result.id });
    }
  } catch (error) {
    log("performTranscriptCapture: error", { sessionID, error: String(error) });
  } finally {
    isCaptureRunning = false;
  }
}

export async function cleanupOldTranscripts(): Promise<number> {
  if (!CONFIG.transcriptStorage.enabled) return 0;

  const maxAgeDays = CONFIG.transcriptStorage.maxAgeDays ?? 30;
  const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  return transcriptManager.deleteOldTranscripts(cutoffTime);
}
