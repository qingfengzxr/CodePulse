import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, join, posix, relative } from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import type { AnalysisSampling, ModuleUnit, RepositoryKind } from "@code-dance/domain";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const toml = require("toml") as { parse(input: string): unknown };

export type LocalRepositoryProbe = {
  name: string;
  defaultBranch: string | null;
  detectedKinds: RepositoryKind[];
};

export type GitCommit = {
  hash: string;
  committedAt: string;
};

export type DiffStatRow = {
  oldPath: string | null;
  newPath: string | null;
  added: number | null;
  deleted: number | null;
  isBinary: boolean;
};

export async function probeLocalRepository(
  localPath: string,
): Promise<LocalRepositoryProbe> {
  await access(localPath, fsConstants.R_OK);

  const pathStat = await stat(localPath);
  if (!pathStat.isDirectory()) {
    throw new Error("path is not a directory");
  }

  if (!(await isGitRepository(localPath))) {
    throw new Error("path is not a Git repository");
  }

  const defaultBranch = await readDefaultBranch(localPath);
  const detectedKinds = await detectRepositoryKinds(localPath);

  return {
    name: basename(localPath),
    defaultBranch,
    detectedKinds,
  };
}

async function readDefaultBranch(localPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      localPath,
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);

    const branch = stdout.trim();
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

async function detectRepositoryKinds(
  localPath: string,
): Promise<RepositoryKind[]> {
  const detected = new Set<RepositoryKind>();

  if (await fileExists(join(localPath, "Cargo.toml"))) {
    detected.add("rust");
  }

  if (await fileExists(join(localPath, "package.json"))) {
    detected.add("node");
  }

  if (await fileExists(join(localPath, "go.mod"))) {
    detected.add("go");
  }

  if (await fileExists(join(localPath, "pyproject.toml"))) {
    detected.add("python");
  }

  if (detected.size === 0) {
    detected.add("unknown");
  }

  return Array.from(detected);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readCargoToml(localPath: string): Promise<string | null> {
  const cargoTomlPath = join(localPath, "Cargo.toml");
  if (!(await fileExists(cargoTomlPath))) {
    return null;
  }

  return readFile(cargoTomlPath, "utf8");
}

export async function listCommits(
  localPath: string,
  branch: string,
): Promise<GitCommit[]> {
  const { stdout } = await execFileAsync("git", [
    "-C",
    localPath,
    "log",
    "--first-parent",
    "--reverse",
    "--format=%H%x09%cI",
    branch,
  ]);

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, committedAt] = line.split("\t");
      return {
        hash,
        committedAt,
      };
    });
}

export function sampleCommits(
  commits: GitCommit[],
  sampling: AnalysisSampling,
): GitCommit[] {
  if (sampling === "per-commit") {
    return commits;
  }

  if (sampling === "tag-based") {
    return commits.length > 0 ? [commits[commits.length - 1]] : [];
  }

  if (sampling === "daily") {
    return sampleCommitsByBucket(commits, (commit) =>
      commit.committedAt.slice(0, 10),
    );
  }

  if (sampling === "monthly") {
    return sampleCommitsByBucket(commits, (commit) =>
      commit.committedAt.slice(0, 7),
    );
  }

  return sampleCommitsByBucket(commits, (commit) => {
    const date = new Date(commit.committedAt);
    const weekDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = weekDate.getUTCDay() || 7;
    weekDate.setUTCDate(weekDate.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil(
      (((weekDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7,
    );
    return `${weekDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
  });
}

function sampleCommitsByBucket(
  commits: GitCommit[],
  getBucket: (commit: GitCommit) => string,
): GitCommit[] {
  const sampled: GitCommit[] = [];
  let previousBucket: string | null = null;
  let previousCommit: GitCommit | null = null;

  for (const commit of commits) {
    const currentBucket = getBucket(commit);
    if (previousBucket !== null && currentBucket !== previousBucket && previousCommit) {
      sampled.push(previousCommit);
    }

    previousBucket = currentBucket;
    previousCommit = commit;
  }

  if (previousCommit) {
    sampled.push(previousCommit);
  }

  return sampled;
}

export async function readTextFileAtRevision(
  localPath: string,
  revision: string,
  filePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      localPath,
      "show",
      `${revision}:${filePath}`,
    ], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });

    return typeof stdout === "string" ? stdout : String(stdout);
  } catch {
    return null;
  }
}

export async function listFilesAtRevision(
  localPath: string,
  revision: string,
): Promise<string[]> {
  const { stdout } = await execFileAsync("git", [
    "-C",
    localPath,
    "ls-tree",
    "-r",
    "--name-only",
    revision,
  ]);

  return stdout
    .split("\n")
    .map((line) => normalizeRelativePath(line.trim()))
    .filter((line) => line !== ".");
}

export async function readNumstatBetweenRevisions(
  localPath: string,
  fromRevision: string,
  toRevision: string,
): Promise<DiffStatRow[]> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "-C",
      localPath,
      "diff",
      "--numstat",
      "-z",
      "-M",
      fromRevision,
      toRevision,
    ],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  return parseNumstatZOutput(typeof stdout === "string" ? stdout : String(stdout));
}

export async function detectRustModulesAtRevision(
  localPath: string,
  revision: string,
): Promise<ModuleUnit[]> {
  return detectRustModulesFromReader(createGitRevisionReader(localPath, revision));
}

export async function detectNodeModules(
  localPath: string,
): Promise<ModuleUnit[]> {
  return detectNodeModulesFromReader(createLocalSnapshotReader(localPath));
}

export async function detectNodeModulesAtRevision(
  localPath: string,
  revision: string,
): Promise<ModuleUnit[]> {
  return detectNodeModulesFromReader(createGitRevisionReader(localPath, revision));
}

type CargoPackageTable = {
  name?: string;
};

type CargoWorkspaceTable = {
  members?: string[];
};

type CargoManifest = {
  package?: CargoPackageTable;
  workspace?: CargoWorkspaceTable;
};

type NodeWorkspaces = string[] | { packages?: string[] };

type NodePackageManifest = {
  name?: string;
  workspaces?: NodeWorkspaces;
};

type RustCrate = {
  name: string;
  rootPath: string;
  manifestPath: string;
};

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
]);

export async function detectRustModules(localPath: string): Promise<ModuleUnit[]> {
  return detectRustModulesFromReader(createLocalSnapshotReader(localPath));
}

async function detectRustModulesFromReader(
  reader: RepositorySnapshotReader,
): Promise<ModuleUnit[]> {
  const cargoToml = await reader.readTextFile("Cargo.toml");
  if (cargoToml === null) {
    return [];
  }

  const rootManifest = parseCargoManifest(cargoToml);
  const crateMap = new Map<string, RustCrate>();
  const workspaceMembers = await resolveWorkspaceMembers(reader, rootManifest);

  for (const workspaceMember of workspaceMembers) {
    crateMap.set(workspaceMember.rootPath, workspaceMember);
  }

  if (rootManifest.package?.name) {
    crateMap.set(".", {
      name: rootManifest.package.name,
      rootPath: ".",
      manifestPath: "Cargo.toml",
    });
  }

  return buildRustModuleUnits(await reader.listFiles(), Array.from(crateMap.values()));
}

function parseCargoManifest(content: string): CargoManifest {
  return toml.parse(content) as CargoManifest;
}

async function resolveWorkspaceMembers(
  reader: RepositorySnapshotReader,
  manifest: CargoManifest,
): Promise<RustCrate[]> {
  const members = manifest.workspace?.members ?? [];
  const rootEntries = new Map<string, RustCrate>();
  const repositoryFiles = await reader.listFiles();
  const cargoManifestPaths = repositoryFiles.filter((filePath) =>
    filePath === "Cargo.toml" || filePath.endsWith("/Cargo.toml"),
  );

  for (const memberPattern of members) {
    const resolvedPaths = resolveWorkspacePatternFromManifests(
      memberPattern,
      cargoManifestPaths,
      "Cargo.toml",
    );

    for (const resolvedPath of resolvedPaths) {
      const crate = await loadRustCrate(reader, resolvedPath);
      if (crate) {
        rootEntries.set(crate.rootPath, crate);
      }
    }
  }

  return Array.from(rootEntries.values()).sort((left, right) =>
    left.rootPath.localeCompare(right.rootPath),
  );
}

async function loadRustCrate(
  reader: RepositorySnapshotReader,
  crateRootPath: string,
): Promise<RustCrate | null> {
  const manifestPath =
    crateRootPath === "." ? "Cargo.toml" : posix.join(crateRootPath, "Cargo.toml");
  const manifestContent = await reader.readTextFile(manifestPath);
  if (manifestContent === null) {
    return null;
  }

  const manifest = parseCargoManifest(manifestContent);
  const packageName = manifest.package?.name;

  if (!packageName) {
    return null;
  }

  return {
    name: packageName,
    rootPath: crateRootPath,
    manifestPath,
  };
}

async function buildRustModuleUnits(
  repositoryFiles: string[],
  crates: RustCrate[],
): Promise<ModuleUnit[]> {
  const crateRoots = crates.map((entry) => entry.rootPath);

  return crates.map((crate) => {
    const excludedRoots = crateRoots.filter(
      (candidate) =>
        candidate !== crate.rootPath &&
        isNestedRelativePath(candidate, crate.rootPath),
    );

    const files = repositoryFiles
      .filter((filePath) => isWithinRoot(filePath, crate.rootPath))
      .filter(
        (filePath) =>
          !excludedRoots.some((excludedRoot) => isWithinRoot(filePath, excludedRoot)),
      )
      .sort((left, right) => left.localeCompare(right));

    return {
      key: `rust:crate:${crate.name}`,
      name: crate.name,
      kind: "rust-crate",
      rootPath: crate.rootPath,
      files,
      source: "auto" as const,
    };
  });
}

async function detectNodeModulesFromReader(
  reader: RepositorySnapshotReader,
): Promise<ModuleUnit[]> {
  const packageJson = await reader.readTextFile("package.json");
  if (packageJson === null) {
    return [];
  }

  const rootManifest = parseNodePackageManifest(packageJson);
  const repositoryFiles = await reader.listFiles();
  const packageMap = new Map<string, NodePackageEntry>();
  const workspaceMembers = await resolveNodeWorkspaceMembers(
    reader,
    rootManifest,
    repositoryFiles,
  );

  for (const workspaceMember of workspaceMembers) {
    packageMap.set(workspaceMember.rootPath, workspaceMember);
  }

  if (workspaceMembers.length === 0) {
    const fallbackMembers = inferFallbackNodeModules(repositoryFiles);
    for (const fallbackMember of fallbackMembers) {
      packageMap.set(fallbackMember.rootPath, fallbackMember);
    }
  }

  packageMap.set(".", {
    name: rootManifest.name?.trim() || "root",
    keySegment: rootManifest.name?.trim() || "root",
    rootPath: ".",
    manifestPath: "package.json",
  });

  return buildNodeModuleUnits(repositoryFiles, Array.from(packageMap.values()));
}

type NodePackageEntry = {
  name: string;
  keySegment: string;
  rootPath: string;
  manifestPath: string;
};

function parseNodePackageManifest(content: string): NodePackageManifest {
  return JSON.parse(content) as NodePackageManifest;
}

async function resolveNodeWorkspaceMembers(
  reader: RepositorySnapshotReader,
  manifest: NodePackageManifest,
  repositoryFiles: string[],
): Promise<NodePackageEntry[]> {
  const members = normalizeNodeWorkspacePatterns(manifest.workspaces);
  if (members.length === 0) {
    return [];
  }

  const rootEntries = new Map<string, NodePackageEntry>();
  const packageManifestPaths = repositoryFiles.filter((filePath) =>
    filePath === "package.json" || filePath.endsWith("/package.json"),
  );

  for (const memberPattern of members) {
    const resolvedPaths = resolveWorkspacePatternFromManifests(
      memberPattern,
      packageManifestPaths,
      "package.json",
    );

    for (const resolvedPath of resolvedPaths) {
      const nodePackage = await loadNodePackage(reader, resolvedPath);
      if (nodePackage) {
        rootEntries.set(nodePackage.rootPath, nodePackage);
      }
    }
  }

  return Array.from(rootEntries.values()).sort((left, right) =>
    left.rootPath.localeCompare(right.rootPath),
  );
}

function normalizeNodeWorkspacePatterns(workspaces: NodeWorkspaces | undefined): string[] {
  if (!workspaces) {
    return [];
  }

  if (Array.isArray(workspaces)) {
    return workspaces;
  }

  return workspaces.packages ?? [];
}

async function loadNodePackage(
  reader: RepositorySnapshotReader,
  packageRootPath: string,
): Promise<NodePackageEntry | null> {
  const manifestPath =
    packageRootPath === "." ? "package.json" : posix.join(packageRootPath, "package.json");
  const manifestContent = await reader.readTextFile(manifestPath);
  if (manifestContent === null) {
    return null;
  }

  const manifest = parseNodePackageManifest(manifestContent);
  const packageName = manifest.name?.trim() || fallbackNodePackageName(packageRootPath);

  return {
    name: packageName,
    keySegment: packageName,
    rootPath: packageRootPath,
    manifestPath,
  };
}

function fallbackNodePackageName(packageRootPath: string): string {
  if (packageRootPath === ".") {
    return "root";
  }

  const segments = packageRootPath.split("/");
  return segments.at(-1) ?? packageRootPath;
}

async function buildNodeModuleUnits(
  repositoryFiles: string[],
  packages: NodePackageEntry[],
): Promise<ModuleUnit[]> {
  const packageRoots = packages.map((entry) => entry.rootPath);

  return packages
    .map((pkg) => {
      const excludedRoots = packageRoots.filter(
        (candidate) =>
          candidate !== pkg.rootPath &&
          isNestedRelativePath(candidate, pkg.rootPath),
      );

      const files = repositoryFiles
        .filter((filePath) => isWithinRoot(filePath, pkg.rootPath))
        .filter(
          (filePath) =>
            !excludedRoots.some((excludedRoot) => isWithinRoot(filePath, excludedRoot)),
        )
        .filter((filePath) => isFrontendSourceFile(filePath))
        .sort((left, right) => left.localeCompare(right));

      return {
        key: `node:package:${pkg.keySegment}`,
        name: pkg.name,
        kind: "node-package",
        rootPath: pkg.rootPath,
        files,
        source: "auto" as const,
      };
    })
    .filter((module) => module.files.length > 0);
}

const FRONTEND_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".html",
  ".css",
]);

function isFrontendSourceFile(filePath: string): boolean {
  return Array.from(FRONTEND_SOURCE_EXTENSIONS).some((extension) =>
    filePath.endsWith(extension),
  );
}

const NESTED_NODE_CONTAINER_DIRS = new Set(["apps", "packages", "services", "os"]);
const EXCLUDED_NODE_FALLBACK_DIRS = new Set([
  ".code-review-graph",
  ".git",
  ".sentrux",
  ".vercel",
  "assets",
  "cache",
  "dist",
  "docs",
  "node_modules",
  "public",
  "tools",
]);

function inferFallbackNodeModules(repositoryFiles: string[]): NodePackageEntry[] {
  const sourceFiles = repositoryFiles.filter((filePath) => isFrontendSourceFile(filePath));
  const candidateRoots = new Set<string>();

  for (const filePath of sourceFiles) {
    const segments = filePath.split("/");
    if (segments.length < 2) {
      continue;
    }

    const topLevelDir = segments[0];
    if (!topLevelDir || EXCLUDED_NODE_FALLBACK_DIRS.has(topLevelDir)) {
      continue;
    }

    if (NESTED_NODE_CONTAINER_DIRS.has(topLevelDir) && segments.length >= 3) {
      const secondLevelDir = segments[1];
      if (secondLevelDir) {
        candidateRoots.add(`${topLevelDir}/${secondLevelDir}`);
      }
      continue;
    }

    candidateRoots.add(topLevelDir);
  }

  return Array.from(candidateRoots)
    .sort((left, right) => left.localeCompare(right))
    .map((rootPath) => ({
      name: rootPath,
      keySegment: rootPath.replaceAll("/", "-"),
      rootPath,
      manifestPath: rootPath === "." ? "package.json" : posix.join(rootPath, "package.json"),
    }));
}

async function listSubdirectories(absolutePath: string): Promise<string[]> {
  if (!(await directoryExists(absolutePath))) {
    return [];
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const pathStat = await stat(path);
    return pathStat.isDirectory();
  } catch {
    return false;
  }
}

function createSegmentMatcher(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", "[^/]+")}$`);
}

function createPathMatcher(pattern: string): RegExp {
  const segments = normalizeRelativePath(pattern).split("/").filter(Boolean);
  const expression = segments
    .map((segment) => {
      if (segment === "**") {
        return "(?:.+/)?";
      }

      const escaped = segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      return escaped.replaceAll("*", "[^/]+");
    })
    .join("/");

  return new RegExp(`^${expression}$`);
}

function isNestedRelativePath(candidate: string, root: string): boolean {
  if (root === ".") {
    return candidate !== ".";
  }

  return candidate !== root && candidate.startsWith(`${root}/`);
}

function isWithinRoot(filePath: string, rootPath: string): boolean {
  if (rootPath === ".") {
    return true;
  }

  return filePath === rootPath || filePath.startsWith(`${rootPath}/`);
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  return normalized.length === 0 ? "." : normalized;
}

function parseNumstatZOutput(output: string): DiffStatRow[] {
  const tokens = output.split("\0");
  const rows: DiffStatRow[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    const [addedRaw, deletedRaw, pathOrMarker] = token.split("\t");
    if (addedRaw === undefined || deletedRaw === undefined) {
      continue;
    }

    const isRenameLike = pathOrMarker === "";
    if (isRenameLike) {
      const oldPath = normalizeOptionalPath(tokens[index + 1]);
      const newPath = normalizeOptionalPath(tokens[index + 2]);
      rows.push({
        oldPath,
        newPath,
        added: parseNumstatCount(addedRaw),
        deleted: parseNumstatCount(deletedRaw),
        isBinary: addedRaw === "-" || deletedRaw === "-",
      });
      index += 2;
      continue;
    }

    rows.push({
      oldPath: normalizeOptionalPath(pathOrMarker),
      newPath: normalizeOptionalPath(pathOrMarker),
      added: parseNumstatCount(addedRaw),
      deleted: parseNumstatCount(deletedRaw),
      isBinary: addedRaw === "-" || deletedRaw === "-",
    });
  }

  return rows;
}

function parseNumstatCount(value: string): number | null {
  if (value === "-") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeOptionalPath(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeRelativePath(value);
  return normalized === "." ? null : normalized;
}

type RepositorySnapshotReader = {
  readTextFile(filePath: string): Promise<string | null>;
  listFiles(): Promise<string[]>;
};

function createGitRevisionReader(
  localPath: string,
  revision: string,
): RepositorySnapshotReader {
  let cachedFilesPromise: Promise<string[]> | null = null;

  return {
    async readTextFile(filePath) {
      return readTextFileAtRevision(localPath, revision, filePath);
    },
    async listFiles() {
      if (cachedFilesPromise === null) {
        cachedFilesPromise = listFilesAtRevision(localPath, revision);
      }
      return cachedFilesPromise;
    },
  };
}

function createLocalSnapshotReader(localPath: string): RepositorySnapshotReader {
  let cachedFilesPromise: Promise<string[]> | null = null;

  return {
    async readTextFile(filePath) {
      const absolutePath = join(localPath, filePath);
      if (!(await fileExists(absolutePath))) {
        return null;
      }
      return readFile(absolutePath, "utf8");
    },
    async listFiles() {
      if (cachedFilesPromise === null) {
        cachedFilesPromise = collectLocalRepositoryFiles(localPath);
      }
      return cachedFilesPromise;
    },
  };
}

async function collectLocalRepositoryFiles(localPath: string): Promise<string[]> {
  const files: string[] = [];
  await collectLocalRepositoryFilesRecursive(localPath, localPath, files);
  return files.sort((left, right) => left.localeCompare(right));
}

async function collectLocalRepositoryFilesRecursive(
  repositoryRoot: string,
  currentAbsolutePath: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(currentAbsolutePath, { withFileTypes: true });

  for (const entry of entries) {
    const absoluteEntryPath = join(currentAbsolutePath, entry.name);
    const relativeEntryPath = normalizeRelativePath(
      relative(repositoryRoot, absoluteEntryPath),
    );

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await collectLocalRepositoryFilesRecursive(
        repositoryRoot,
        absoluteEntryPath,
        files,
      );
      continue;
    }

    if (entry.isFile()) {
      files.push(relativeEntryPath);
    }
  }
}

function resolveWorkspacePatternFromManifests(
  pattern: string,
  manifestPaths: string[],
  manifestFileName: string,
): string[] {
  const matcher = createPathMatcher(pattern);
  const roots = manifestPaths
    .map((manifestPath) => dirnameFromManifest(manifestPath, manifestFileName))
    .filter((rootPath) => matcher.test(rootPath));

  return Array.from(new Set(roots)).sort((left, right) => left.localeCompare(right));
}

function dirnameFromManifest(manifestPath: string, manifestFileName: string): string {
  if (manifestPath === manifestFileName) {
    return ".";
  }

  return manifestPath.slice(0, -(`/${manifestFileName}`).length);
}

async function isGitRepository(localPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      localPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);

    return stdout.trim() === "true";
  } catch {
    return false;
  }
}
