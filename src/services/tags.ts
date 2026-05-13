import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { CONFIG } from "../config.js";
import { normalize, resolve, isAbsolute, basename, dirname } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { log } from "./logger.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// Memoization caches — git config values don't change during a session
const gitEmailCache: { value: string | null; cached: boolean } = { value: null, cached: false };
const gitNameCache: { value: string | null; cached: boolean } = { value: null, cached: false };
const gitRepoUrlCache = new Map<string, string | null>();
const gitCommonDirCache = new Map<string, string | null>();
const gitTopLevelCache = new Map<string, string | null>();

export interface TagInfo {
  tag: string;
  displayName: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

function execGitCommand(
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): string | null {
  try {
    const result = spawnSync("git", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: options.timeout ?? 1000,
      cwd: options.cwd,
    });
    if (result.error || result.status !== 0) {
      throw result.error || new Error(`git exited with code ${result.status}`);
    }
    return result.stdout?.trim() || null;
  } catch (err) {
    log("Git command failed", { command: args.join(" "), cwd: options.cwd, error: String(err) });
    return null;
  }
}

export function getGitEmail(): string | null {
  if (gitEmailCache.cached) return gitEmailCache.value;
  gitEmailCache.value = execGitCommand(["config", "user.email"]);
  gitEmailCache.cached = true;
  return gitEmailCache.value;
}

export function getGitName(): string | null {
  if (gitNameCache.cached) return gitNameCache.value;
  gitNameCache.value = execGitCommand(["config", "user.name"]);
  gitNameCache.cached = true;
  return gitNameCache.value;
}

export function getGitRepoUrl(directory: string): string | null {
  if (!existsSync(directory)) {
    return null;
  }
  const cached = gitRepoUrlCache.get(directory);
  if (cached !== undefined) return cached;
  const result = execGitCommand(["config", "--get", "remote.origin.url"], { cwd: directory });
  gitRepoUrlCache.set(directory, result);
  return result;
}

export function getGitCommonDir(directory: string): string | null {
  if (!existsSync(directory)) {
    return null;
  }
  const cached = gitCommonDirCache.get(directory);
  if (cached !== undefined) return cached;
  const commonDir = execGitCommand(["rev-parse", "--git-common-dir"], { cwd: directory });
  if (!commonDir) {
    gitCommonDirCache.set(directory, null);
    return null;
  }

  const resolved = isAbsolute(commonDir)
    ? normalize(commonDir)
    : normalize(resolve(directory, commonDir));

  if (existsSync(resolved)) {
    const result = realpathSync(resolved);
    gitCommonDirCache.set(directory, result);
    return result;
  }

  gitCommonDirCache.set(directory, resolved);
  return resolved;
}

export function getGitTopLevel(directory: string): string | null {
  if (!existsSync(directory)) {
    return null;
  }
  const cached = gitTopLevelCache.get(directory);
  if (cached !== undefined) return cached;
  const result = execGitCommand(["rev-parse", "--show-toplevel"], { cwd: directory });
  gitTopLevelCache.set(directory, result);
  return result;
}

export function getProjectRoot(directory: string): string {
  const commonDir = getGitCommonDir(directory);
  if (commonDir && basename(commonDir) === ".git") {
    return dirname(commonDir);
  }

  const topLevel = getGitTopLevel(directory);
  if (topLevel) {
    return topLevel;
  }

  return directory;
}

export function getProjectIdentity(directory: string): string {
  const commonDir = getGitCommonDir(directory);
  if (commonDir) {
    return `git-common:${commonDir}`;
  }

  const gitRepoUrl = getGitRepoUrl(directory);
  if (gitRepoUrl) {
    return `remote:${gitRepoUrl}`;
  }

  return `path:${normalize(directory)}`;
}

export function getProjectName(directory: string): string {
  const parts = directory.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || directory;
}

export function getUserTagInfo(): TagInfo {
  const email = CONFIG.userEmailOverride || getGitEmail();
  const name = CONFIG.userNameOverride || getGitName();

  if (email) {
    return {
      tag: `${CONFIG.containerTagPrefix}_user_${sha256(email)}`,
      displayName: name || email,
      userName: name || undefined,
      userEmail: email,
    };
  }

  const fallback = name || process.env.USER || process.env.USERNAME || "anonymous";
  return {
    tag: `${CONFIG.containerTagPrefix}_user_${sha256(fallback)}`,
    displayName: fallback,
    userName: fallback,
    userEmail: undefined,
  };
}

export function getProjectTagInfo(directory: string): TagInfo {
  const projectRoot = getProjectRoot(directory);
  const projectName = getProjectName(projectRoot);
  const gitRepoUrl = getGitRepoUrl(directory);
  const projectIdentity = getProjectIdentity(projectRoot);

  return {
    tag: `${CONFIG.containerTagPrefix}_project_${sha256(projectIdentity)}`,
    displayName: projectRoot,
    projectPath: projectRoot,
    projectName,
    gitRepoUrl: gitRepoUrl || undefined,
  };
}

export function getTags(directory: string): {
  user: TagInfo;
  project: TagInfo;
} {
  return {
    user: getUserTagInfo(),
    project: getProjectTagInfo(directory),
  };
}
