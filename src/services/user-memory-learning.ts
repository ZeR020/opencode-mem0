import type { PluginInput } from "@opencode-ai/plugin";
import { randomBytes } from "node:crypto";
import { getTags } from "./tags.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";
import { userPromptManager } from "./user-prompt/user-prompt-manager.js";
import type { UserPrompt } from "./user-prompt/user-prompt-manager.js";
import { userProfileManager } from "./user-profile/user-profile-manager.js";
import type { UserProfile, UserProfileData } from "./user-profile/types.js";
import { safeJSONParse } from "./utils/safe-transforms.js";
import { z } from "zod";

const USER_PROFILE_SYSTEM_PROMPT = (
  existingProfile: boolean
) => `You are a user behavior analyst for a coding assistant.

Your task is to analyze user prompts and ${existingProfile ? "update" : "create"} a comprehensive user profile.

CRITICAL: Detect the language used by the user in their prompts. You MUST output all descriptions, categories, and text in the SAME language as the user's prompts.

Use the update_user_profile tool to save the ${existingProfile ? "updated" : "new"} profile.`;

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
    const count = userPromptManager.countUnanalyzedForUserLearning();
    const threshold = CONFIG.userProfileAnalysisInterval;

    if (count < threshold) {
      return;
    }

    const prompts = userPromptManager.getPromptsForUserLearning(threshold);

    if (prompts.length === 0) {
      return;
    }

    const tags = getTags(directory);
    const userId =
      tags.user.userEmail || `anonymous-${Date.now()}-${randomBytes(4).toString("hex")}`;

    let existingProfile = userProfileManager.getActiveProfile(userId);
    if (existingProfile) {
      userProfileManager.applyConfidenceDecay(userId);
      existingProfile = userProfileManager.getActiveProfile(userId);
    }

    const context = buildUserAnalysisContext(prompts, existingProfile);

    const updatedProfileData = await analyzeUserProfile(context, existingProfile);

    if (!updatedProfileData) {
      userPromptManager.markMultipleAsUserLearningCaptured(prompts.map((p) => p.id));
      return;
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

    if (CONFIG.showUserProfileToasts) {
      await ctx.client?.tui
        .showToast({
          body: {
            title: "User Profile Updated",
            message: `Analyzed ${prompts.length} prompts and updated your profile`,
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

function buildUserAnalysisContext(
  prompts: UserPrompt[],
  existingProfile: UserProfile | null
): string {
  const existingProfileSection = existingProfile
    ? `
## Existing User Profile

${existingProfile.profileData}

**Instructions**: Merge new insights with the existing profile. Update confidence scores for reinforced patterns, add new patterns, and refine existing ones.`
    : `
**Instructions**: Create a new user profile from scratch based on the prompts below.`;

  return `# User Profile Analysis

Analyze ${prompts.length} user prompts to ${existingProfile ? "update" : "create"} the user profile.

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

${existingProfile ? "Merge with existing profile, incrementing frequencies and updating confidence scores." : "Create initial profile with conservative confidence scores."}`;
}

async function analyzeUserProfile(
  context: string,
  existingProfile: UserProfile | null
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
      systemPrompt: USER_PROFILE_SYSTEM_PROMPT(Boolean(existingProfile)),
      userPrompt: context,
      schema,
      temperature:
        CONFIG.memoryTemperature === false ? undefined : (CONFIG.memoryTemperature ?? 0.3),
    });

    if (existingProfile) {
      const existingData = safeJSONParse(existingProfile.profileData) as any;
      return userProfileManager.mergeProfileData(
        existingData,
        result as unknown as Partial<UserProfileData>
      );
    }
    return result as UserProfileData;
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
    USER_PROFILE_SYSTEM_PROMPT(Boolean(existingProfile)),
    context,
    toolSchema,
    `user-profile-${Date.now()}`
  );

  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to analyze user profile");
  }

  const rawData = result.data;

  if (existingProfile) {
    const existingData = safeJSONParse(existingProfile.profileData) as any;
    return userProfileManager.mergeProfileData(existingData, rawData);
  }

  return rawData as UserProfileData;
}
