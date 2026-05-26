import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentPath, assertSafeWritePath } from "./paths.ts";
import { nowIso } from "./provenance.ts";

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  assertSafeWritePath(filePath, "json artifact");
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function readJson<T>(filePath: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

export async function writeStageLog(repo: string, stage: string, message: string): Promise<void> {
  const logPath = agentPath(repo, "logs", `${stage}.log`);
  assertSafeWritePath(logPath, "stage log");
  await appendFile(logPath, `[${nowIso()}] ${message}\n`, "utf8");
}

export function relativeArtifact(repo: string, filePath: string): string {
  return path.relative(agentPath(repo), filePath);
}
