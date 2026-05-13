import { userProfileManager } from "./user-profile-manager.js";
import type { UserProfileData } from "./types.js";

export function getUserProfileContext(userId: string): string | null {
  const profile = userProfileManager.getActiveProfile(userId);

  if (!profile) {
    return null;
  }

  let profileData: UserProfileData;
  try {
    profileData = JSON.parse(profile.profileData) as UserProfileData;
  } catch {
    return "User profile data is unavailable.";
  }
  const parts: string[] = [];

  if (Array.isArray(profileData.preferences) && profileData.preferences.length > 0) {
    parts.push("User Preferences:");
    profileData.preferences
      .toSorted((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
      .forEach((pref) => {
        parts.push(`- [${pref.category}] ${pref.description}`);
      });
  }

  if (Array.isArray(profileData.patterns) && profileData.patterns.length > 0) {
    parts.push("\nUser Patterns:");
    profileData.patterns
      .toSorted((a, b) => b.frequency - a.frequency)
      .slice(0, 5)
      .forEach((pattern) => {
        parts.push(`- [${pattern.category}] ${pattern.description}`);
      });
  }

  if (Array.isArray(profileData.workflows) && profileData.workflows.length > 0) {
    parts.push("\nUser Workflows:");
    profileData.workflows
      .toSorted((a, b) => b.frequency - a.frequency)
      .slice(0, 3)
      .forEach((workflow) => {
        parts.push(`- ${workflow.description}`);
      });
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n");
}
