import { userProfileManager } from "./user-profile-manager.js";
import type { UserProfileData } from "./types.js";

function renderSection<T>(
  items: T[] | undefined,
  header: string,
  sortKey: keyof T & (string | number),
  limit: number,
  formatFn: (item: T) => string
): string[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  return [
    header,
    ...items
      .toSorted((a, b) => (b[sortKey] as number) - (a[sortKey] as number))
      .slice(0, limit)
      .map(formatFn),
  ];
}

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
  const parts: string[] = [
    ...renderSection(
      profileData.preferences,
      "User Preferences:",
      "confidence",
      5,
      (p) => `- [${p.category}] ${p.description}`
    ),
    ...renderSection(
      profileData.patterns,
      "\nUser Patterns:",
      "frequency",
      5,
      (p) => `- [${p.category}] ${p.description}`
    ),
    ...renderSection(
      profileData.workflows,
      "\nUser Workflows:",
      "frequency",
      3,
      (w) => `- ${w.description}`
    ),
  ];

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n");
}
