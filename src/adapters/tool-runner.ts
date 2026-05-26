import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentPath, assertSafeWritePath } from "../core/paths.ts";
import { nowIso, repoCommit, stableHash } from "../core/provenance.ts";
import { redactSecrets } from "../core/redaction.ts";
import { writeJson } from "../core/artifact-writer.ts";
import type { ToolRunRecord } from "../core/types.ts";
import { containedEnv, resolveContainedCommand } from "../core/toolchain.ts";

export async function runTool(repo: string, tool: string, command: string[], outputArtifactPath: string | null = null, timeoutMs = 120_000, successExitCodes: number[] = [0]): Promise<{ record: ToolRunRecord; stdout: string; stderr: string }> {
  const commit = await repoCommit(repo);
  const id = `${tool}-${stableHash(`${command.join(" ")}-${Date.now()}`).slice(0, 10)}`;
  const runDir = agentPath(repo, "evidence", "tool-runs", id);
  await mkdir(runDir, { recursive: true });
  const start = nowIso();
  const resolved = await resolveContainedCommand(command[0]!);
  const effectiveCommand = [resolved.command, ...command.slice(1)];
  if (!resolved.contained) {
    const end = nowIso();
    const stdoutPath = path.join(runDir, "stdout.txt");
    const stderrPath = path.join(runDir, "stderr.txt");
    const reason = resolved.reason ?? "command is not contained in VulnOps";
    await writeFile(stdoutPath, "", "utf8");
    await writeFile(stderrPath, reason, "utf8");
    const record: ToolRunRecord = {
      id,
      tool,
      command,
      start_time: start,
      end_time: end,
      exit_code: null,
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      output_artifact_path: outputArtifactPath,
      summarized_failure_reason: reason,
      repo_commit: commit
    };
    await writeJson(path.join(runDir, "tool-run.json"), record);
    return { record, stdout: "", stderr: reason };
  }
  return new Promise((resolve) => {
    const child = spawn(effectiveCommand[0]!, effectiveCommand.slice(1), { cwd: repo, stdio: ["ignore", "pipe", "pipe"], env: containedEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stderr += `\nTimed out after ${timeoutMs}ms`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("error", (error) => {
      stderr += error.message;
    });
    child.on("close", async (exitCode) => {
      clearTimeout(timer);
      const end = nowIso();
      const stdoutPath = path.join(runDir, "stdout.txt");
      const stderrPath = path.join(runDir, "stderr.txt");
      assertSafeWritePath(stdoutPath, "tool stdout");
      assertSafeWritePath(stderrPath, "tool stderr");
      await writeFile(stdoutPath, redactSecrets(stdout), "utf8");
      await writeFile(stderrPath, redactSecrets(stderr), "utf8");
      const record: ToolRunRecord = {
        id,
        tool,
        command,
        start_time: start,
        end_time: end,
        exit_code: exitCode,
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
        output_artifact_path: outputArtifactPath,
        summarized_failure_reason: exitCode !== null && successExitCodes.includes(exitCode) && !timedOut ? null : redactSecrets(stderr || stdout).slice(0, 500) || "tool failed without output",
        repo_commit: commit
      };
      await writeJson(path.join(runDir, "tool-run.json"), record);
      resolve({ record, stdout, stderr });
    });
  });
}

export async function detectCommand(name: string, capabilities: string[] = []): Promise<{ name: string; available: boolean; version?: string; path?: string; reason?: string; capabilities: string[] }> {
  const resolved = await resolveContainedCommand(name);
  if (!resolved.contained) return { name, available: false, reason: resolved.reason ?? "not contained", capabilities };
  const version = await runCommandCapture(resolved.command, ["--version"]);
  if (version.code !== 0) return { name, available: false, path: resolved.command, reason: "contained command failed --version check", capabilities };
  return { name, available: true, path: resolved.command, version: version.stdout.trim().split("\n")[0], capabilities };
}

async function runCommandCapture(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"], env: containedEnv() });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
    child.on("error", () => resolve({ code: 1, stdout: "" }));
  });
}
