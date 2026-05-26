import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolveRepo } from "./paths.ts";

export function nowIso(): string {
  return new Date().toISOString();
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export async function repoCommit(repo: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", resolveRepo(repo), "rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve(code === 0 ? out.trim() || "unknown" : "unknown"));
    child.on("error", () => resolve("unknown"));
  });
}

export async function baseEnvelope(repo: string, artifactType: string, generatedBy: string, limitations: string[] = []) {
  return {
    schema_version: "0.1.0",
    artifact_type: artifactType,
    repo_path: resolveRepo(repo),
    repo_commit: await repoCommit(repo),
    created_at: nowIso(),
    generated_by: generatedBy,
    provenance: [{ source: generatedBy, created_at: nowIso() }],
    tool_runs: [],
    confidence: limitations.length ? "medium" : "high",
    limitations
  };
}
