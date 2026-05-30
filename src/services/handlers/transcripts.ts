import { transcriptManager, type TranscriptRecord } from "../sqlite/transcript-manager.js";
import { log } from "../logger.js";
import { sanitizeListParams } from "./shared.js";
import type { ApiResponse } from "./shared-types.js";

export async function handleSearchTranscripts(
  query: string,
  page: number,
  pageSize: number
): Promise<
  ApiResponse<{ transcripts: TranscriptRecord[]; total: number; page: number; totalPages: number }>
> {
  try {
    const offset = (page - 1) * pageSize;
    const { transcripts, total } = transcriptManager.searchTranscripts(query, pageSize, offset);

    return {
      success: true,
      data: {
        transcripts,
        total,
        page,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    log("API error in handleSearchTranscripts", { error: String(error) });
    return { success: false, error: "Internal error searching transcripts" };
  }
}

export function handleListTranscripts(
  page: number,
  pageSize: number,
  projectPath?: string
): ApiResponse<{
  transcripts: TranscriptRecord[];
  total: number;
  page: number;
  totalPages: number;
}> {
  try {
    const { safePage, safePageSize } = sanitizeListParams(page, pageSize);
    const offset = (safePage - 1) * safePageSize;
    const maxToFetch = Math.min(offset + safePageSize, 500);
    let transcripts = transcriptManager.getRecentTranscripts(maxToFetch);
    if (projectPath) {
      transcripts = transcripts.filter((t) => t.projectPath === projectPath);
    }
    const total = transcripts.length;
    return {
      success: true,
      data: {
        transcripts: transcripts.slice(offset, offset + safePageSize),
        total,
        page: safePage,
        totalPages: Math.ceil(total / safePageSize),
      },
    };
  } catch (error) {
    log("API error in handleListTranscripts", { error: String(error) });
    return { success: false, error: "Internal error listing transcripts" };
  }
}
