import type { PluginInput } from "@opencode-ai/plugin";
import { getTags } from "./tags.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";
import { userPromptManager } from "./user-prompt/user-prompt-manager.js";
import type { UserPrompt } from "./user-prompt/user-prompt-manager.js";
import { resolveProfileUserId, userProfileManager } from "./user-profile/user-profile-manager.js";
import { detectLanguage, getLanguageName } from "./language-detector.js";
import type { UserProfile, UserProfileData } from "./user-profile/types.js";
import { safeJSONParse } from "./utils/safe-transforms.js";
import { z } from "zod";

const USER_PROFILE_SYSTEM_PROMPT = (
  existingProfile: boolean,
  languageName?: string
) => `You are a user behavior analyst for a coding assistant.

Your task is to analyze user prompts and ${existingProfile ? "update" : "create"} a comprehensive user profile.

${languageInstruction(existingProfile, languageName ?? null)}

Use the update_user_profile tool to save the ${existingProfile ? "updated" : "new"} profile.`;

function languageInstruction(existingProfile: boolean, languageName: string | null): string {
  if (existingProfile) {
    return "CRITICAL: The existing profile's language is established and authoritative. You MUST keep writing ALL output in the same language as the existing profile — never switch languages based on recent prompts.";
  }
  if (languageName) {
    return `CRITICAL: Write ALL output in ${languageName}. Never switch languages, even if some prompts look different.`;
  }
  return "CRITICAL: Detect the DOMINANT language across ALL prompts below (ignore isolated outliers) and use it for all output.";
}

const USER_PROFILE_TOOL_PARAMS = {
  type: "object" as const,
  properties: {
    preferences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          description: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: { type: "array", items: { type: "string" }, maxItems: 3 },
        },
        required: ["category", "description", "confidence", "evidence"],
      },
    },
    patterns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          description: { type: "string" },
        },
        required: ["category", "description"],
      },
    },
    workflows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
        },
        required: ["description", "steps"],
      },
    },
  },
  required: ["preferences", "patterns", "workflows"],
};

let isLearningRunning = false;
let warnedNoAnalysisProvider = false;

export async function performUserProfileLearning(
  ctx: PluginInput,
  directory: string
): Promise<void> {
  if (isLearningRunning) return;

  // No provider that can analyze prompts? Stay inert and leave prompts queued:
  // consuming them here would silently discard the data, and throwing every
  // idle would spam logs forever. Warn once per process.
  const hasAnalysisProvider =
    Boolean(CONFIG.opencodeProvider && CONFIG.opencodeModel) ||
    Boolean(CONFIG.memoryModel && CONFIG.memoryApiUrl);
  if (!hasAnalysisProvider) {
    if (!warnedNoAnalysisProvider) {
      warnedNoAnalysisProvider = true;
      log(
        "User profile learning disabled — no analysis provider configured " +
          "(set opencodeProvider/opencodeModel or memoryModel/memoryApiUrl). Prompts stay queued."
      );
    }
    return;
  }

  isLearningRunning = true;
  try {
    const threshold = CONFIG.userProfileAnalysisInterval;
    const maxBatches = CONFIG.userProfileMaxBatchesPerIdle;

    const tags = getTags(directory);
    const userId = resolveProfileUserId(tags);

    // Confidence decay runs once per run (not per batch); repeated calls
    // within the same hour are skipped anyway (idempotent).
    if (userProfileManager.getActiveProfile(userId)) {
      userProfileManager.applyConfidenceDecay(userId);
    }

    let totalAnalyzed = 0;
    let batchesThisRun = 0;

    while (
      userPromptManager.countUnanalyzedForUserLearning() >= threshold &&
      batchesThisRun < maxBatches
    ) {
      const prompts = userPromptManager.getPromptsForUserLearning(threshold);
      if (prompts.length === 0) break;

      batchesThisRun += 1;
      const existingProfile = userProfileManager.getActiveProfile(userId);
      const { context, languageName } = buildUserAnalysisContext(prompts, existingProfile);
      const updatedProfileData = await analyzeUserProfile(context, existingProfile, languageName);

      if (!updatedProfileData) {
        userPromptManager.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));
        continue;
      }

      if (existingProfile) {
        const changeSummary = generateChangeSummary(
          safeJSONParse(existingProfile.profileData) as any,
          updatedProfileData
        );
        userProfileManager.updateProfile(
          existingProfile.id,
          updatedProfileData,
          prompts.length,
          changeSummary
        );
      } else {
        userProfileManager.createProfile(
          userId,
          tags.user.displayName || "Unknown",
          tags.user.userName || "unknown",
          tags.user.userEmail || "unknown",
          updatedProfileData,
          prompts.length
        );
      }

      userPromptManager.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));
      totalAnalyzed += prompts.length;
    }

    if (totalAnalyzed > 0 && CONFIG.showUserProfileToasts) {
      await ctx.client?.tui
        .showToast({
          body: {
            title: "User Profile Updated",
            message: `Analyzed ${totalAnalyzed} prompts and updated your profile`,
            variant: "success",
            duration: 3000,
          },
        })
        .catch(() => {
          // Notification errors are non-critical
        });
    }
  } finally {
    isLearningRunning = false;
  }
}

function generateChangeSummary(oldProfile: UserProfileData, newProfile: UserProfileData): string {
  const changes: string[] = [];
  const sections: Array<[string, number, number]> = [
    ["preferences", oldProfile.preferences.length, newProfile.preferences.length],
    ["patterns", oldProfile.patterns.length, newProfile.patterns.length],
    ["workflows", oldProfile.workflows.length, newProfile.workflows.length],
  ];
  for (const [name, oldLen, newLen] of sections) {
    const diff = newLen - oldLen;
    if (diff > 0) changes.push(`+${diff} ${name}`);
  }
  return changes.length > 0 ? changes.join(", ") : "Profile refinement";
}

export function buildUserAnalysisContext(
  prompts: UserPrompt[],
  existingProfile: UserProfile | null
): { context: string; languageName: string | null } {
  const languageName = existingProfile ? null : detectDominantLanguageName(prompts);
  const languageSection = `## Language

${languageInstruction(Boolean(existingProfile), languageName)}`;

  const existingProfileSection = existingProfile
    ? `
## Existing User Profile

${existingProfile.profileData}

**Instructions**: Merge new insights with the existing profile. Update confidence scores for reinforced patterns, add new patterns, and refine existing ones.`
    : `
**Instructions**: Create a new user profile from scratch based on the prompts below.`;

  return {
    languageName,
    context: `# User Profile Analysis

Analyze ${prompts.length} user prompts to ${existingProfile ? "update" : "create"} the user profile.

${languageSection}

${existingProfileSection}

## Recent Prompts

${prompts.map((p, i) => `${i + 1}. ${p.content}`).join("\n\n")}

## Analysis Guidelines

Identify and ${existingProfile ? "update" : "create"}:

1. **Preferences** (max ${CONFIG.userProfileMaxPreferences})
   - Code style, communication style, tool preferences
   - Assign confidence 0.5-1.0 based on evidence strength
   - Include 1-3 example prompts as evidence

2. **Patterns** (max ${CONFIG.userProfileMaxPatterns})
   - Recurring topics, problem domains, technical interests
   - Track frequency of occurrence

3. **Workflows** (max ${CONFIG.userProfileMaxWorkflows})
   - Development sequences, habits, learning style
   - Break down into steps if applicable

${existingProfile ? "Merge with existing profile, incrementing frequencies and updating confidence scores." : "Create initial profile with conservative confidence scores."}`,
  };
}

function detectDominantLanguageName(prompts: UserPrompt[]): string | null {
  const counts = new Map<string, number>();
  for (const prompt of prompts) {
    const code = detectLanguage(prompt.content);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let bestCode: string | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      bestCode = code;
      bestCount = count;
    }
  }
  return bestCode ? getLanguageName(bestCode) : null;
}

async function analyzeUserProfile(
  context: string,
  existingProfile: UserProfile | null,
  languageName: string | null
): Promise<UserProfileData | null> {
  if (CONFIG.opencodeProvider && CONFIG.opencodeModel) {
    const { isProviderConnected, getStatePath, generateStructuredOutput } =
      await import("./ai/opencode-provider.js");

    if (!isProviderConnected(CONFIG.opencodeProvider)) {
      throw new Error(
        `opencode provider '${CONFIG.opencodeProvider}' is not connected. Check your opencode provider configuration.`
      );
    }

    const schema = z.object({
      preferences: z.array(
        z.object({
          category: z.string(),
          description: z.string(),
          confidence: z.number(),
          evidence: z.array(z.string()),
        })
      ),
      patterns: z.array(
        z.object({
          category: z.string(),
          description: z.string(),
        })
      ),
      workflows: z.array(
        z.object({
          description: z.string(),
          steps: z.array(z.string()),
        })
      ),
    });

    const result = await generateStructuredOutput({
      providerName: CONFIG.opencodeProvider,
      modelId: CONFIG.opencodeModel,
      statePath: getStatePath(),
      systemPrompt: USER_PROFILE_SYSTEM_PROMPT(Boolean(existingProfile), languageName ?? undefined),
      userPrompt: context,
      schema,
      temperature:
        CONFIG.memoryTemperature === false ? undefined : (CONFIG.memoryTemperature ?? 0.3),
    });

    // The LLM is instructed to return the fully merged profile; code only enforces
    // the configured maximums (a second merge here would double-increment frequencies
    // and confidence scores).
    return userProfileManager.enforceProfileLimits(result as unknown as UserProfileData);
  }

  if (!CONFIG.memoryModel || !CONFIG.memoryApiUrl) {
    log("User Profile Config Check Failed:", {
      memoryModel: CONFIG.memoryModel,
      memoryApiUrl: CONFIG.memoryApiUrl,
      memoryApiKey: CONFIG.memoryApiKey,
    });
    throw new Error("External API not configured for user memory learning");
  }

  const { AIProviderFactory } = await import("./ai/ai-provider-factory.js");
  const { buildMemoryProviderConfig } = await import("./ai/provider-config.js");

  const providerConfig = buildMemoryProviderConfig(CONFIG);

  const provider = AIProviderFactory.createProvider(CONFIG.memoryProvider, providerConfig);

  const toolSchema = {
    type: "function" as const,
    function: {
      name: "update_user_profile",
      description: existingProfile
        ? "Update existing user profile with new insights"
        : "Create new user profile",
      parameters: USER_PROFILE_TOOL_PARAMS,
    },
  };

  const result = await provider.executeToolCall(
    USER_PROFILE_SYSTEM_PROMPT(Boolean(existingProfile), languageName ?? undefined),
    context,
    toolSchema,
    `user-profile-${Date.now()}`
  );

  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to analyze user profile");
  }

  const rawData = result.data;

  // The LLM returns the fully merged profile (tool description says "Update existing
  // user profile with new insights"); code only enforces the configured maximums.
  return userProfileManager.enforceProfileLimits(rawData as UserProfileData);
}
