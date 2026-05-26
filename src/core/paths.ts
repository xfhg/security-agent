import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { stableHash } from "./provenance.ts";

export const LOCAL_DIR = ".local";
export const BINS_DIR = "bins";
export const SCANS_DIR = "scans";

export function resolveRepo(repo: string): string {
  const resolved = path.resolve(repo);
  assertAllowedWorkspacePath(resolved, "repo");
  return resolved;
}

export function agentDir(repo: string): string {
  return path.join(securityAgentHome(), SCANS_DIR, repoPathSlug(repo));
}

function repoPathSlug(repo: string): string {
  return path.basename(resolveRepo(repo));
}

export function agentPath(repo: string, ...parts: string[]): string {
  const target = path.join(agentDir(repo), ...parts);
  assertTargetArtifactPath(repo, target, "artifact path");
  return target;
}

export const workspaceDirs = [
  "config",
  "kb",
  "findings/raw/ghost-code",
  "findings/raw/ghost-deps",
  "findings/raw/ghost-secrets",
  "findings/normalized",
  "findings/triaged",
  "evidence/tool-runs",
  "evidence/tool-gates",
  "evidence/code-snippets",
  "evidence/graph",
  "evidence/ghost",
  "integrations/ghost/scans/code",
  "integrations/ghost/scans/deps",
  "integrations/ghost/scans/secrets",
  "logs",
  "security",
  "review",
  "workflow"
];

export async function ensureWorkspaceDirs(repo: string): Promise<void> {
  await mkdir(agentDir(repo), { recursive: true });
  for (const dir of workspaceDirs) {
    await mkdir(agentPath(repo, dir), { recursive: true });
  }
}

export async function ensureControlPlaneDirs(): Promise<void> {
  for (const dir of [
    localPath("ghost", "repos"),
    localPath("cache", "npm"),
    localPath("cache", "bun"),
    localPath("cache", "uv"),
    localPath("cache", "pip"),
    localPath("state", "opencode"),
    localPath("home"),
    path.join(securityAgentHome(), "scans"),
    path.join(securityAgentHome(), "targets"),
    binPath("shims"),
    binPath("ghost", "darwin-arm64"),
    binPath("ghost", "darwin-amd64"),
    binPath("ghost", "linux-arm64"),
    binPath("ghost", "linux-amd64"),
    binPath("opencode", "darwin-arm64"),
    binPath("opencode", "darwin-amd64"),
    binPath("opencode", "linux-arm64"),
    binPath("opencode", "linux-amd64")
  ]) {
    assertControlPlaneWritePath(dir, "control-plane directory");
    await mkdir(dir, { recursive: true });
  }
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function requireInitialized(repo: string): Promise<void> {
  if (!(await exists(agentDir(repo)))) {
    throw new Error(`security-agent workspace missing. Run: security-agent init --repo ${repo}`);
  }
}

export function securityAgentHome(): string {
  return process.env.SECURITY_AGENT_HOME ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function localPath(...parts: string[]): string {
  return path.join(securityAgentHome(), LOCAL_DIR, ...parts);
}

export function binPath(...parts: string[]): string {
  return path.join(securityAgentHome(), BINS_DIR, ...parts);
}

export function platformArch(platform = process.platform, arch = process.arch): string {
  const normalizedPlatform = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform;
  const normalizedArch = arch === "x64" ? "amd64" : arch;
  return `${normalizedPlatform}-${normalizedArch}`;
}

export function isAllowedWorkspacePath(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const home = securityAgentHome();
  const tmp = path.resolve(os.tmpdir());
  return !isForbiddenPath(resolved) && (isPathInside(resolved, home) || isPathInside(resolved, tmp) || isPathInside(resolved, "/tmp"));
}

export function assertAllowedWorkspacePath(targetPath: string, label = "path"): void {
  if (!isAllowedWorkspacePath(targetPath)) {
    throw new Error(`${label} is outside allowed workspace roots. Allowed roots: ${securityAgentHome()} and /tmp`);
  }
}

export function assertControlPlaneWritePath(targetPath: string, label = "path"): void {
  const resolved = path.resolve(targetPath);
  if (!isAllowedWorkspacePath(resolved) || !isPathInside(resolved, securityAgentHome())) {
    throw new Error(`${label} is outside the VulnOps control-plane root: ${securityAgentHome()}`);
  }
}

export function assertTargetArtifactPath(repo: string, targetPath: string, label = "path"): void {
  const resolved = path.resolve(targetPath);
  const artifactRoot = agentDir(repo);
  const tmp = path.resolve(os.tmpdir());
  const home = securityAgentHome();
  if (isForbiddenPath(resolved) || !(isPathInside(resolved, artifactRoot) || isPathInside(resolved, home) || isPathInside(resolved, tmp) || isPathInside(resolved, "/tmp"))) {
    throw new Error(`${label} is outside target artifact roots. Allowed roots: ${artifactRoot} and ${home}`);
  }
}

export function assertSafeWritePath(targetPath: string, label = "path"): void {
  const resolved = path.resolve(targetPath);
  if (!isAllowedWorkspacePath(resolved)) {
    throw new Error(`${label} is outside allowed write roots. Allowed roots: ${securityAgentHome()} and /tmp`);
  }
}

export function repoRelativePath(repo: string, filePath: string): string {
  const resolved = resolveRepo(repo);
  if (filePath.startsWith(resolved)) {
    return `${path.basename(resolved)}/${path.relative(resolved, filePath)}`;
  }
  return filePath;
}

export function isForbiddenPath(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const home = os.homedir();
  const forbidden = [
    path.join(home, ".ghost"),
    path.join(home, ".bun"),
    path.join(home, ".npm"),
    path.join(home, ".cache"),
    path.join(home, ".local")
  ];
  return forbidden.some((root) => isPathInside(resolved, root));
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
