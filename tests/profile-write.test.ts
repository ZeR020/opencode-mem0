/**
 * Tests for explicit user preference writes via UserProfileManager.
 * Exercises the write path added to src/index.ts `profile` mode
 * by testing the underlying manager directly (no live plugin context needed).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { connectionManager } from "../src/services/sqlite/connection-manager.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserProfilePreference, UserProfileData } from "../src/services/user-profile/types.js";

// We patch CONFIG.storagePath before importing the manager so the DB lands in tmp.
let originalStoragePath: string;
const tmpDirs: string[] = [];

async function makeManager() {
  const tmpDir = mkdtempSync(join(tmpdir(), "opencode-mem0-pw-"));
  tmpDirs.push(tmpDir);
  // Dynamic import after setting storagePath so the constructor picks up the temp dir.
  const { CONFIG } = await import("../src/config.js");
  if (originalStoragePath === undefined) {
    originalStoragePath = CONFIG.storagePath;
  }
  CONFIG.storagePath = tmpDir;
  // Bun may cache the imported module, so this helper does not try to reload it.
  // Instead, each test creates a new UserProfileManager instance after updating CONFIG.storagePath.
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  return { manager: new UserProfileManager(), tmpDir };
}

describe("UserProfileManager – explicit preference writes", () => {
  afterEach(async () => {
    connectionManager.closeAll();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
    if (originalStoragePath !== undefined) {
      const { CONFIG } = await import("../src/config.js");
      CONFIG.storagePath = originalStoragePath;
    }
  });

  it("creates a profile with an explicit preference when none exists", async () => {
    const { manager: mgr } = await makeManager();
    const userId = "test@example.com";

    mgr.createProfile(
      userId,
      "Test User",
      "testuser",
      userId,
      {
        preferences: [
          {
            category: "explicit",
            description: "Prefer concise answers",
            confidence: 1.0,
            evidence: ["manual-write"],
            lastUpdated: Date.now(),
          },
        ],
        patterns: [],
        workflows: [],
      },
      0
    );

    const profile = mgr.getActiveProfile(userId);
    expect(profile).not.toBeNull();
    const data = JSON.parse(profile!.profileData);
    expect(data.preferences).toHaveLength(1);
    expect(data.preferences[0].description).toBe("Prefer concise answers");
    expect(data.preferences[0].confidence).toBe(1.0);
    expect(data.preferences[0].evidence).toContain("manual-write");
  });

  it("merges a new explicit preference into an existing profile without clobbering other prefs", async () => {
    const { manager: mgr } = await makeManager();
    const userId = "test@example.com";

    // Seed with one AI-learned preference
    mgr.createProfile(
      userId,
      "Test User",
      "testuser",
      userId,
      {
        preferences: [
          {
            category: "style",
            description: "Uses TypeScript",
            confidence: 0.8,
            evidence: ["observed"],
            lastUpdated: Date.now(),
          },
        ],
        patterns: [],
        workflows: [],
      },
      3
    );

    const existingProfile = mgr.getActiveProfile(userId)!;
    const existingData = JSON.parse(existingProfile.profileData);

    const newPref = {
      category: "explicit",
      description: "Always use numbered lists",
      confidence: 1.0,
      evidence: ["manual-write"],
      lastUpdated: Date.now(),
    };

    const merged = mgr.mergeProfileData(existingData, { preferences: [newPref] });
    mgr.updateProfile(
      existingProfile.id,
      merged,
      0,
      "Explicit preference added: Always use numbered lists"
    );

    const updated = mgr.getActiveProfile(userId)!;
    const updatedData = JSON.parse(updated.profileData);

    expect(updatedData.preferences).toHaveLength(2);
    const descriptions = updatedData.preferences.map((p: any) => p.description);
    expect(descriptions).toContain("Uses TypeScript");
    expect(descriptions).toContain("Always use numbered lists");
    expect(updated.version).toBe(2);
  });

  it("deduplicates when the same explicit preference is written twice, boosting confidence", async () => {
    const { manager: mgr } = await makeManager();
    const userId = "test@example.com";
    const description = "Prefer short answers";

    const pref = {
      category: "explicit",
      description,
      confidence: 1.0,
      evidence: ["manual-write"],
      lastUpdated: Date.now(),
    };

    mgr.createProfile(
      userId,
      "Test User",
      "testuser",
      userId,
      {
        preferences: [pref],
        patterns: [],
        workflows: [],
      },
      0
    );

    // Write the same preference again (simulates calling profile+content twice)
    const p1 = mgr.getActiveProfile(userId)!;
    const d1 = JSON.parse(p1.profileData);
    const merged = mgr.mergeProfileData(d1, {
      preferences: [{ ...pref, lastUpdated: Date.now() }],
    });
    mgr.updateProfile(p1.id, merged, 0, "Explicit preference added: Prefer short answers");

    const p2 = mgr.getActiveProfile(userId)!;
    const d2 = JSON.parse(p2.profileData);
    // Still only one entry (deduplicated by category+description)
    expect(d2.preferences.filter((p: any) => p.description === description)).toHaveLength(1);
    // Confidence capped at 1.0 (bumped by 0.1 but clamped)
    const conf = d2.preferences.find((p: any) => p.description === description)!.confidence;
    expect(conf).toBeLessThanOrEqual(1.0);
    expect(conf).toBeGreaterThan(0.9);
  });

  it("returns null profile for unknown user (no auto-create on read)", async () => {
    const { manager: mgr } = await makeManager();
    const profile = mgr.getActiveProfile("nobody@example.com");
    expect(profile).toBeNull();
  });

  it("changelog entry is recorded on explicit preference write", async () => {
    const { manager: mgr } = await makeManager();
    const userId = "test@example.com";
    const summary = "Explicit preference added: Use snake_case";

    mgr.createProfile(
      userId,
      "Test User",
      "testuser",
      userId,
      {
        preferences: [],
        patterns: [],
        workflows: [],
      },
      0
    );

    const p = mgr.getActiveProfile(userId)!;
    const d = JSON.parse(p.profileData);
    const merged = mgr.mergeProfileData(d, {
      preferences: [
        {
          category: "explicit",
          description: "Use snake_case",
          confidence: 1.0,
          evidence: ["manual-write"],
          lastUpdated: Date.now(),
        },
      ],
    });
    mgr.updateProfile(p.id, merged, 0, summary);

    const changelogs = mgr.getProfileChangelogs(p.id);
    const last = changelogs[0];
    expect(last.changeSummary).toBe(summary);
    expect(last.changeType).toBe("update");
  });
});

describe("UserProfileManager – confidence decay", () => {
  it("normalizes generated preferences to set lastUpdated if missing", async () => {
    const { manager: mgr } = await makeManager();
    const userId = "test-decay@example.com";

    mgr.createProfile(
      userId,
      "Test User",
      "testuser",
      userId,
      {
        preferences: [
          {
            category: "test",
            description: "No timestamp",
            confidence: 0.8,
            evidence: ["test-evidence"],
          } as unknown as UserProfilePreference,
        ],
        patterns: [],
        workflows: [],
      },
      0
    );

    const profile = mgr.getActiveProfile(userId)!;
    const data = JSON.parse(profile.profileData) as UserProfileData;
    expect(data.preferences[0].lastUpdated).toBeDefined();
    expect(typeof data.preferences[0].lastUpdated).toBe("number");
    expect(data.preferences[0].lastUpdated).toBeGreaterThan(0);
  });

  it("applies confidence decay to preferences older than N days", async () => {
    const { manager: mgr } = await makeManager();
    const userId = "test-decay-age@example.com";

    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

    mgr.createProfile(
      userId,
      "Test User",
      "testuser",
      userId,
      {
        preferences: [
          {
            category: "test",
            description: "Old preference",
            confidence: 1.0,
            evidence: ["test-evidence"],
            lastUpdated: tenDaysAgo,
          },
        ],
        patterns: [],
        workflows: [],
      },
      0
    );

    const decayResult = mgr.applyConfidenceDecay(userId);
    expect(decayResult.decayed).toBe(true);
    expect(decayResult.removed).toBe(0);

    const profile = mgr.getActiveProfile(userId)!;
    const data = JSON.parse(profile.profileData) as UserProfileData;
    expect(data.preferences[0].confidence).toBeCloseTo(0.9);
  });

  it("removes preferences where confidence falls below 0.1", async () => {
    const { manager: mgr } = await makeManager();
    const userId = "test-decay-remove@example.com";

    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

    mgr.createProfile(
      userId,
      "Test User",
      "testuser",
      userId,
      {
        preferences: [
          {
            category: "test",
            description: "Stale low confidence preference",
            confidence: 0.1,
            evidence: ["test-evidence"],
            lastUpdated: tenDaysAgo,
          },
        ],
        patterns: [],
        workflows: [],
      },
      0
    );

    const decayResult = mgr.applyConfidenceDecay(userId);
    expect(decayResult.decayed).toBe(true);
    expect(decayResult.removed).toBe(1);

    const profile = mgr.getActiveProfile(userId)!;
    const data = JSON.parse(profile.profileData) as UserProfileData;
    expect(data.preferences).toHaveLength(0);
  });

  it("is idempotent: repeated calls within the same hour skip decay", async () => {
    const { manager: mgr } = await makeManager();
    const userId = "test-decay-idempotent@example.com";

    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

    mgr.createProfile(
      userId,
      "Test User",
      "testuser",
      userId,
      {
        preferences: [
          {
            category: "test",
            description: "Idempotency test preference",
            confidence: 1.0,
            evidence: ["test-evidence"],
            lastUpdated: tenDaysAgo,
          },
        ],
        patterns: [],
        workflows: [],
      },
      0
    );

    const now = Date.now();

    const res1 = mgr.applyConfidenceDecay(userId, now);
    expect(res1.decayed).toBe(true);

    const res2 = mgr.applyConfidenceDecay(userId, now);
    expect(res2.decayed).toBe(false);

    const res3 = mgr.applyConfidenceDecay(userId, now + 30 * 60 * 1000);
    expect(res3.decayed).toBe(false);

    const res4 = mgr.applyConfidenceDecay(userId, now + 61 * 60 * 1000);
    expect(res4.decayed).toBe(true);
  });
});
