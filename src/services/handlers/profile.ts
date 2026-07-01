import { log } from "../logger.js";
import { safeToISOString, safeJSONParse } from "../utils/safe-transforms.js";
import type { UserProfileData } from "../user-profile/types.js";
import type { ApiResponse } from "./shared-types.js";
import { userProfileManager } from "../user-profile/user-profile-manager.js";
import { getTags } from "../tags.js";
import { userPromptManager } from "../user-prompt/user-prompt-manager.js";

export async function handleGetUserProfile(
  userId?: string
): Promise<ApiResponse<Record<string, unknown>>> {
  try {
    let targetUserId = userId;
    if (!targetUserId) {
      const tags = getTags(process.cwd());
      targetUserId = tags.user.userEmail || "unknown";
    }
    const decayResult = userProfileManager.applyConfidenceDecay(targetUserId);
    const profile = userProfileManager.getActiveProfile(targetUserId);
    if (!profile)
      return {
        success: true,
        data: {
          exists: false,
          userId: targetUserId,
          message: "No profile found. Keep chatting to build your profile.",
          decayApplied: decayResult.decayed,
        },
      };
    const profileData = safeJSONParse(profile.profileData) as Record<string, unknown> | undefined;
    return {
      success: true,
      data: {
        exists: true,
        id: profile.id,
        userId: profile.userId,
        displayName: profile.displayName,
        userName: profile.userName,
        userEmail: profile.userEmail,
        version: profile.version,
        createdAt: safeToISOString(profile.createdAt),
        lastAnalyzedAt: safeToISOString(profile.lastAnalyzedAt),
        totalPromptsAnalyzed: profile.totalPromptsAnalyzed,
        profileData,
        decayApplied: decayResult.decayed,
      },
    };
  } catch (error) {
    log("handleGetUserProfile: error", { error: String(error) });
    return { success: false, error: "Internal error in handleGetUserProfile" };
  }
}

export async function handleUpdateUserProfile(
  userId: string | undefined,
  profileData: UserProfileData
): Promise<ApiResponse<{ message: string }>> {
  try {
    const targetUserId = userId || "default";
    const profile = userProfileManager.getActiveProfile(targetUserId);

    if (!profile) {
      return { success: false, error: "No profile found to update." };
    }

    userProfileManager.updateProfile(profile.id, profileData, 0, "Manual profile edit via UI");

    return { success: true, data: { message: "Profile updated successfully." } };
  } catch (error) {
    log("API error in handleUpdateUserProfile", { error: String(error) });
    return { success: false, error: "Internal error updating profile" };
  }
}

export async function handleGetProfileChangelog(
  profileId: string,
  limit = 5
): Promise<ApiResponse<Record<string, unknown>[]>> {
  try {
    if (!profileId) return { success: false, error: "profileId is required" };
    const changelogs = userProfileManager.getProfileChangelogs(profileId, limit);
    const formattedChangelogs = changelogs.map((c) => ({
      id: c.id,
      profileId: c.profileId,
      version: c.version,
      changeType: c.changeType,
      changeSummary: c.changeSummary,
      createdAt: safeToISOString(c.createdAt),
    }));
    return { success: true, data: formattedChangelogs };
  } catch (error) {
    log("handleGetProfileChangelog: error", { error: String(error) });
    return { success: false, error: "Internal error in handleGetProfileChangelog" };
  }
}

export async function handleGetProfileSnapshot(
  changelogId: string
): Promise<ApiResponse<Record<string, unknown>>> {
  try {
    if (!changelogId) return { success: false, error: "changelogId is required" };
    const changelogs = userProfileManager.getProfileChangelogs(changelogId, 50);
    const changelog = changelogs.find((c) => c.id === changelogId);
    if (!changelog) return { success: false, error: "Changelog not found" };
    const profileData = safeJSONParse(changelog.profileDataSnapshot) as
      | Record<string, unknown>
      | undefined;
    return {
      success: true,
      data: {
        version: changelog.version,
        createdAt: safeToISOString(changelog.createdAt),
        profileData,
      },
    };
  } catch (error) {
    log("handleGetProfileSnapshot: error", { error: String(error) });
    return { success: false, error: "Internal error in handleGetProfileSnapshot" };
  }
}

export async function handleRefreshProfile(
  userId?: string
): Promise<ApiResponse<Record<string, unknown>>> {
  try {
    let targetUserId = userId;
    if (!targetUserId) {
      const tags = getTags(process.cwd());
      targetUserId = tags.user.userEmail || "unknown";
    }
    const decayResult = userProfileManager.applyConfidenceDecay(targetUserId);
    const unanalyzedCount = userPromptManager.countUnanalyzedForUserLearning();
    return {
      success: true,
      data: {
        message: "Profile refresh completed",
        unanalyzedPrompts: unanalyzedCount,
        decayApplied: decayResult.decayed,
        decayRemovedCount: decayResult.removed,
      },
    };
  } catch (error) {
    log("handleRefreshProfile: error", { error: String(error) });
    return { success: false, error: "Internal error in handleRefreshProfile" };
  }
}
