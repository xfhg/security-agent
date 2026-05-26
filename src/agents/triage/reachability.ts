import type { Finding, TriagedFinding } from "../../core/types.ts";
import { readJson } from "../../core/artifact-writer.ts";
import { agentPath, exists } from "../../core/paths.ts";

export async function assessReachability(
  finding: Finding,
  entrypoints: any,
  repo: string
): Promise<{ reachability: TriagedFinding["triage"]["reachability"]; rationale: string }> {
  if (finding.entrypoint.reachable) {
    return { reachability: "likely", rationale: "Finding already references a candidate entrypoint" };
  }

  const eps = entrypoints.entrypoints ?? [];
  const findingFile = finding.files[0]?.path ?? "";
  const findingLine = finding.files[0]?.start_line ?? 1;

  const sameFile = eps.find((ep: any) => finding.files.some((file) => file.path === ep.path));
  if (sameFile) {
    return { reachability: "likely", rationale: `Same file as entrypoint ${sameFile.name}` };
  }

  const securitySymbols = await loadJson(agentPath(repo, "evidence", "graph", "codetree-security-symbols.json"));
  if (securitySymbols) {
    for (const [category, data] of Object.entries(securitySymbols)) {
      const result = (data as any)?.result?.content ?? (data as any)?.result;
      if (!result) continue;
      const text = JSON.stringify(result).toLowerCase();
      const fileMatch = findingFile && text.includes(findingFile.toLowerCase());
      const titleWords = finding.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      const keywordMatch = titleWords.length > 1 && titleWords.every((w: string) => text.includes(w));
      if ((fileMatch || keywordMatch) && category === finding.bug_class) {
        return { reachability: "likely", rationale: `Finding matches codetree security symbol category "${category}"` };
      }
      if (fileMatch) {
        return { reachability: "possible", rationale: `Finding file found in codetree security symbols category "${category}"` };
      }
    }
  }

  const hotPaths = await loadJson(agentPath(repo, "evidence", "graph", "codetree-hot-paths.json"));
  if (hotPaths) {
    const hot = (hotPaths as any)?.hot_paths?.result;
    if (hot) {
      const hotText = JSON.stringify(hot).toLowerCase();
      if (findingFile && hotText.includes(findingFile.toLowerCase())) {
        return { reachability: "likely", rationale: "Finding in a hot path (high complexity + high call frequency)" };
      }
    }
  }

  const skeletons = await loadJson(agentPath(repo, "evidence", "graph", "codetree-skeletons.json"));
  if (skeletons && findingFile) {
    const skelData = (skeletons as any)?.skeletons?.entrypoints?.result;
    if (skelData) {
      const skelText = typeof skelData === "string" ? skelData.toLowerCase() : JSON.stringify(skelData).toLowerCase();
      if (skelText.includes(findingFile.toLowerCase())) {
        return { reachability: "likely", rationale: "Finding file is an entrypoint skeleton (codetree-confirmed)" };
      }
    }
  }

  if (finding.bug_class === "secrets" || finding.bug_class === "dependency") {
    return { reachability: "possible", rationale: "Non-route issue; runtime relevance requires environment or usage confirmation" };
  }

  return { reachability: "unknown", rationale: "No entrypoint or graph path proved by MVP analysis" };
}

async function loadJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    if (!(await exists(path))) return null;
    return await readJson<Record<string, unknown>>(path, {});
  } catch {
    return null;
  }
}
