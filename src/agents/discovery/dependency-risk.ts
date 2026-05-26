import { readJson } from "../../core/artifact-writer.ts";
import { agentPath } from "../../core/paths.ts";
import { nowIso, repoCommit, stableHash } from "../../core/provenance.ts";
import type { Finding } from "../../core/types.ts";

export async function runDependencyRiskAgent(repo: string): Promise<Finding[]> {
  const deps = await readJson<any>(agentPath(repo, "kb", "dependencies.json"), { dependencies: [], risky_packages: [] });
  const commit = await repoCommit(repo);
  const findings: Finding[] = [];
  for (const item of deps.risky_packages ?? []) {
    const key = stableHash(JSON.stringify(item));
    findings.push({
      id: `finding-${key.slice(0, 16)}`,
      title: "Dependency source or install-script risk",
      bug_class: "dependency",
      severity_claim: "medium",
      confidence: "medium",
      stage: "discovery",
      source_agent: "dependency-risk-agent",
      tool: "local-dependency-analysis",
      external_source: "none",
      external_status: "none",
      files: [{ path: item.manifest, start_line: 1, end_line: 1 }],
      entrypoint: { type: "unknown", name: "dependency install/runtime", reachable: false, evidence: "Dependency risk requires usage/runtime confirmation in triage" },
      dataflow: { source: String(item.package), sink: "dependency installation/runtime", sanitizers: [], missing_checks: ["source verification", "usage reachability"] },
      evidence: [{ kind: "reasoning", content: item.reason, path: item.manifest, provenance: "kb/dependencies.json" }],
      reproduction_hint: "Review manifest and lockfile consistency; no live package execution by MVP.",
      dedup_key: stableHash(["dependency", item.package, item.manifest].join("|")),
      limitations: ["not a CVE assertion; requires human/package verification"],
      created_at: nowIso(),
      repo_commit: commit
    });
  }
  return findings;
}
