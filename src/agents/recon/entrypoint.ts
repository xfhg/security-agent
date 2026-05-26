import { readFile } from "node:fs/promises";
import path from "node:path";
import { baseEnvelope } from "../../core/provenance.ts";
import { walk } from "./repo-cartographer.ts";

const routePatterns = [
  /\b(app|router)\.(get|post|put|patch|delete|all)\(["'`]([^"'`]+)["'`]/g,
  /@(Get|Post|Put|Patch|Delete|Controller)\(["'`]?([^"'`)]*)/g,
  /\b(program|commander)\.command\(["'`]([^"'`]+)["'`]/g,
  /\bexports\.handler\b|\bhandler\s*=\s*async|\bmain\(/g
];

export async function buildEntrypoints(repo: string) {
  const files = (await walk(repo)).filter((file) => /\.(ts|tsx|js|jsx|py|go|java|rb|php|cs)$/.test(file));
  const entrypoints: any[] = [];
  for (const file of files) {
    const body = await readFile(path.join(repo, file), "utf8").catch(() => "");
    const lines = body.split("\n");
    for (const pattern of routePatterns) {
      for (const match of body.matchAll(pattern)) {
        const offset = match.index ?? 0;
        const line = body.slice(0, offset).split("\n").length;
        const matched = match[0];
        entrypoints.push({
          type: /command|main/.test(matched) ? "cli" : /handler/.test(matched) ? "rpc" : "http",
          path: file,
          line,
          function_or_class: "unknown",
          name: match[3] ?? match[2] ?? matched.slice(0, 80),
          authentication_assumptions: /auth|guard|middleware/i.test(lines.slice(Math.max(0, line - 8), line + 8).join("\n")) ? "auth control nearby" : "unknown",
          reachability_confidence: "medium",
          evidence: matched
        });
      }
    }
  }
  return { ...(await baseEnvelope(repo, "entrypoints", "entrypoint-agent", entrypoints.length ? [] : ["no entrypoints detected by lightweight patterns"])), entrypoints };
}
