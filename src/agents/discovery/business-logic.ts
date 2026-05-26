import { readJson } from "../../core/artifact-writer.ts";
import { agentPath } from "../../core/paths.ts";
import { nowIso, repoCommit, stableHash } from "../../core/provenance.ts";
import type { Finding } from "../../core/types.ts";

export async function runBusinessLogicAgent(repo: string): Promise<Finding[]> {
  const entrypoints = await readJson<any>(agentPath(repo, "kb", "entrypoints.json"), { entrypoints: [] });
  const commit = await repoCommit(repo);
  const suspicious = (entrypoints.entrypoints ?? []).filter((ep: any) => /admin|approve|payment|tenant|role|quota|billing|delete|refund/i.test(`${ep.name} ${ep.path}`));
  return suspicious.slice(0, 50).map((ep: any): Finding => {
    const key = stableHash(JSON.stringify(ep));
    return {
      id: `finding-${key.slice(0, 16)}`,
      title: "Business logic review candidate",
      bug_class: "business_logic",
      severity_claim: "medium",
      confidence: "low",
      stage: "discovery",
      source_agent: "business-logic-agent",
      tool: "manual-analysis",
      external_source: "none",
      external_status: "none",
      files: [{ path: ep.path, start_line: ep.line, end_line: ep.line }],
      entrypoint: { type: ep.type, name: ep.name, reachable: true, evidence: ep.evidence },
      dataflow: { source: "user/action request", sink: ep.name, sanitizers: [], missing_checks: ["workflow invariant", "authorization", "state transition validation"] },
      evidence: [{ kind: "reasoning", content: `Security-relevant entrypoint name/path: ${ep.name}`, path: ep.path, line: ep.line, provenance: "kb/entrypoints.json" }],
      reproduction_hint: "Human should verify intended workflow invariants. MVP marks this as hypothesis only.",
      dedup_key: stableHash(["business_logic", ep.path, ep.name].join("|")),
      limitations: ["hypothesis; not accepted without human workflow review"],
      created_at: nowIso(),
      repo_commit: commit
    };
  });
}
