import type { PluginInput } from "@opencode-ai/plugin";
import { memoryClient } from "./client.js";
import { getTags } from "./tags.js";
import { log, warn } from "./logger.js";
import { CONFIG } from "../config.js";
import { userPromptManager } from "./user-prompt/user-prompt-manager.js";
import { detectLanguage, getLanguageName } from "./language-detector.js";
import { z } from "zod";

interface ToolCallInfo {
  name: string;
  input: string;
}

const MAX_TOOL_INPUT_LENGTH = 100;

const AUTO_CAPTURE_SYSTEM_PROMPT_TEMPLATE = (
  langName: string
) => `You are a technical memory recorder for a software development project.

RULES:
1. ONLY capture technical work (code, bugs, features, architecture, config)
2. SKIP non-technical by returning type="skip"
3. NO meta-commentary or behavior analysis
4. Include specific file names, functions, technical details
5. Generate 2-4 technical tags (e.g., "react", "auth", "bug-fix")
6. You MUST write the summary in ${langName}.

FORMAT:
## Request
[1-2 sentences: what was requested, in ${langName}]

## Outcome
[1-2 sentences: what was done, include files/functions, in ${langName}]

SKIP if: greetings, casual chat, no code/decisions made
CAPTURE if: code changed, bug fixed, feature added, decision made`;

const AUTO_CAPTURE_ANALYSIS_PROMPT = (context: string) => `${context}

Analyze this conversation. If it contains technical work (code, bugs, features, decisions), create a concise summary and relevant tags. If it's non-technical (greetings, casual chat, incomplete requests), return type="skip" with empty summary.`;

let isCapturing = false;

interface PromptMessage {
  info?: { id?: string; role?: string };
  parts?: Array<{
    type: string;
    text?: string;
    tool?: string;
    id?: string;
    input?: unknown;
    state?: { status?: string; input?: unknown; output?: unknown };
  }>;
}

function findPromptMessages(messages: PromptMessage[], promptMessageId: string): PromptMessage[] {
  const promptIndex = messages.findIndex((m) => m.info?.id === promptMessageId);
  if (promptIndex === -1) return [];
  return messages.slice(promptIndex + 1);
}

async function processCaptureResult(
  prompt: { id: string },
  summaryResult: { summary: string; type: string; tags: string[] } | null,
  ctx: PluginInput,
  directory: string,
  sessionID: string,
  claimedPromptId: string | null
): Promise<string | null> {
  if (!summaryResult || summaryResult.type === "skip") {
    userPromptManager.deletePrompt(prompt.id);
    return claimedPromptId;
  }

  const tags = getTags(directory);
  const summaryWithTags =
    summaryResult.tags.length > 0
      ? `${summaryResult.summary}\n\nTags: ${summaryResult.tags.join(", ")}`
      : summaryResult.summary;
  const result = await memoryClient.addMemory(summaryWithTags, tags.project.tag, {
    source: "auto-capture",
    type: summaryResult.type,
    tags: summaryResult.tags,
    sessionID,
    promptId: prompt.id,
    captureTimestamp: Date.now(),
    displayName: tags.project.displayName,
    userName: tags.project.userName,
    userEmail: tags.project.userEmail,
    projectPath: tags.project.projectPath,
    projectName: tags.project.projectName,
    gitRepoUrl: tags.project.gitRepoUrl,
  });

  if (!result.success) return claimedPromptId;

  userPromptManager.linkMemoryToPrompt(prompt.id, result.id);
  userPromptManager.markAsCaptured(prompt.id);

  if (CONFIG.showAutoCaptureToasts) {
    await ctx.client?.tui
      .showToast({
        body: {
          title: "Memory Captured",
          message: "Project memory saved from conversation",
          variant: "success",
          duration: 3000,
        },
      })
      .catch((err) => {
        log("Toast notification failed", { error: String(err) });
      });
  }

  return null;
}

function isLLMConfigured(): boolean {
  return !!(
    (CONFIG.opencodeProvider && CONFIG.opencodeModel) ||
    (CONFIG.memoryModel && CONFIG.memoryApiUrl)
  );
}

export async function performAutoCapture(
  ctx: PluginInput,
  sessionID: string,
  directory: string
): Promise<void> {
  if (isCapturing) return;
  isCapturing = true;
  let claimedPromptId: string | null = null;
  try {
    const prompt = userPromptManager.getLastUncapturedPrompt(sessionID);
    if (!prompt) return;
    if (!userPromptManager.claimPrompt(prompt.id)) return;
    const maxRetries = CONFIG.autoCaptureMaxRetries ?? 3;
    const existingAttempts = userPromptManager.getCaptureAttempts(prompt.id);

    for (let attempt = existingAttempts; attempt < maxRetries; attempt++) {
      try {
        if (!ctx.client) throw new Error("Client not available");

        const response = await ctx.client.session.messages({ path: { id: sessionID } });
        if (!response.data) {
          // Transient — release claim so next idle cycle retries
          return;
        }

        const aiMessages = findPromptMessages(response.data, prompt.messageId);
        if (aiMessages.length === 0) return;

        const { textResponses, toolCalls } = extractAIContent(aiMessages);
        if (textResponses.length === 0 && toolCalls.length === 0) return;

        if (!isLLMConfigured()) {
          warn(
            "Auto-capture skipped: LLM provider not configured. Set memoryModel/memoryApiUrl or opencodeProvider/opencodeModel."
          );
          return;
        }

        const tags = getTags(directory);
        const latestMemory = await getLatestProjectMemory(tags.project.tag);
        const context = buildMarkdownContext(
          prompt.content,
          textResponses,
          toolCalls,
          latestMemory
        );
        const summaryResult = await generateSummary(context, sessionID, prompt.content);

        claimedPromptId = await processCaptureResult(
          prompt,
          summaryResult,
          ctx,
          directory,
          sessionID,
          claimedPromptId
        );
        // Success — return without recording a failure
        return;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const isConfigError =
          err.message.includes("not configured") ||
          err.message.includes("not available") ||
          err.message.includes("not connected");

        if (isConfigError) {
          log("Auto-capture skipped — configuration not ready", { error: err.message });
          return;
        }

        // Record the failed attempt persistently
        userPromptManager.recordFailedAttempt(prompt.id);
        const attemptsAfter = attempt + 1;

        if (attemptsAfter >= maxRetries) {
          // Budget exhausted — surface error to user, stop retrying
          log("Auto-capture failed — retry budget exhausted", {
            promptId: prompt.id,
            attempts: attemptsAfter,
          });
          if (CONFIG.showAutoCaptureToasts && ctx.client?.tui) {
            await ctx.client.tui
              .showToast({
                body: {
                  title: "Auto-capture Error",
                  message: err.message.slice(0, 200),
                  variant: "error",
                  duration: 5000,
                },
              })
              .catch(() => {
                // Notification errors are non-critical
              });
          }
          return;
        }

        // Exponential backoff: 2s, 4s, 8s
        const backoffMs = 2000 * 2 ** attempt;
        log("Auto-capture retry scheduled", {
          promptId: prompt.id,
          attempt: attemptsAfter,
          backoffMs,
        });
        const { promise: backoffPromise, resolve: backoffResolve } = Promise.withResolvers<void>();
        setTimeout(backoffResolve, backoffMs);
        await backoffPromise;
      }
    }
  } finally {
    if (claimedPromptId) {
      userPromptManager.resetPromptClaim(claimedPromptId);
    }
    isCapturing = false;
  }
}

function extractAIContent(messages: PromptMessage[]): {
  textResponses: string[];
  toolCalls: ToolCallInfo[];
} {
  const textResponses: string[] = [];
  const toolCalls: ToolCallInfo[] = [];

  for (const msg of messages) {
    if (msg.info?.role !== "assistant") continue;

    if (!msg.parts || !Array.isArray(msg.parts)) continue;

    const textParts = msg.parts.filter((p) => p.type === "text" && p.text);
    if (textParts.length > 0) {
      const text = textParts.map((p) => p.text!).join("\n");
      if (text.trim()) {
        textResponses.push(text.trim());
      }
    }

    const toolParts = msg.parts.filter((p) => p.type === "tool");
    for (const tool of toolParts) {
      const name = tool.tool || "unknown";
      let input = "";

      if (tool.state?.input) {
        const inputObj = tool.state.input;
        input =
          typeof inputObj === "string"
            ? inputObj
            : Object.entries(inputObj as Record<string, unknown>)
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(", ");
      }

      if (input.length > MAX_TOOL_INPUT_LENGTH) {
        input = `${input.substring(0, MAX_TOOL_INPUT_LENGTH)}...`;
      }

      toolCalls.push({ name, input });
    }
  }

  return { textResponses, toolCalls };
}

async function getLatestProjectMemory(containerTag: string): Promise<string | null> {
  try {
    const result = await memoryClient.listMemories(containerTag, 1);
    if (!result.success || result.memories.length === 0) return null;
    const content = result.memories[0]!.summary;
    return content.length <= 500 ? content : `${content.substring(0, 500)}...`;
  } catch {
    return null;
  }
}

function buildMarkdownContext(
  userPrompt: string,
  textResponses: string[],
  toolCalls: ToolCallInfo[],
  latestMemory: string | null
): string {
  const sections: string[] = [];

  if (latestMemory) {
    sections.push("## Previous Memory Context", "---", latestMemory, "---\n");
  }

  sections.push("## User Request", "---", userPrompt, "---\n");

  if (textResponses.length > 0) {
    sections.push("## AI Response", "---", textResponses.join("\n\n"), "---\n");
  }

  if (toolCalls.length > 0) {
    sections.push("## Tools Used", "---");
    for (const tool of toolCalls) {
      sections.push(tool.input ? `- ${tool.name}(${tool.input})` : `- ${tool.name}`);
    }
    sections.push("---\n");
  }

  return sections.join("\n");
}

function detectTargetLanguage(userPrompt: string): { lang: string; name: string } {
  const targetLang =
    CONFIG.autoCaptureLanguage === "auto" || !CONFIG.autoCaptureLanguage
      ? detectLanguage(userPrompt)
      : CONFIG.autoCaptureLanguage;
  return { lang: targetLang, name: getLanguageName(targetLang) };
}

async function generateSummaryViaOpencode(
  context: string,
  userPrompt: string
): Promise<{ summary: string; type: string; tags: string[] }> {
  if (CONFIG.memoryModel) {
    log("opencodeProvider takes precedence over memoryModel for auto-capture");
  }

  const providerName = CONFIG.opencodeProvider!;
  const modelId = CONFIG.opencodeModel!;

  const { isProviderConnected, getStatePath, generateStructuredOutput } =
    await import("./ai/opencode-provider.js");

  if (!isProviderConnected(providerName)) {
    throw new Error(
      `opencode provider '${providerName}' is not connected. Check your opencode provider configuration.`
    );
  }

  const { name: langName } = detectTargetLanguage(userPrompt);

  const schema = z.object({
    summary: z.string(),
    type: z.string(),
    tags: z.array(z.string()),
  });

  const result = await generateStructuredOutput({
    providerName,
    modelId,
    statePath: getStatePath(),
    systemPrompt: AUTO_CAPTURE_SYSTEM_PROMPT_TEMPLATE(langName),
    userPrompt: AUTO_CAPTURE_ANALYSIS_PROMPT(context),
    schema,
    temperature: CONFIG.memoryTemperature === false ? undefined : (CONFIG.memoryTemperature ?? 0.3),
  });

  return {
    summary: result.summary,
    type: result.type,
    tags: (result.tags || []).map((t: string) => t.toLowerCase().trim()),
  };
}

async function generateSummaryViaProvider(
  context: string,
  sessionID: string,
  userPrompt: string
): Promise<{ summary: string; type: string; tags: string[] }> {
  const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
  const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");

  const providerConfig = buildMemoryProviderConfig(CONFIG);
  const provider = AIProviderFactory.createProvider(CONFIG.memoryProvider, providerConfig);
  const { name: langName } = detectTargetLanguage(userPrompt);

  const toolSchema = {
    type: "function" as const,
    function: {
      name: "save_memory",
      description: "Save the conversation summary as a memory",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Markdown-formatted summary of the conversation",
          },
          type: {
            type: "string",
            description:
              "Type of memory: 'skip' for non-technical conversations, or technical type (feature, bug-fix, refactor, analysis, configuration, discussion, other)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "List of 2-4 technical tags related to the memory",
          },
        },
        required: ["summary", "type", "tags"],
      },
    },
  };

  const result = await provider.executeToolCall(
    AUTO_CAPTURE_SYSTEM_PROMPT_TEMPLATE(langName),
    AUTO_CAPTURE_ANALYSIS_PROMPT(context),
    toolSchema,
    sessionID
  );

  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to generate summary");
  }

  return {
    summary: result.data.summary,
    type: result.data.type,
    tags: (result.data.tags || []).map((t: string) => t.toLowerCase().trim()),
  };
}

async function generateSummary(
  context: string,
  sessionID: string,
  userPrompt: string
): Promise<{ summary: string; type: string; tags: string[] } | null> {
  if (CONFIG.opencodeProvider && CONFIG.opencodeModel) {
    return generateSummaryViaOpencode(context, userPrompt);
  }

  if (!CONFIG.memoryModel || !CONFIG.memoryApiUrl) {
    throw new Error("External API not configured for auto-capture");
  }

  return generateSummaryViaProvider(context, sessionID, userPrompt);
}
