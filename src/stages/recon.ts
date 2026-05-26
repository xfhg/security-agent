import { writeFile } from "node:fs/promises";
import { writeJson } from "../core/artifact-writer.ts";
import { agentPath } from "../core/paths.ts";
import { buildRepoMap } from "../agents/recon/repo-cartographer.ts";
import { buildDependencies } from "../agents/recon/dependency.ts";
import { buildEntrypoints } from "../agents/recon/entrypoint.ts";
import { buildGraph } from "../agents/recon/graph.ts";
import { buildThreatModel } from "../agents/recon/threat-model.ts";
import { ghostPreflight, importGhostRepoContext } from "../adapters/ghost.ts";
import { detectCodeTree } from "../adapters/codetree.ts";
import { detectGitNexus } from "../adapters/gitnexus.ts";
import { detectSemble } from "../adapters/semble.ts";
import { prepareReconTools, prepareGraphContext } from "../adapters/recon-tools.ts";

export async function reconStage(repo: string, options: { importGhostContext?: boolean; prepareTools?: boolean } = {}): Promise<void> {
  const supportingTools = options.prepareTools !== false ? await prepareReconTools(repo) : null;
  const { repoMap, languages } = await buildRepoMap(repo);
  await writeJson(agentPath(repo, "kb", "repo-map.json"), repoMap);
  await writeJson(agentPath(repo, "kb", "languages.json"), languages);
  const dependencies = await buildDependencies(repo);
  await writeJson(agentPath(repo, "kb", "dependencies.json"), dependencies);
  const entrypoints = await buildEntrypoints(repo);
  await writeJson(agentPath(repo, "kb", "entrypoints.json"), entrypoints);
  const graph = await buildGraph(repo);
  await writeJson(agentPath(repo, "kb", "callgraph.json"), graph.callgraph);
  await writeJson(agentPath(repo, "kb", "dataflows.json"), graph.dataflows);
  if (options.importGhostContext) {
    await ghostPreflight(repo);
    await importGhostRepoContext(repo);
  }
  const threatModel = await buildThreatModel(repo, { ...repoMap, languages }, dependencies, entrypoints);
  await writeFile(agentPath(repo, "kb", "threat-model.md"), threatModel, "utf8");
  if (options.prepareTools !== false) {
    await prepareGraphContext(repo);
  }
  const tools = await Promise.all([detectSemble(), detectCodeTree(), detectGitNexus()]);
  await writeFile(agentPath(repo, "workflow", "recon-summary.md"), renderRecon(repoMap, languages, dependencies, entrypoints, graph, tools, options.importGhostContext, supportingTools), "utf8");
}

function renderRecon(repoMap: any, languages: any, dependencies: any, entrypoints: any, graph: any, tools: any[], ghost: boolean | undefined, supportingTools: any): string {
  return `# Recon Report

## Known
- Files mapped: ${repoMap.files_count}
- Languages: ${(languages.languages ?? []).map((l: any) => `${l.language} (${l.files_count})`).join(", ") || "unknown"}
- Dependency manifests: ${(dependencies.manifests ?? []).join(", ") || "none"}
- Entrypoints detected: ${(entrypoints.entrypoints ?? []).length}
- Fallback call edges: ${(graph.callgraph.calls ?? []).length}

## Unknown Or Unreliable
- Runtime deployment and active environment are not proven.
- Callgraph/dataflow quality is fallback-level unless graph tools are available.
- Ghost context imported: ${Boolean(ghost)}
- Supporting tools prepared: ${Boolean(supportingTools)}

## Tool Availability
${tools.map((tool) => `- ${tool.name}: ${tool.available ? "available" : `unavailable (${tool.reason})`}`).join("\n")}

## Supporting Tool Artifacts
${supportingTools ? `- GitNexus prepared: ${Boolean(supportingTools.gitnexus?.prepared)}
- Semble prepared: ${Boolean(supportingTools.semble?.prepared)}
- Details: kb/supporting-tools.json, evidence/graph/` : "- Not prepared. Run recon with --prepare-tools."}
`;
}
