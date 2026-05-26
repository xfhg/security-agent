import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "../core/artifact-writer.ts";
import { fileSha256, fileSize } from "../core/coverage-gates.ts";
import { binPath, localPath, platformArch, securityAgentHome } from "../core/paths.ts";
import { nowIso } from "../core/provenance.ts";
import { executable, resolveContainedCommand } from "../core/toolchain.ts";

const platforms = ["darwin-arm64", "darwin-amd64", "linux-arm64", "linux-amd64"];
const ghostTools = ["wraith", "osv-scanner", "poltergeist"];
const toolShims = ["opencode", "ahk", "filesystem-server", "codetree", "gitnexus", "semble", "opengrep", "cognium"];
const requiredContainedTools = ["codetree", "gitnexus", "filesystem-server", "semble", "opengrep", "cognium"];

export async function verifyToolchain(): Promise<any> {
  const entries = [
    ...await ghostEntries(),
    ...await opencodeEntries(),
    ...await shimEntries(),
    ...await containedToolEntries()
  ];
  const blockers = entries.filter((entry) => entry.required && entry.status !== "ready").map((entry) => ({
    name: entry.name,
    platform: entry.platform,
    path: entry.path ?? entry.resolved_path ?? entry.shim_path,
    status: entry.status,
    reason: entry.reason
  }));
  const lock = {
    schema_version: "0.1.0",
    artifact_type: "toolchain-lock",
    generated_at: nowIso(),
    security_agent_home: "${SECURITY_AGENT_HOME}",
    current_platform: platformArch(),
    portable_scope: "current_platform",
    portable: blockers.length === 0,
    blockers,
    entries
  };
  await writeJson(path.join(securityAgentHome(), "toolchain.lock.json"), lock);
  return lock;
}

export async function bundleToolchain(): Promise<{ path: string; lock: any; exit_code: number; stderr: string }> {
  const lock = await verifyToolchain();
  const outDir = localPath("toolchain");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `vulnops-toolchain-${platformArch()}-${Date.now()}.tar.gz`);
  const result = await runTar(["-czf", outPath, "--exclude=.opencode/node_modules", "--exclude=node_modules", "--exclude=.local/cache", "--exclude=.local/toolchain", "--exclude=targets/*", "bins", "ghost", ".opencode", ".local/venvs", ".local/python", "targets", "src", "docs", "config", "opencode.jsonc", "AGENTS.md", "OPERATIONMANUAL.md", "package.json", "package-lock.json", "agent-harness-kit.config.ts", "toolchain.lock.json"]);
  await writeFile(path.join(outDir, "last-bundle.json"), JSON.stringify({ path: outPath, exit_code: result.code, stderr: result.stderr, generated_at: nowIso() }, null, 2), "utf8");
  return { path: outPath, lock, exit_code: result.code, stderr: result.stderr };
}

async function ghostEntries() {
  const entries = [];
  const platform = platformArch();
  for (const name of ghostTools) entries.push(await entry(name, platform, binPath("ghost", platform, name), true, "github-release-vendored"));
  return entries;
}

async function opencodeEntries() {
  const platform = platformArch();
  return [await entry("opencode", platform, binPath("opencode", platform, "opencode"), true, "npm-package-binary-vendored")];
}

async function shimEntries() {
  return Promise.all(toolShims.map((name) => entry(`${name}-shim`, "all", binPath("shims", name), true, "local-shim")));
}

async function containedToolEntries() {
  return Promise.all(requiredContainedTools.map((name) => resolvedEntry(name)));
}

async function entry(name: string, platform: string, file: string, required: boolean, installMethod: string) {
  const ok = await executable(file);
  return {
    name,
    platform,
    path: path.relative(securityAgentHome(), file),
    required,
    status: ok ? "ready" : "not_portable_blocker",
    reason: ok ? null : "required contained executable missing",
    version: null,
    checksum_sha256: ok ? await fileSha256(file) : null,
    size_bytes: ok ? await fileSize(file) : null,
    source_url: null,
    install_method: installMethod
  };
}

async function resolvedEntry(name: string) {
  const resolved = await resolveContainedCommand(name);
  const file = resolved.command;
  const ok = resolved.contained && await executable(file);
  const inside = path.resolve(file).startsWith(securityAgentHome());
  const probe = ok && inside ? await probeResolvedCommand(name, file) : { ok: false, version: null, reason: resolved.reason ?? "resolved executable is missing or outside SECURITY_AGENT_HOME" };
  return {
    name,
    platform: platformArch(),
    shim_path: path.relative(securityAgentHome(), binPath("shims", name)),
    resolved_path: ok && inside ? path.relative(securityAgentHome(), file) : file,
    required: true,
    status: ok && inside && probe.ok ? "ready" : "not_portable_blocker",
    reason: ok && inside && probe.ok ? null : probe.reason,
    version: probe.version,
    checksum_sha256: ok && inside ? await fileSha256(file) : null,
    size_bytes: ok && inside ? await fileSize(file) : null,
    source_url: null,
    install_method: "runtime-resolved-contained-command"
  };
}

async function probeResolvedCommand(name: string, file: string): Promise<{ ok: boolean; version: string | null; reason: string | null }> {
  if (name === "filesystem-server") {
    const js = path.join(securityAgentHome(), "node_modules", "@modelcontextprotocol", "server-filesystem", "dist", "index.js");
    return executable(js) ? { ok: true, version: null, reason: null } : { ok: false, version: null, reason: "local filesystem MCP package is missing" };
  }
  const args = name === "codetree" || name === "semble" ? ["--help"] : ["--version"];
  const result = await runCommand(file, args, 5_000);
  return {
    ok: result.code === 0,
    version: result.stdout.trim().split("\n")[0] || null,
    reason: result.code === 0 ? null : result.stderr || result.stdout || `${name} probe failed`
  };
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: securityAgentHome(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number | null, extra = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr: `${stderr}${extra}` });
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null, `\nTimed out after ${timeoutMs}ms`);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => finish(code ?? 1));
    child.on("error", (error) => {
      finish(1, `\n${error.message}`);
    });
  });
}

function runTar(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("tar", args, { cwd: securityAgentHome(), stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", (error) => resolve({ code: 1, stderr: error.message }));
  });
}
