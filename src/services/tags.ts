import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { CONFIG } from "../config.js";
import { normalize, resolve, isAbsolute, basename, dirname } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { log } from "./logger.js";

const sha256 = (input: string): string =>
  createHash("sha256").update(input).digest("hex").slice(0, 16);

// Memoization caches — git config values don't change during a session
let cachedGitEmail: string | null | undefined;
let cachedGitName: string | null | undefined;
/** Guard that returns null when the directory doesn't exist on disk. */
const requireGitDirectory = (directory: string): true | null =>
  existsSync(directory) ? true : null;
const gitRepoUrlCache = new Map<string, string | null>();
const gitCommonDirCache = new Map<string, string | null>();
const gitTopLevelCache = new Map<string, string | null>();

// Fixed, unwriteable git locations only — no ambient PATH lookup (S4036).
const TRUSTED_GIT_PATHS = [
  "/usr/bin/git", // Linux + macOS system
  "/bin/git", // Older Linux / restricted shells
  "/usr/local/bin/git", // Homebrew Intel + manual installs
  "/opt/homebrew/bin/git", // Homebrew Apple Silicon
  "/usr/local/git/bin/git", // Official macOS git installer
];
let cachedGitPath: string | null | undefined;

const getGitExecutable = (): string | null => {
  if (cachedGitPath !== undefined) return cachedGitPath;
  cachedGitPath = TRUSTED_GIT_PATHS.find((path) => existsSync(path)) ?? null;
  return cachedGitPath;
};

export interface TagInfo {
  tag: string;
  displayName: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
}

const execGitCommand = (
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): string | null => {
  const gitExecutable = getGitExecutable();
  if (!gitExecutable) return null;

  try {
    const result = spawnSync(gitExecutable, args, {
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
};

export function getGitEmail(): string | null {
  if (cachedGitEmail !== undefined) return cachedGitEmail;
  cachedGitEmail = execGitCommand(["config", "user.email"]);
  return cachedGitEmail;
}

export function getGitName(): string | null {
  if (cachedGitName !== undefined) return cachedGitName;
  cachedGitName = execGitCommand(["config", "user.name"]);
  return cachedGitName;
}

export function getGitRepoUrl(directory: string): string | null {
  if (!requireGitDirectory(directory)) return null;
  const cached = gitRepoUrlCache.get(directory);
  if (cached !== undefined) return cached;
  const result = execGitCommand(["config", "--get", "remote.origin.url"], { cwd: directory });
  gitRepoUrlCache.set(directory, result);
  return result;
}

export function getGitCommonDir(directory: string): string | null {
  if (!requireGitDirectory(directory)) return null;
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
  if (!requireGitDirectory(directory)) return null;
  const cached = gitTopLevelCache.get(directory);
  if (cached !== undefined) return cached;
  const result = execGitCommand(["rev-parse", "--show-toplevel"], { cwd: directory });
  gitTopLevelCache.set(directory, result);
  return result;
}

export function getProjectRoot(directory: string): string {
  const commonDir = getGitCommonDir(directory);
  if (commonDir && basename(commonDir) === ".git") return dirname(commonDir);
  return getGitTopLevel(directory) ?? directory;
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
