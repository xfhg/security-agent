import { writeJson } from "../core/artifact-writer.ts";
import { agentPath, securityAgentHome } from "../core/paths.ts";
import { containedEnv, resolveContainedCommand } from "../core/toolchain.ts";
import { spawn } from "node:child_process";

export async function detectAgentHarnessKit(repo: string) {
  const ahk = await resolveContainedCommand("ahk");
  const cwd = securityAgentHome();
  const sync = ahk.contained ? await runAhk(cwd, ahk.command, ["sync", "--direction", "in"]) : null;
  const status = ahk.contained ? await runAhk(cwd, ahk.command, ["status", "--json"]) : null;
  const capability = {
    name: "@cardor/agent-harness-kit",
    available: ahk.contained,
    mode: "root-harness-mcp-with-target-artifact-record",
    reason: ahk.contained ? "root AHK harness synced from .harness/feature_list.json" : `local ahk unavailable: ${ahk.reason}`,
    capabilities: ["pending-tasks", "claimed-tasks", "task-status", "logs", "evidence-trails", "agent-handoffs"],
    harness_root: cwd,
    config_path: `${cwd}/agent-harness-kit.config.ts`,
    mcp_server: "agent-harness-kit",
    sync_exit_code: sync?.code ?? null,
    sync_stdout: sync?.stdout.slice(0, 2000) ?? null,
    sync_stderr: sync?.stderr.slice(0, 2000) ?? null,
    status_exit_code: status?.code ?? null,
    status_stdout: status?.stdout.slice(0, 6000) ?? null,
    status_stderr: status?.stderr.slice(0, 2000) ?? null,
    authoritative_store: `${securityAgentHome()}/.harness/harness.db`
  };
  await writeJson(agentPath(repo, "evidence", "agent-harness-kit.json"), capability);
  return capability;
}

function runAhk(cwd: string, command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: containedEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` }));
  });
}
