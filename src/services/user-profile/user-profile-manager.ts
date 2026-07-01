import { type Database } from "../sqlite/sqlite-bootstrap.js";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { connectionManager } from "../sqlite/connection-manager.js";
import { CONFIG } from "../../config.js";
import { safeJSONParse } from "../utils/safe-transforms.js";
import { log } from "../logger.js";
import { type UserProfile, type UserProfileData, type UserProfileChangelog } from "./types.js";

function safeArray<T>(val: T[] | string | undefined | null): T[] {
  if (!val) return [];
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(val) ? val : [];
}

const USER_PROFILES_DB_NAME = "user-profiles.db";

export class UserProfileManager {
  private readonly db: Database;
  private readonly dbPath: string;

  constructor() {
    this.dbPath = join(CONFIG.storagePath, USER_PROFILES_DB_NAME);
    this.db = connectionManager.getConnection(this.dbPath);
    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_email TEXT NOT NULL,
        profile_data TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_analyzed_at INTEGER NOT NULL,
        total_prompts_analyzed INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT 1
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_profile_changelogs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        change_type TEXT NOT NULL,
        change_summary TEXT NOT NULL,
        profile_data_snapshot TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
      )
    `);

    const indexes: [string, string, string][] = [
      ["user_profiles", "idx_user_profiles_user_id", "user_id"],
      ["user_profiles", "idx_user_profiles_is_active", "is_active"],
      ["user_profile_changelogs", "idx_user_profile_changelogs_profile_id", "profile_id"],
      ["user_profile_changelogs", "idx_user_profile_changelogs_version", "version DESC"],
    ];
    for (const [table, name, column] of indexes) {
      this.db.run(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${column})`);
    }
  }

  getActiveProfile(userId: string): UserProfile | null {
    const stmt = this.db.prepare(`
      SELECT * FROM user_profiles 
      WHERE user_id = ? AND is_active = 1
      LIMIT 1
    `);

    const row = stmt.get(userId) as any;
    if (!row) return null;

    return this.rowToProfile(row);
  }

  createProfile(
    userId: string,
    displayName: string,
    userName: string,
    userEmail: string,
    profileData: UserProfileData,
    promptsAnalyzed: number
  ): string {
    const id = `profile_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const now = Date.now();

    const cleanedData: UserProfileData = {
      preferences: safeArray(profileData.preferences),
      patterns: safeArray(profileData.patterns),
      workflows: safeArray(profileData.workflows),
    };

    const stmt = this.db.prepare(`
      INSERT INTO user_profiles (
        id, user_id, display_name, user_name, user_email, 
        profile_data, version, created_at, last_analyzed_at, 
        total_prompts_analyzed, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1)
    `);

    stmt.run(
      id,
      userId,
      displayName,
      userName,
      userEmail,
      JSON.stringify(cleanedData),
      now,
      now,
      promptsAnalyzed
    );

    this.addChangelog(id, 1, "create", "Initial profile creation", cleanedData);

    return id;
  }

  // NOSONAR S3776: Profile update with optimistic concurrency control (version check),
  // changelog insertion, and cleanup requires atomic transaction orchestration — complexity is inherent.
  updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string
  ): void {
    const now = Date.now();

    const cleanedData: UserProfileData = {
      preferences: safeArray(profileData.preferences),
      patterns: safeArray(profileData.patterns),
      workflows: safeArray(profileData.workflows),
    };

    let inTxn = false;
    try {
      this.db.run("BEGIN TRANSACTION");
      inTxn = true;

      const getVersionStmt = this.db.prepare("SELECT version FROM user_profiles WHERE id = ?");
      const versionRow = getVersionStmt.get(profileId) as any;
      const newVersion = (versionRow?.version || 0) + 1;

      const updateStmt = this.db.prepare(`
        UPDATE user_profiles
        SET profile_data = ?,
            version = ?,
            last_analyzed_at = ?,
            total_prompts_analyzed = total_prompts_analyzed + ?
        WHERE id = ? AND version = ?
      `);

      const result = updateStmt.run(
        JSON.stringify(cleanedData),
        newVersion,
        now,
        additionalPromptsAnalyzed,
        profileId,
        versionRow?.version || 0
      );
      if (result.changes === 0) {
        throw new Error(`Concurrent update detected for profile ${profileId}`);
      }

      this.addChangelog(profileId, newVersion, "update", changeSummary, cleanedData);
      this.cleanupOldChangelogs(profileId);

      this.db.run("COMMIT");
      inTxn = false;
    } catch (error) {
      if (inTxn) {
        try {
          this.db.run("ROLLBACK");
        } catch (rollbackErr) {
          log("Profile update rollback failed", { error: String(rollbackErr) });
        }
      }
      throw error;
    }
  }

  private addChangelog(
    profileId: string,
    version: number,
    changeType: string,
    changeSummary: string,
    profileData: UserProfileData
  ): void {
    const id = `changelog_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO user_profile_changelogs (
        id, profile_id, version, change_type, change_summary, 
        profile_data_snapshot, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, profileId, version, changeType, changeSummary, JSON.stringify(profileData), now);
  }

  private cleanupOldChangelogs(profileId: string): void {
    const retentionCount = CONFIG.userProfileChangelogRetentionCount;

    const stmt = this.db.prepare(`
      DELETE FROM user_profile_changelogs 
      WHERE profile_id = ? 
      AND id NOT IN (
        SELECT id FROM user_profile_changelogs 
        WHERE profile_id = ? 
        ORDER BY version DESC 
        LIMIT ?
      )
    `);

    stmt.run(profileId, profileId, retentionCount);
  }

  getProfileChangelogs(profileId: string, limit: number = 10): UserProfileChangelog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM user_profile_changelogs 
      WHERE profile_id = ? 
      ORDER BY version DESC 
      LIMIT ?
    `);

    const rows = stmt.all(profileId, limit) as any[];
    return rows.map((row) => this.rowToChangelog(row));
  }

  private rowToProfile(row: any): UserProfile {
    return {
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name,
      userName: row.user_name,
      userEmail: row.user_email,
      profileData: row.profile_data,
      version: row.version,
      createdAt: row.created_at,
      lastAnalyzedAt: row.last_analyzed_at,
      totalPromptsAnalyzed: row.total_prompts_analyzed,
      isActive: row.is_active === 1,
    };
  }

  private rowToChangelog(row: any): UserProfileChangelog {
    return {
      id: row.id,
      profileId: row.profile_id,
      version: row.version,
      changeType: row.change_type,
      changeSummary: row.change_summary,
      profileDataSnapshot: row.profile_data_snapshot,
      createdAt: row.created_at,
    };
  }

  private mergeSection<T>(
    existing: T[],
    incoming: T[] | undefined,
    matchFn: (existing: T, incoming: T) => boolean,
    updateFn: (existing: T, incoming: T) => T,
    createFn: (item: T) => T,
    sortKey: keyof T,
    maxCount: number
  ): T[] {
    if (!incoming) return existing;
    const result = [...existing];
    for (const newItem of incoming) {
      const idx = result.findIndex((ex) => matchFn(ex, newItem));
      if (idx >= 0 && result[idx]) {
        result[idx] = updateFn(result[idx], newItem);
      } else {
        result.push(createFn(newItem));
      }
    }
    result.sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
    return result.slice(0, maxCount);
  }

  mergeProfileData(existing: UserProfileData, updates: Partial<UserProfileData>): UserProfileData {
    const merged: UserProfileData = {
      preferences: safeArray(existing?.preferences),
      patterns: safeArray(existing?.patterns),
      workflows: safeArray(existing?.workflows),
    };

    merged.preferences = this.mergeSection(
      merged.preferences,
      safeArray(updates.preferences),
      (ex, inc) => ex.category === inc.category && ex.description === inc.description,
      (ex, inc) => ({
        ...inc,
        confidence: Math.min(1, (ex.confidence || 0) + 0.1),
        evidence: [...new Set([...safeArray(ex.evidence), ...safeArray(inc.evidence)])].slice(0, 5),
        lastUpdated: Date.now(),
      }),
      (item) => ({ ...item, lastUpdated: Date.now() }),
      "confidence",
      CONFIG.userProfileMaxPreferences
    );

    merged.patterns = this.mergeSection(
      merged.patterns,
      safeArray(updates.patterns),
      (ex, inc) => ex.category === inc.category && ex.description === inc.description,
      (ex, inc) => ({ ...inc, frequency: (ex.frequency || 1) + 1, lastSeen: Date.now() }),
      (item) => ({ ...item, frequency: 1, lastSeen: Date.now() }),
      "frequency",
      CONFIG.userProfileMaxPatterns
    );

    merged.workflows = this.mergeSection(
      merged.workflows,
      safeArray(updates.workflows),
      (ex, inc) => ex.description === inc.description,
      (ex, inc) => ({ ...inc, frequency: (ex.frequency || 1) + 1 }),
      (item) => ({ ...item, frequency: 1 }),
      "frequency",
      CONFIG.userProfileMaxWorkflows
    );

    return merged;
  }
}

let _userProfileManager: UserProfileManager | null = null;

function getUserProfileManager(): UserProfileManager {
  return (_userProfileManager ??= new UserProfileManager());
}

export const userProfileManager = new Proxy({} as UserProfileManager, {
  get(_target, prop) {
    const instance = getUserProfileManager();
    const value = (instance as any)[prop];
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});
