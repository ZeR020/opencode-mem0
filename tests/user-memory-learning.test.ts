import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUserPromptManager = {
  countUnanalyzedForUserLearning: vi.fn(),
  getPromptsForUserLearning: vi.fn(),
  markMultipleAsUserLearningCaptured: vi.fn(),
};

const mockUserProfileManager = {
  getActiveProfile: vi.fn(),
  updateProfile: vi.fn(),
  createProfile: vi.fn(),
  mergeProfileData: vi.fn(),
};

vi.mock("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: mockUserPromptManager,
}));

vi.mock("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: mockUserProfileManager,
}));

vi.mock("../src/services/tags.js", () => ({
  getTags: () => ({
    project: {
      tag: "test-tag",
      displayName: "Test",
      userName: "test",
      userEmail: "test@example.com",
      projectPath: "/test",
      projectName: "TestProject",
      gitRepoUrl: "",
    },
    user: { userEmail: "test@example.com", displayName: "Test", userName: "test" },
  }),
}));

vi.mock("../src/services/logger.js", () => ({
  log: () => {},
}));

vi.mock("../src/config.js", () => ({
  CONFIG: {
    showUserProfileToasts: false,
    userProfileAnalysisInterval: 5,
    userProfileMaxPreferences: 10,
    userProfileMaxPatterns: 10,
    userProfileMaxWorkflows: 5,
    opencodeProvider: null,
    opencodeModel: null,
    memoryModel: null,
    memoryApiUrl: null,
    memoryTemperature: 0.3,
  },
}));

const { performUserProfileLearning } = await import("../src/services/user-memory-learning.js");

describe("user-memory-learning", () => {
  beforeEach(() => {
    mockUserPromptManager.countUnanalyzedForUserLearning.mockReset();
    mockUserPromptManager.getPromptsForUserLearning.mockReset();
    mockUserPromptManager.markMultipleAsUserLearningCaptured.mockReset();
    mockUserProfileManager.getActiveProfile.mockReset();
    mockUserProfileManager.updateProfile.mockReset();
    mockUserProfileManager.createProfile.mockReset();
    mockUserProfileManager.mergeProfileData.mockReset();
  });

  it("returns early when not enough prompts", async () => {
    mockUserPromptManager.countUnanalyzedForUserLearning.mockReturnValue(2);
    await performUserProfileLearning({} as any, "/test");
    expect(mockUserPromptManager.getPromptsForUserLearning).not.toHaveBeenCalled();
  });

  it("returns early when no prompts available", async () => {
    mockUserPromptManager.countUnanalyzedForUserLearning.mockReturnValue(10);
    mockUserPromptManager.getPromptsForUserLearning.mockReturnValue([]);
    await performUserProfileLearning({} as any, "/test");
    expect(mockUserProfileManager.getActiveProfile).not.toHaveBeenCalled();
  });

  it("handles missing API configuration", async () => {
    mockUserPromptManager.countUnanalyzedForUserLearning.mockReturnValue(10);
    mockUserPromptManager.getPromptsForUserLearning.mockReturnValue([
      { id: "p1", content: "test prompt" },
    ]);
    mockUserProfileManager.getActiveProfile.mockReturnValue(null);

    await expect(performUserProfileLearning({} as any, "/test")).rejects.toThrow(
      "External API not configured for user memory learning"
    );
  });
});
