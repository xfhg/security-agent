import { spawn } from "node:child_process";
import { containedEnv } from "../core/toolchain.ts";
import { nowIso } from "../core/provenance.ts";

export interface McpProbeResult {
  ok: boolean;
  command: string[];
  start_time: string;
  end_time: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  responses: unknown[];
  server_info?: unknown;
  tools?: unknown[];
  error?: string;
}

export async function probeMcpInitialize(command: string[], cwd: string, timeoutMs = 5_000): Promise<McpProbeResult> {
  return runMcpMessages(command, cwd, [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "security-agent", version: "0.1.0" }
      }
    },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  ], timeoutMs);
}

export async function callMcpTool(command: string[], cwd: string, toolName: string, args: Record<string, unknown>, timeoutMs = 10_000): Promise<McpProbeResult> {
  return runMcpMessages(command, cwd, [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "security-agent", version: "0.1.0" }
      }
    },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args }
    }
  ], timeoutMs);
}

function runMcpMessages(command: string[], cwd: string, messages: unknown[], timeoutMs: number): Promise<McpProbeResult> {
  const start = nowIso();
  return new Promise((resolve) => {
    const child = spawn(command[0]!, command.slice(1), { cwd, stdio: ["pipe", "pipe", "pipe"], env: containedEnv() });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (exitCode: number | null, forcedError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already be gone.
      }
      const responses = parseJsonLines(stdout);
      const init = responses.find((item: any) => item?.id === 1) as any;
      const toolsResponse = responses.find((item: any) => item?.id === 2) as any;
      const ok = Boolean(init?.result) && !init?.error && !forcedError;
      resolve({
        ok,
        command,
        start_time: start,
        end_time: nowIso(),
        exit_code: exitCode,
        stdout,
        stderr,
        responses,
        server_info: init?.result?.serverInfo,
        tools: toolsResponse?.result?.tools,
        error: forcedError ?? init?.error?.message ?? (ok ? undefined : stderr || "MCP initialize failed")
      });
    };
    const timer = setTimeout(() => finish(null, `MCP probe timed out after ${timeoutMs}ms`), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const responses = parseJsonLines(stdout);
      if (responses.some((item: any) => item?.id === 2)) finish(null);
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => finish(1, error.message));
    child.on("close", (code) => finish(code ?? 0));
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

function parseJsonLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Ignore non-JSON logging lines.
    }
  }
  return out;
}
