import path from "node:path";
import { readFile } from "node:fs/promises";
import { agentPath, binPath, exists } from "../core/paths.ts";
import { stableHash } from "../core/provenance.ts";
import { writeJson } from "../core/artifact-writer.ts";
import { detectCommand, runTool } from "./tool-runner.ts";
import { callMcpTool, probeMcpInitialize } from "./mcp-probe.ts";
import { detectCodeTree } from "./codetree.ts";

export async function prepareReconTools(repo: string) {
  const out = {
    gitnexus: await prepareGitNexus(repo),
    semble: await prepareSemble(repo),
    codetree: await prepareCodeTree(repo)
  };
  await writeJson(agentPath(repo, "kb", "supporting-tools.json"), out);
  return out;
}

async function prepareCodeTree(repo: string) {
  const capability = await detectCodeTree();
  const artifact = agentPath(repo, "evidence", "graph", "codetree-structure.json");
  if (!capability.available) {
    const blocked = { available: false, prepared: false, status: "blocked", reason: capability.reason ?? "contained codeTree unavailable", artifact: "evidence/graph/codetree-structure.json" };
    await writeJson(artifact, blocked);
    return blocked;
  }
  const command = [binPath("shims", "codetree"), "--root", repo];
  const initialize = await probeMcpInitialize(command, repo, 8_000);
  if (!initialize.ok) {
    const blocked = { available: true, prepared: false, status: "blocked", reason: initialize.error ?? "codeTree MCP initialize failed", initialize, artifact: "evidence/graph/codetree-structure.json" };
    await writeJson(artifact, blocked);
    return blocked;
  }
  const repoMap = await callMcpTool(command, repo, "get_repository_map", { max_items: 20 }, 20_000);
  const search = await callMcpTool(command, repo, "search_graph", { limit: 50 }, 20_000);
  const structure = {
    available: true,
    prepared: repoMap.ok || search.ok,
    status: repoMap.ok || search.ok ? "success" : "blocked",
    command,
    initialize: {
      ok: initialize.ok,
      server_info: initialize.server_info,
      tools: initialize.tools
    },
    repository_map: extractMcpResult(repoMap),
    graph_search: extractMcpResult(search),
    limitations: repoMap.ok || search.ok ? [] : ["codeTree initialized but graph extraction tool calls failed"],
    artifact: "evidence/graph/codetree-structure.json"
  };
  await writeJson(artifact, structure);
  return structure;
}

async function prepareGitNexus(repo: string) {
  const capability = await detectCommand("gitnexus", ["knowledge-graph", "call-chain", "execution-flow", "reachability"]);
  if (!capability.available) return { available: false, prepared: false, reason: capability.reason };
  const alias = `security-agent-${stableHash(path.resolve(repo)).slice(0, 10)}`;
  const gitDirExists = await exists(path.join(repo, ".git"));
  const args = ["gitnexus", "analyze", "--skip-agents-md", "--name", alias, repo];
  if (!gitDirExists) args.splice(2, 0, "--skip-git");
  const analyze = await runTool(repo, "gitnexus-analyze", args, agentPath(repo, "evidence", "graph", "gitnexus-analyze.json"), 60_000);
  const query = analyze.record.exit_code === 0
    ? await runTool(repo, "gitnexus-query", ["gitnexus", "query", "-r", alias, "--limit", "8", "--goal", "Find externally reachable entrypoints and security-relevant execution flows", "routes handlers auth authorization database shell file crypto secrets"], agentPath(repo, "evidence", "graph", "gitnexus-query.json"), 20_000)
    : null;
  await writeJson(agentPath(repo, "evidence", "graph", "gitnexus-analyze.json"), analyze.record);
  if (query) await writeJson(agentPath(repo, "evidence", "graph", "gitnexus-query.json"), { tool_run: query.record, stdout_preview: query.stdout.slice(0, 8000) });
  return { available: true, prepared: analyze.record.exit_code === 0, alias, analyze_run: analyze.record, query_run: query?.record ?? null, query_preview_path: query ? "evidence/graph/gitnexus-query.json" : null };
}

async function prepareSemble(repo: string) {
  const semble = await detectCommand("semble", ["local-code-search", "retrieval"]);
  if (!semble.available) return { available: false, prepared: false, reason: `contained Semble CLI unavailable: ${semble.reason}` };
  const queries = [
    "security relevant entrypoints routes handlers controllers",
    "authentication authorization middleware guards policies ownership tenant",
    "database query shell command file read write crypto secret config"
  ];
  const results = [];
  for (const query of queries) {
    const run = await runTool(repo, "semble-search", ["semble", "search", query, repo, "--top-k", "8", "--include-text-files"], agentPath(repo, "evidence", "graph", `semble-${stableHash(query).slice(0, 8)}.json`), 20_000);
    results.push({ query, tool_run: run.record, stdout_preview: run.stdout.slice(0, 6000) });
  }
  await writeJson(agentPath(repo, "evidence", "graph", "semble-searches.json"), results);
  return { available: true, prepared: results.some((result) => result.tool_run.exit_code === 0), searches: results.map((result) => ({ query: result.query, run_id: result.tool_run.id })) };
}

async function prepareUnavailable(name: string, reason: string) {
  return { name, available: false, prepared: false, reason };
}

function extractMcpResult(result: Awaited<ReturnType<typeof callMcpTool>>): unknown {
  const response = result.responses.find((item: any) => item?.id === 2) as any;
  return {
    ok: result.ok && !response?.error,
    error: result.error ?? response?.error?.message,
    result: response?.result ?? null,
    stderr_preview: result.stderr.slice(0, 1000)
  };
}

export async function readSupportingToolNotes(repo: string): Promise<string> {
  const file = agentPath(repo, "kb", "supporting-tools.json");
  if (!(await exists(file))) return "Supporting tools were not prepared. Run recon with --prepare-tools.";
  return (await readFile(file, "utf8")).slice(0, 6000);
}
