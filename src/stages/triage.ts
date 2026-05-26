import { writeFile } from "node:fs/promises";
import { readJson, writeJson } from "../core/artifact-writer.ts";
import { agentPath, exists, repoRelativePath } from "../core/paths.ts";
import { finalSeverity, priorityFor, statusFromVotes } from "../core/policy.ts";
import type { Finding, TriagedFinding } from "../core/types.ts";
import { deduplicateFindings } from "../agents/triage/dedup.ts";
import { assessReachability } from "../agents/triage/reachability.ts";
import { assessExploitability } from "../agents/triage/exploitability.ts";
import { assessImpact } from "../agents/triage/impact.ts";
import { challengeFinding } from "../agents/triage/false-positive.ts";
import { runSeverityPanel } from "../agents/triage/severity-panel.ts";
import { reconcileGhost } from "../agents/triage/ghost-status-reconciliation.ts";
import { importGhostFindings } from "../adapters/ghost.ts";
import { readCoverageGates, readCoverageStatus } from "../core/coverage-gates.ts";

export async function triageStage(repo: string, options: { importGhostFindings?: boolean } = {}): Promise<void> {
  const normalizedPath = agentPath(repo, "findings", "normalized", "findings.json");
  if (!(await exists(normalizedPath))) throw new Error("triage requires normalized discovery findings");
  let findings = await readJson<Finding[]>(normalizedPath, []);
  if (options.importGhostFindings) {
    findings = [...findings, ...await importGhostFindings(repo, "code"), ...await importGhostFindings(repo, "deps"), ...await importGhostFindings(repo, "secrets")];
  }
  const entrypoints = await readJson<any>(agentPath(repo, "kb", "entrypoints.json"), { entrypoints: [] });
  const triaged = deduplicateFindings(findings).map((finding): TriagedFinding => {
    const reach = assessReachability(finding, entrypoints);
    const exploit = assessExploitability(finding);
    const impact = assessImpact(finding);
    const fp = challengeFinding(finding);
    const votes = runSeverityPanel(finding, reach.reachability, fp.risk);
    let status = statusFromVotes(votes);
    if (finding.external_source === "ghost" && finding.external_status === "verified" && reach.reachability === "unknown") status = "needs-human-review";
    const priority = status === "accepted" ? priorityFor(finding, reach.reachability, exploit.exploitability, impact.impact) : status === "needs-human-review" ? "P3" : "P4";
    return {
      ...finding,
      triage: {
        status,
        final_severity: finalSeverity(priority),
        priority,
        reachability: reach.reachability,
        exploitability: exploit.exploitability,
        impact: impact.impact,
        false_positive_risk: fp.risk,
        votes,
        ghost_reconciliation: reconcileGhost(finding, status, reach.reachability),
        rationale: [reach.rationale, exploit.rationale, impact.rationale, ...fp.notes].filter(Boolean).join("\n"),
        required_human_checks: humanChecks(finding, reach.reachability, fp.notes),
        next_stage_recommendation: status === "accepted" ? "prove" : status === "rejected" ? "ignore" : "manual-review"
      }
    };
  });
  await writeJson(agentPath(repo, "findings", "triaged", "findings.json"), triaged);
  await writeFile(agentPath(repo, "security", "triage-report.md"), renderTriage(triaged, await readCoverageStatus(repo), await readCoverageGates(repo), repo), "utf8");
}

function humanChecks(finding: Finding, reachability: TriagedFinding["triage"]["reachability"], fpNotes: string[]): string[] {
  const checks = [];
  if (reachability === "unknown" || reachability === "possible") checks.push("Confirm route/runtime reachability");
  if (finding.bug_class === "secrets") checks.push("Confirm whether secret is active, production-like, and privileged");
  if (finding.bug_class === "dependency") checks.push("Confirm vulnerable package is used at runtime and lockfile matches");
  if (fpNotes.length) checks.push("Review false-positive downgrade notes");
  return checks.length ? checks : ["Review source context before next stage"];
}

function renderTriage(findings: TriagedFinding[], coverage: Awaited<ReturnType<typeof readCoverageStatus>>, gates: Awaited<ReturnType<typeof readCoverageGates>>, repo: string): string {
  const accepted = findings.filter((f) => f.triage.status === "accepted");
  const rejected = findings.filter((f) => f.triage.status === "rejected");
  const review = findings.filter((f) => f.triage.status === "needs-human-review");
  const disputants = findings.filter((f) => f.triage.ghost_reconciliation.agreement === "disagrees" || f.triage.ghost_reconciliation.agreement === "unclear");

  const grouped = (list: TriagedFinding[]) => {
    const map = new Map<string, TriagedFinding[]>();
    for (const f of list) {
      const key = f.triage.priority;
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  const findingDetail = (f: TriagedFinding): string => {
    const locs = f.files.map((file) => `\`${repoRelativePath(repo, file.path)}:${file.start_line}-${file.end_line}\``).join(", ") || "unknown";
    const evidenceBlock = f.evidence.map((e) => `  - [${e.kind}] ${e.path ? repoRelativePath(repo, e.path) : ""}${e.line ? `:${e.line}` : ""}: ${e.content.slice(0, 200)}`).join("\n") || "  - none";
    const checks = f.triage.required_human_checks.map((c) => `  - [ ] ${c}`).join("\n");
    const rationale = f.triage.rationale.split("\n").map((r) => `  - ${r}`).join("\n");
    return `### ${f.title.slice(0, 100)}

| Field | Value |
|-------|-------|
| **ID** | \`${f.id}\` |
| **Priority** | ${f.triage.priority} |
| **Final Severity** | ${f.triage.final_severity} |
| **Status** | ${f.triage.status} |
| **Bug Class** | ${f.bug_class} |
| **Claimed Severity** | ${f.severity_claim} |
| **Confidence** | ${f.confidence} |
| **Tool** | ${f.tool} |
| **Source Agent** | ${f.source_agent} |
| **External Source** | ${f.external_source} / ${f.external_status} |

**Location**: ${locs}

**Triage Rationale**:
${rationale}

**Evidence**:
${evidenceBlock}

${checks ? `**Required Human Checks**:\n${checks}\n` : ""}---
`;
  };

  const section = (title: string, list: TriagedFinding[]) => {
    if (!list.length) return "";
    const byPrio = grouped(list);
    return `## ${title} (${list.length} findings)\n\n${byPrio.map(([prio, items]) => `### Priority ${prio} (${items.length})\n\n${items.map(findingDetail).join("\n\n")}`).join("\n\n")}\n\n`;
  };

  return `# Triage Report

## Coverage
- Scan status: ${coverage.scan_status}
- Blocked gates: ${coverage.blocked_gates.length ? coverage.blocked_gates.join(", ") : "none"}
- Skipped gates: ${coverage.skipped_gates.length ? coverage.skipped_gates.join(", ") : "none"}

## Executive Summary
- Triaged: ${findings.length} | Accepted: ${accepted.length} | Needs Review: ${review.length} | Rejected: ${rejected.length}
${grouped(findings).map(([prio, items]) => `- ${prio}: ${items.length} findings`).join("\n") || "- none"}

## Evidence Coverage
${(() => {
    const sources = new Map<string, number>();
    for (const f of findings) {
      const key = f.external_source === "ghost" ? `Ghost (${f.bug_class})` : f.tool;
      sources.set(key, (sources.get(key) ?? 0) + 1);
    }
    return [...sources.entries()].sort(([,a], [,b]) => b - a).map(([k, v]) => `- ${k}: ${v} findings`).join("\n") || "- none";
  })()}

---

${section("Accepted Findings", accepted)}
${section("Needs Human Review", review)}
${section("Rejected Findings", rejected)}

## False-Positive Patterns
- Test/docs/example paths are downgraded.
- Unknown reachability prevents high-confidence acceptance.
- Scanner-only claims are not accepted without source, sink, and trust-boundary evidence.

## Ghost/Native Disagreements
${disputants.length ? disputants.map((f) => `- **${f.title.slice(0, 80)}**\n  - ID: \`${f.id}\`\n  - Notes: ${f.triage.ghost_reconciliation.notes}`).join("\n\n") : "- none"}
`;
}
