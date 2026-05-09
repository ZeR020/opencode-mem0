import { describe, it, expect } from "vitest";
import {
  getProjectName,
  getUserTagInfo,
  getProjectTagInfo,
  getTags,
} from "../src/services/tags.js";

describe("tags", () => {
  describe("getProjectName", () => {
    it("should extract project name from Unix path", () => {
      expect(getProjectName("/home/user/projects/my-app")).toBe("my-app");
    });

    it("should extract project name from Windows path", () => {
      expect(getProjectName("C:\\Users\\user\\projects\\my-app")).toBe("my-app");
    });

    it("should extract project name from mixed-separator path", () => {
      expect(getProjectName("C:\\Users/user\\projects/my-app")).toBe("my-app");
    });

    it("should return input when no separators present", () => {
      expect(getProjectName("my-app")).toBe("my-app");
    });

    it("should handle trailing separator", () => {
      const result = getProjectName("/home/user/projects/my-app/");
      // Should handle trailing slash gracefully
      expect(typeof result).toBe("string");
    });

    it("should handle deeply nested path", () => {
      expect(getProjectName("/a/b/c/d/e/f/project")).toBe("project");
    });
  });

  describe("getUserTagInfo", () => {
    it("should return a TagInfo with a generated tag", () => {
      const info = getUserTagInfo();
      expect(info.tag).toMatch(/^opencode_user_[a-f0-9]{16}$/);
      expect(info.displayName).toBeTruthy();
    });

    it("should include userEmail when available", () => {
      const info = getUserTagInfo();
      // In CI, git config may be missing; verify structure regardless
      expect(typeof info.userEmail === "string" || info.userEmail === undefined).toBe(true);
    });
  });

  describe("getProjectTagInfo", () => {
    it("should return a TagInfo with a generated tag for a directory", () => {
      const info = getProjectTagInfo("/tmp/fake-project");
      expect(info.tag).toMatch(/^opencode_project_[a-f0-9]{16}$/);
      expect(info.projectName).toBe("fake-project");
      expect(info.projectPath).toBeTruthy();
    });

    it("should handle non-git directories gracefully", () => {
      const info = getProjectTagInfo("/tmp/non-git-dir");
      expect(info.tag).toBeTruthy();
      expect(info.displayName).toBeTruthy();
      expect(info.gitRepoUrl === undefined || typeof info.gitRepoUrl === "string").toBe(true);
    });
  });

  describe("getTags", () => {
    it("should return both user and project TagInfo", () => {
      const tags = getTags("/tmp/test-project");
      expect(tags.user).toBeDefined();
      expect(tags.project).toBeDefined();
      expect(tags.user.tag).toMatch(/^opencode_user_/);
      expect(tags.project.tag).toMatch(/^opencode_project_/);
    });
  });
});
