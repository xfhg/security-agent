import { readFile } from "node:fs/promises";
import path from "node:path";
import { baseEnvelope } from "../../core/provenance.ts";
import { walk } from "./repo-cartographer.ts";

export async function buildGraph(repo: string) {
  const files = (await walk(repo)).filter((file) => /\.(ts|tsx|js|jsx|py|go)$/.test(file)).slice(0, 2000);
  const calls: any[] = [];
  for (const file of files) {
    const body = await readFile(path.join(repo, file), "utf8").catch(() => "");
    const funcs = [...body.matchAll(/\b(function\s+|def\s+|func\s+|const\s+)([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => ({ name: m[2], index: m.index ?? 0 }));
    for (const fn of funcs.slice(0, 50)) {
      const slice = body.slice(fn.index, fn.index + 3000);
      for (const call of slice.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        if (call[1] && call[1] !== fn.name) calls.push({ source_function: fn.name, target_function: call[1], source_file: file, target_file: "unknown", confidence: "low", reason: "lightweight lexical call pattern", tool_provenance: "graph-agent-fallback" });
      }
    }
  }
  return {
    callgraph: { ...(await baseEnvelope(repo, "callgraph", "graph-agent", ["fallback lexical graph; install GitNexus/codeTree for stronger results"])), calls: calls.slice(0, 10000) },
    dataflows: { ...(await baseEnvelope(repo, "dataflows", "graph-agent", ["dataflow is best-effort only in MVP fallback"])), flows: [] }
  };
}
