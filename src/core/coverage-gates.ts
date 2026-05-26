import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { detectAgentHarnessKit } from "../adapters/agent-harness-kit.ts";
import { detectCognium } from "../adapters/cognium.ts";
import { detectCodeTree } from "../adapters/codetree.ts";
import { detectGitNexus } from "../adapters/gitnexus.ts";
import { ghostPreflight, importGhostFindings, importGhostRepoContext } from "../adapters/ghost.ts";
import { probeMcpInitialize } from "../adapters/mcp-probe.ts";
import { detectOpenGrep } from "../adapters/opengrep.ts";
import { detectSemble } from "../adapters/semble.ts";
import { readJson, writeJson } from "./artifact-writer.ts";
import { agentPath, binPath, exists, securityAgentHome } from "./paths.ts";
import { nowIso, repoCommit } from "./provenance.ts";
import { containedEnv, executable, resolveContainedCommand } from "./toolchain.ts";
import { AhkRuntimeAdapter } from "../harness/ahk-runtime-adapter.ts";
import { gateTaskSpecs } from "./workflow-contract.ts";
import { spawn } from "node:child_process";

export type GateStatus = "success" | "blocked" | "blocked_or_degraded" | "skipped";

export interface CoverageGate {
  gate: string;
  status: GateStatus;
  required: boolean;
  command: string[];
  version: string | null;
  contained_path: string | null;
  start_time: string;
  end_time: string;
  exit_code: number | null;
  produced_artifacts: string[];
  blocker_reason: string | null;
  repo_commit: string;
  metadata?: Record<string, unknown>;
}

export interface CoverageStatus {
  scan_status: "complete" | "coverage_incomplete";
  allow_degraded: boolean;
  checked_at: string;
  repo_commit: string;
  required_gates: string[];
  blocked_gates: string[];
  degraded_gates: string[];
  skipped_gates: string[];
  gate_artifacts: string[];
}

const requiredGateNames = [
  "mcp-filesystem",
  "ahk",
  "mcp-codetree",
  "mcp-gitnexus",
  "tool-gitnexus",
  "tool-semble",
  "tool-opengrep",
  "tool-cognium",
  "ghost-repo-context",
  "ghost-deps",
  "ghost-secrets",
  "ghost-scan-code",
  "ghost-report"
];

export async function runCoverageGates(repo: string, options: { allowDegraded?: boolean } = {}): Promise<CoverageStatus> {
  const gates: CoverageGate[] = [];
  gates.push(await probeFilesystemMcp(repo));
  gates.push(await probeAhk(repo));
  gates.push(await probeCodeTreeMcp(repo));
  gates.push(await probeGitNexusMcp(repo));
  gates.push(await probeCommandGate(repo, "tool-gitnexus", "gitnexus", ["--version"]));
  gates.push(await probeCommandGate(repo, "tool-semble", "semble", ["--help"]));
  gates.push(await probeCommandGate(repo, "tool-opengrep", "opengrep", ["--version"]));
  gates.push(await probeCommandGate(repo, "tool-cognium", "cognium", ["--version"]));
  gates.push(...await probeGhostGates(repo));

  const blocked = gates.filter((gate) => gate.required && gate.status === "blocked");
  const degraded = gates.filter((gate) => gate.status === "blocked_or_degraded");
  const skipped = gates.filter((gate) => gate.status === "skipped");
  const status: CoverageStatus = {
    scan_status: blocked.length ? "coverage_incomplete" : "complete",
    allow_degraded: Boolean(options.allowDegraded),
    checked_at: nowIso(),
    repo_commit: await repoCommit(repo),
    required_gates: requiredGateNames,
    blocked_gates: blocked.map((gate) => gate.gate),
    degraded_gates: degraded.map((gate) => gate.gate),
    skipped_gates: skipped.map((gate) => `${gate.gate}: ${gate.blocker_reason ?? "skipped"}`),
    gate_artifacts: gates.map((gate) => `evidence/tool-gates/${gate.gate}.json`)
  };

  await writeJson(agentPath(repo, "evidence", "coverage-status.json"), status);
  await writeGateSummary(repo, status, gates);
  if (status.scan_status !== "complete" && !options.allowDegraded) {
    await writeCoverageSummary(repo, status, gates);
    throw new Error(`coverage_incomplete: blocked required gates: ${status.blocked_gates.join(", ")}`);
  }
  return status;
}

export async function runMcpDoctor(repo: string): Promise<CoverageGate[]> {
  const gates = [
    await probeFilesystemMcp(repo),
    await probeCodeTreeMcp(repo),
    await probeGitNexusMcp(repo)
  ];
  await writeJson(agentPath(repo, "evidence", "tool-gates", "mcp-summary.json"), {
    checked_at: nowIso(),
    repo_commit: await repoCommit(repo),
    gates: gates.map((gate) => ({
      gate: gate.gate,
      status: gate.status,
      command: gate.command,
      blocker_reason: gate.blocker_reason
    }))
  });
  return gates;
}

export async function readCoverageStatus(repo: string): Promise<CoverageStatus> {
  return readJson<CoverageStatus>(agentPath(repo, "evidence", "coverage-status.json"), {
    scan_status: "coverage_incomplete",
    allow_degraded: true,
    checked_at: nowIso(),
    repo_commit: await repoCommit(repo),
    required_gates: requiredGateNames,
    blocked_gates: ["coverage-status-missing"],
    degraded_gates: [],
    skipped_gates: [],
    gate_artifacts: []
  });
}

export async function readCoverageGates(repo: string): Promise<CoverageGate[]> {
  const gates: CoverageGate[] = [];
  for (const name of requiredGateNames) {
    const file = agentPath(repo, "evidence", "tool-gates", `${name}.json`);
    if (await exists(file)) gates.push(await readJson<CoverageGate>(file));
  }
  return gates;
}

export async function writeCoverageSummary(repo: string, status: CoverageStatus, gates: CoverageGate[]): Promise<void> {
  await writeJson(agentPath(repo, "evidence", "coverage-status.json"), status);
  await writeGateSummary(repo, status, gates);
  await writeFile(agentPath(repo, "security", "executive-summary.md"), `scan_status: ${status.scan_status}

# MVP Security-Agent Summary

## Executive Summary
- Scan status: ${status.scan_status}
- Allow degraded mode: ${status.allow_degraded}
- Blocked required gates: ${status.blocked_gates.length ? status.blocked_gates.join(", ") : "none"}
- Triage did not run because mandatory coverage gates failed.

## Coverage Gates
${gates.map((gate) => `- ${gate.gate}: ${gate.status}${gate.blocker_reason ? ` (${gate.blocker_reason})` : ""}`).join("\n") || "- none"}

## Required Action
- Install or repair contained tools under VulnOps and re-run the complete workflow.
- Use --allow-degraded only for research runs, not CISO-facing complete scans.
`, "utf8");
}

async function writeGateSummary(repo: string, status: CoverageStatus, gates: CoverageGate[]): Promise<void> {
  await writeJson(agentPath(repo, "evidence", "tool-gates", "summary.json"), {
    ...status,
    gates: gates.map((gate) => ({
      gate: gate.gate,
      status: gate.status,
      command: gate.command,
      contained_path: gate.contained_path,
      produced_artifacts: gate.produced_artifacts,
      blocker_reason: gate.blocker_reason
    }))
  });
}

async function probeAhk(repo: string): Promise<CoverageGate> {
  const start = nowIso();
  const capability = await detectAgentHarnessKit(repo);
  return writeGate(repo, {
    gate: "ahk",
    status: capability.available && capability.sync_exit_code === 0 && capability.status_exit_code === 0 ? "success" : "blocked",
    required: true,
    command: [binPath("shims", "ahk"), "sync/status"],
    version: null,
    contained_path: binPath("shims", "ahk"),
    start_time: start,
    end_time: nowIso(),
    exit_code: capability.available ? Math.max(capability.sync_exit_code ?? 1, capability.status_exit_code ?? 1) : null,
    produced_artifacts: ["evidence/agent-harness-kit.json"],
    blocker_reason: capability.available && capability.sync_exit_code === 0 && capability.status_exit_code === 0 ? null : capability.reason,
    repo_commit: await repoCommit(repo),
    metadata: capability
  });
}

async function probeFilesystemMcp(repo: string): Promise<CoverageGate> {
  const command = [binPath("shims", "filesystem-server"), securityAgentHome()];
  return probeMcpGate(repo, "mcp-filesystem", command);
}

async function probeCodeTreeMcp(repo: string): Promise<CoverageGate> {
  const command = [binPath("shims", "codetree"), "--root", repo];
  const mcp = await probeMcpGate(repo, "mcp-codetree", command);
  const capability = await detectCodeTree();
  mcp.metadata = { ...(mcp.metadata ?? {}), capability };
  return mcp;
}

async function probeGitNexusMcp(repo: string): Promise<CoverageGate> {
  const command = [binPath("shims", "gitnexus"), "mcp"];
  return probeMcpGate(repo, "mcp-gitnexus", command);
}

async function probeCommandGate(repo: string, gate: string, commandName: string, args: string[]): Promise<CoverageGate> {
  const start = nowIso();
  const resolver = await resolveContainedCommand(commandName);
  const result = resolver.contained ? await runCapture(resolver.command, args, repo, 10_000) : { code: null, stdout: "", stderr: resolver.reason ?? "not contained" };
  const detector =
    commandName === "gitnexus" ? await detectGitNexus() :
    commandName === "semble" ? await detectSemble() :
    commandName === "opengrep" ? await detectOpenGrep() :
    commandName === "cognium" ? await detectCognium() :
    null;
  const ok = resolver.contained && result.code === 0 && (!detector || detector.available);
  return writeGate(repo, {
    gate,
    status: ok ? "success" : "blocked",
    required: true,
    command: [commandName, ...args],
    version: result.stdout.trim().split("\n")[0] || detector?.version || null,
    contained_path: resolver.contained ? resolver.command : null,
    start_time: start,
    end_time: nowIso(),
    exit_code: result.code,
    produced_artifacts: [],
    blocker_reason: ok ? null : (detector?.reason ?? result.stderr) || "contained command failed",
    repo_commit: await repoCommit(repo),
    metadata: { ...(detector ? { capability: detector } : {}), probe: `binary probe: ${commandName} ${args.join(" ")}`, probe_exit_code: result.code }
  });
}

async function probeMcpGate(repo: string, gate: string, command: string[]): Promise<CoverageGate> {
  const start = nowIso();
  const file = command[0]!;
  const ok = await executable(file);
  const result = ok
    ? await probeMcpInitialize(command, securityAgentHome(), 6_000)
    : { ok: false, exit_code: null, stdout: "", stderr: "MCP command is not executable", error: "MCP command is not executable", responses: [], server_info: null, tools: [] };
  const success = ok && result.ok;
  return writeGate(repo, {
    gate,
    status: success ? "success" : "blocked",
    required: true,
    command,
    version: null,
    contained_path: ok ? file : null,
    start_time: start,
    end_time: nowIso(),
    exit_code: result.exit_code,
    produced_artifacts: [],
    blocker_reason: success ? null : (result.error ?? result.stderr) || "MCP JSON-RPC initialize failed",
    repo_commit: await repoCommit(repo),
    metadata: {
      jsonrpc_initialize: success,
      server_info: result.server_info,
      tools: result.tools,
      stderr_preview: result.stderr.slice(0, 1000),
      stdout_preview: result.stdout.slice(0, 1000)
    }
  });
}

async function probeGhostGates(repo: string): Promise<CoverageGate[]> {
  const preflight = await ghostPreflight(repo);
  const preflightOk = preflight.status === "ready";
  const repoContext = await importGhostRepoContext(repo);
  const code = await importGhostFindings(repo, "code");
  const deps = await importGhostFindings(repo, "deps");
  const secrets = await importGhostFindings(repo, "secrets");
  const reportExists = await exists(agentPath(repo, "evidence", "ghost", "report.md")) || await exists(agentPath(repo, "integrations", "ghost", "report.md"));
  const codeEvidence = await hasGhostEvidence(repo, "code");
  const depsEvidence = await hasGhostEvidence(repo, "deps");
  const secretsEvidence = await hasGhostEvidence(repo, "secrets");

  const resolveReason = async (artifactOk: boolean, artifactPaths: string[], fallback: string | null): Promise<string | null> => {
    if (preflightOk) return fallback;
    return (await artifactExists(repo, artifactPaths)) ? null : `Ghost binary blocked and ${artifactPaths.join(", ")} missing`;
  };

  return [
    await ghostGate(repo, "ghost-repo-context",
      preflightOk ? Boolean((repoContext as any).imported) : await artifactExists(repo, ["kb/ghost-context.json"]),
      ["kb/ghost-context.json"],
      await resolveReason(Boolean((repoContext as any).imported), ["kb/ghost-context.json"], (repoContext as any).reason)),
    await ghostGate(repo, "ghost-deps",
      preflightOk ? depsEvidence : await artifactExists(repo, ["findings/normalized/ghost-deps-findings.json"]),
      ["findings/normalized/ghost-deps-findings.json"],
      await resolveReason(depsEvidence, ["findings/normalized/ghost-deps-findings.json"], depsEvidence ? null : "Ghost dependency scan execution artifact missing")),
    await ghostGate(repo, "ghost-secrets",
      preflightOk ? secretsEvidence : await artifactExists(repo, ["findings/normalized/ghost-secrets-findings.json"]),
      ["findings/normalized/ghost-secrets-findings.json"],
      await resolveReason(secretsEvidence, ["findings/normalized/ghost-secrets-findings.json"], secretsEvidence ? null : "Ghost secrets scan execution artifact missing")),
    await ghostGate(repo, "ghost-scan-code",
      preflightOk ? (code.length > 0 || codeEvidence) : await artifactExists(repo, ["findings/normalized/ghost-code-findings.json"]),
      ["findings/normalized/ghost-code-findings.json"],
      await resolveReason(code.length > 0 || codeEvidence, ["findings/normalized/ghost-code-findings.json"], (code.length > 0 || codeEvidence) ? null : "Ghost code scan execution artifact missing")),
    await ghostGate(repo, "ghost-report",
      reportExists || await artifactExists(repo, ["security/ghost-findings.md"]),
      ["security/ghost-findings.md"],
      await resolveReason(reportExists, ["security/ghost-findings.md"], reportExists ? null : "Ghost report artifact missing"))
  ];}

async function artifactExists(repo: string, artifacts: string[]): Promise<boolean> {
  for (const artifact of artifacts) {
    if (await exists(agentPath(repo, artifact))) return true;
  }
  return false;
}

async function hasGhostEvidence(repo: string, scanType: "code" | "deps" | "secrets"): Promise<boolean> {
  if (await exists(agentPath(repo, "evidence", "ghost", `scan-${scanType}-findings.json`))) return true;
  return directoryHasFiles(agentPath(repo, "integrations", "ghost", "scans", scanType));
}

async function directoryHasFiles(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile());
  } catch {
    return false;
  }
}

async function ghostGate(repo: string, gate: string, ok: boolean, artifacts: string[], reason: string | null | undefined): Promise<CoverageGate> {
  return writeGate(repo, {
    gate,
    status: ok ? "success" : "blocked",
    required: true,
    command: ["ghost", gate],
    version: null,
    contained_path: securityAgentHome(),
    start_time: nowIso(),
    end_time: nowIso(),
    exit_code: ok ? 0 : 1,
    produced_artifacts: artifacts,
    blocker_reason: ok ? null : reason ?? "Ghost workflow evidence missing",
    repo_commit: await repoCommit(repo)
  });
}

async function ghostSkippedGate(repo: string, gate: string, reason: string): Promise<CoverageGate> {
  return writeGate(repo, {
    gate,
    status: "skipped",
    required: true,
    command: ["ghost", gate],
    version: null,
    contained_path: securityAgentHome(),
    start_time: nowIso(),
    end_time: nowIso(),
    exit_code: null,
    produced_artifacts: [],
    blocker_reason: reason,
    repo_commit: await repoCommit(repo)
  });
}

async function writeGate(repo: string, gate: CoverageGate): Promise<CoverageGate> {
  const artifact = agentPath(repo, "evidence", "tool-gates", `${gate.gate}.json`);
  await writeJson(artifact, gate);
  const harness = new AhkRuntimeAdapter();
  const spec = gateTaskSpecs[gate.gate] ?? {
    slug: `gate-${gate.gate}`,
    title: `Coverage gate: ${gate.gate}`,
    description: `Mandatory complete-scan gate for ${gate.gate}.`,
    acceptance: [`evidence/tool-gates/${gate.gate}.json exists`, `${gate.gate} succeeds`]
  };
  const taskId = harness.ensureTask(spec);
  harness.claim(taskId);
  const actionId = harness.startAction(taskId);
  harness.recordTool(actionId, gate.gate, { command: gate.command }, gate.status);
  harness.recordFile(actionId, `scans/<repo>/evidence/tool-gates/${gate.gate}.json`, "created", gate.blocker_reason ?? "gate evidence");
  if (gate.status === "success") {
    harness.markAllAcceptance(taskId);
    harness.writeSection(actionId, "result", `${gate.gate} succeeded`);
    harness.completeAction(actionId, `${gate.gate} succeeded`);
    await harness.completeTaskWithArtifacts(taskId, [artifact], `${gate.gate} succeeded`);
  } else if (gate.status === "skipped") {
    harness.markAllAcceptance(taskId);
    harness.writeSection(actionId, "result", `${gate.gate} skipped: ${gate.blocker_reason}`);
    harness.completeAction(actionId, `${gate.gate} skipped`);
    await harness.completeTaskWithArtifacts(taskId, [artifact], `${gate.gate} skipped: ${gate.blocker_reason}`);
  } else {
    const reason = gate.blocker_reason ?? `${gate.gate} failed`;
    harness.writeSection(actionId, "blockers", reason);
    harness.completeAction(actionId, reason, "blocked");
    harness.blockTask(taskId, reason);
  }
  harness.close();
  return gate;
}

async function runCapture(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: containedEnv() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: null, stdout, stderr });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
  });
}

export async function fileSha256(file: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    hash.update(await readFile(file));
    return hash.digest("hex");
  } catch {
    return null;
  }
}

export async function fileSize(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}
