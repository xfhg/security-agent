import path from "node:path";
import { readFile } from "node:fs/promises";
import { agentPath, binPath, exists } from "../core/paths.ts";
import { stableHash } from "../core/provenance.ts";
import { writeJson, readJson } from "../core/artifact-writer.ts";
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

  const securitySymbolsPatterns = [
    { label: "crypto", query: "encrypt decrypt hash sign signkey privatekey cipher md5 sha1 des rc4 3des", min_complexity: 1 },
    { label: "injection", query: "exec command shell system spawn runCommand eval", min_complexity: 1 },
    { label: "authz_authn", query: "auth authenticate authorize permission role policy guard middleware", min_complexity: 1 },
    { label: "deserialization", query: "deserialize unmarshal parse decode yaml xml json marshal", min_complexity: 1 }
  ];
  const securitySymbols: Record<string, unknown> = {};
  for (const p of securitySymbolsPatterns) {
    const result = await callMcpTool(command, repo, "search_symbols", { query: p.query, min_complexity: p.min_complexity, limit: 60 }, 15_000);
    securitySymbols[p.label] = extractMcpResult(result);
  }
  await writeJson(agentPath(repo, "evidence", "graph", "codetree-security-symbols.json"), securitySymbols);

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
    security_symbols: Object.keys(securitySymbols).some((k) => {
      const r = securitySymbols[k] as any;
      return r?.ok;
    }) ? "evidence/graph/codetree-security-symbols.json" : null,
    limitations: repoMap.ok || search.ok ? [] : ["codeTree initialized but graph extraction tool calls failed"],
    artifact: "evidence/graph/codetree-structure.json"
  };
  await writeJson(artifact, structure);
  return structure;
}

export async function prepareGraphContext(repo: string): Promise<void> {
  const capability = await detectCodeTree();
  if (!capability.available) {
    await writeJson(agentPath(repo, "evidence", "graph", "codetree-graph-context.json"), { available: false, reason: capability.reason ?? "codeTree unavailable" });
    return;
  }
  const entrypoints = await (async () => {
    try { return await readJson<any>(agentPath(repo, "kb", "entrypoints.json"), { entrypoints: [] }); }
    catch { return { entrypoints: [] }; }
  })();
  const entrypointFiles = [...new Set<string>((entrypoints.entrypoints ?? []).map((ep: any) => ep.path ?? ep.file).filter(Boolean))];
  const command = [binPath("shims", "codetree"), "--root", repo];

  const skeletons: Record<string, unknown> = {};
  let skeletonsOk = false;
  if (entrypointFiles.length > 0) {
    const result = await callMcpTool(command, repo, "get_skeletons", { file_paths: entrypointFiles.slice(0, 10), format: "compact" }, 20_000);
    skeletonsOk = result.ok;
    if (result.ok) skeletons["entrypoints"] = extractMcpResult(result);
  }
  await writeJson(agentPath(repo, "evidence", "graph", "codetree-skeletons.json"), { available: true, skeletons_ok: skeletonsOk, entrypoint_files: entrypointFiles, skeletons });

  let hotPathsOk = false;
  const hotPaths = await callMcpTool(command, repo, "find_hot_paths", { top_n: 20 }, 15_000);
  hotPathsOk = hotPaths.ok;
  await writeJson(agentPath(repo, "evidence", "graph", "codetree-hot-paths.json"), { available: true, hot_paths_ok: hotPathsOk, hot_paths: extractMcpResult(hotPaths) });

  let deadCodeOk = false;
  const deadCode = await callMcpTool(command, repo, "find_dead_code", {}, 15_000);
  deadCodeOk = deadCode.ok;
  let cloneOk = false;
  const clones = await callMcpTool(command, repo, "detect_clones", { min_lines: 5 }, 15_000);
  cloneOk = clones.ok;
  await writeJson(agentPath(repo, "evidence", "graph", "codetree-dead-clones.json"), { available: true, dead_code_ok: deadCodeOk, dead_code: extractMcpResult(deadCode), clones_ok: cloneOk, clones: extractMcpResult(clones) });

  await writeJson(agentPath(repo, "evidence", "graph", "codetree-graph-context.json"), {
    available: true,
    prepared_at: new Date().toISOString(),
    entrypoint_files: entrypointFiles,
    skeletons_written: skeletonsOk,
    hot_paths_written: hotPathsOk,
    dead_code_written: deadCodeOk,
    clones_written: cloneOk,
    artifacts: [
      "evidence/graph/codetree-skeletons.json",
      "evidence/graph/codetree-hot-paths.json",
      "evidence/graph/codetree-dead-clones.json"
    ]
  });
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
