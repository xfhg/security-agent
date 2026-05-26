import { writeFile } from "node:fs/promises";
import { readJson } from "../core/artifact-writer.ts";
import { agentPath, exists, repoRelativePath } from "../core/paths.ts";
import type { TriagedFinding } from "../core/types.ts";
import { readCoverageGates, readCoverageStatus } from "../core/coverage-gates.ts";

export async function reportStage(repo: string, options: { includeGhostEvidence?: boolean; partial?: boolean } = {}): Promise<void> {
  const triagedPath = agentPath(repo, "findings", "triaged", "findings.json");
  if (!(await exists(triagedPath)) && !options.partial) throw new Error("report requires triage output unless --partial is set");
  const triaged = await readJson<TriagedFinding[]>(triagedPath, []);
  const coverage = await readCoverageStatus(repo);
  const gates = await readCoverageGates(repo);
  const accepted = triaged.filter((f) => f.triage.status === "accepted");
  const rejected = triaged.filter((f) => f.triage.status === "rejected");
  const review = triaged.filter((f) => f.triage.status === "needs-human-review");
  const completeness = await buildDataCompleteness(repo, triaged);

  await writeFile(agentPath(repo, "security", "executive-summary.md"), renderMvpSummary(triaged, accepted, rejected, review, completeness, repo), "utf8");

  if (options.includeGhostEvidence) {
    await writeFile(agentPath(repo, "security", "ghost-findings.md"), renderGhostSummary(triaged, completeness, gates, repo), "utf8");
  }

  await writeFile(agentPath(repo, "security", "detailed-report.md"), renderDetailedReport(triaged, accepted, rejected, review, completeness, coverage, repo), "utf8");

  await writeFile(agentPath(repo, "review", "checklist.md"), renderReviewChecklist(review, repo), "utf8");
}

async function buildDataCompleteness(repo: string, triaged: TriagedFinding[]): Promise<string> {
  const lines: string[] = [];

  const ghostDepsNorm = await readJson<any[]>(agentPath(repo, "findings", "normalized", "ghost-deps-findings.json"), []);
  const ghostSecretsNorm = await readJson<any[]>(agentPath(repo, "findings", "normalized", "ghost-secrets-findings.json"), []);
  const ghostCodeNorm = await readJson<any[]>(agentPath(repo, "findings", "normalized", "ghost-code-findings.json"), []);

  const depsInTriage = triaged.filter((f) => f.external_source === "ghost" && f.bug_class === "dependency").length;
  const secretsInTriage = triaged.filter((f) => f.external_source === "ghost" && f.bug_class === "secrets").length;
  const codeInTriage = triaged.filter((f) => f.external_source === "ghost" && f.bug_class !== "dependency" && f.bug_class !== "secrets").length;

  const normCount = (arr: any[]) => Array.isArray(arr) ? arr.length : 0;

  lines.push("| Evidence Source | Normalized | Triaged | Status |");
  lines.push("|-----------------|-----------|---------|--------|");

  if (await exists(agentPath(repo, "evidence", "ghost", "scan-deps-findings.json")) || ghostDepsNorm.length > 0) {
    const ok = normCount(ghostDepsNorm) > 0 && depsInTriage > 0;
    lines.push(`| Ghost scan-deps (SCA) | ${normCount(ghostDepsNorm)} | ${depsInTriage} | ${ok ? "Included" : "MISSING — not imported into triage"} |`);
  }

  if (await exists(agentPath(repo, "evidence", "ghost", "scan-secrets-findings.json")) || ghostSecretsNorm.length > 0) {
    const ok = normCount(ghostSecretsNorm) > 0 && secretsInTriage > 0;
    lines.push(`| Ghost scan-secrets | ${normCount(ghostSecretsNorm)} | ${secretsInTriage} | ${ok ? "Included" : "MISSING"} |`);
  }

  if (ghostCodeNorm.length > 0) {
    lines.push(`| Ghost scan-code (SAST) | ${normCount(ghostCodeNorm)} | ${codeInTriage} | ${codeInTriage > 0 ? "Included" : "Skipped — native SAST covers code"} |`);
  } else {
    lines.push("| Ghost scan-code (SAST) | skipped | 0 | Native OpenGrep + Cognium provide SAST coverage |");
  }

  if (await exists(agentPath(repo, "findings", "raw", "opengrep.json"))) {
    const ogInTriage = triaged.filter((f) => f.tool === "opengrep").length;
    lines.push(`| OpenGrep (SAST) | native | ${ogInTriage} | ${ogInTriage > 0 ? "Included" : "No findings"} |`);
  }

  if (await exists(agentPath(repo, "findings", "raw", "semantic-sast.json"))) {
    const ciInTriage = triaged.filter((f) => f.tool === "cognium").length;
    lines.push(`| Cognium (SAST) | native | ${ciInTriage} | ${ciInTriage > 0 ? "Included" : "No findings"} |`);
  }

  const heuristicInTriage = triaged.filter((f) => f.tool === "local-heuristic").length;
  if (heuristicInTriage > 0) {
    lines.push(`| Local Heuristics | native | ${heuristicInTriage} | Included |`);
  }

  if (triaged.some((f) => f.triage.status === "rejected")) {
    const rejected = triaged.filter((f) => f.triage.status === "rejected").length;
    lines.push(`| Rejected (noise/FP) | — | ${rejected} | Excluded from risk profile |`);
  }

  return lines.join("\n");
}

function renderGhostSummary(findings: TriagedFinding[], completeness: string, gates: Awaited<ReturnType<typeof readCoverageGates>>, repo: string): string {
  const ghost = findings.filter((f) => f.external_source === "ghost");
  const ghostGates = gates.filter((gate) => gate.gate.startsWith("ghost-"));
  const ghostDetail = (f: TriagedFinding): string => {
    const locs = f.files.map((file) => `\`${repoRelativePath(repo, file.path)}:${file.start_line}\``).join(", ") || "unknown";
    return `### ${f.title.slice(0, 100)}

| Field | Value |
|-------|-------|
| **ID** | \`${f.id}\` |
| **Severity** | ${f.triage.final_severity} (claimed: ${f.severity_claim}) |
| **Status** | ${f.external_status} / Triage: ${f.triage.status} |
| **Bug Class** | ${f.bug_class} |
| **Agreement** | ${f.triage.ghost_reconciliation.agreement} |
| **Location** | ${locs} |

**Notes**: ${f.triage.ghost_reconciliation.notes}

---
`;
  };

  return `# Ghost Summary

- Imported Ghost findings: ${ghost.length}
- Ghost evidence is treated as external evidence, not source of truth.

## Data Completeness

${completeness}

## Imported Ghost Findings
${ghost.length ? ghost.map(ghostDetail).join("\n\n") : "- No Ghost findings imported\n"}
`;
}

function renderMvpSummary(
  triaged: TriagedFinding[],
  accepted: TriagedFinding[],
  rejected: TriagedFinding[],
  review: TriagedFinding[],
  completeness: string,
  repo: string
): string {
  const grouped = (list: TriagedFinding[]) => {
    const map = new Map<string, TriagedFinding[]>();
    for (const f of list) {
      const key = f.triage.priority;
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  const findingRow = (f: TriagedFinding): string => {
    const locs = f.files.map((file) => `\`${repoRelativePath(repo, file.path)}:${file.start_line}\``).join(", ") || "unknown";
    return `| \`${f.id.slice(-12)}\` | ${f.triage.priority} | ${f.triage.final_severity} | ${f.triage.status} | ${f.bug_class} | ${locs} | ${f.title.slice(0, 60)} |`;
  };

  const table = (heading: string, list: TriagedFinding[]): string => {
    if (!list.length) return "";
    const byPrio = grouped(list);
    let out = `### ${heading} (${list.length})\n\n`;
    out += `| ID | Priority | Severity | Status | Bug Class | Files | Title |\n`;
    out += `|----|----------|----------|--------|-----------|-------|-------|\n`;
    for (const [, items] of byPrio) {
      out += items.map(findingRow).join("\n") + "\n";
    }
    return out + "\n";
  };

  const sourceBreakdown = () => {
    const sources = new Map<string, number>();
    for (const f of triaged) {
      const key = f.external_source === "ghost" ? `Ghost ${f.bug_class}` : f.tool;
      sources.set(key, (sources.get(key) ?? 0) + 1);
    }
    return [...sources.entries()].sort(([,a], [,b]) => b - a).map(([k, v]) => `| ${k} | ${v} |`).join("\n");
  };

  return `# Security Scan Summary

## Results
- Triaged findings: **${triaged.length}** (${accepted.length} accepted, ${review.length} need review, ${rejected.length} rejected)

## Data Completeness

${completeness}

## Findings by Source

| Source | Findings |
|--------|----------|
${sourceBreakdown()}

## Detailed Findings

${table("Accepted", accepted)}
${table("Needs Human Review", review)}
${table("Rejected", rejected)}

## Recommended Next Actions
- Prove P1 findings in a future explicit prove stage.
- Manually review P3 queue before engineering escalation.
- Improve rules for repeated false-positive patterns.
- Do not generate PoCs, patches, proxy captures, or live validations in this MVP.
`;
}

function renderDetailedReport(
  triaged: TriagedFinding[],
  accepted: TriagedFinding[],
  rejected: TriagedFinding[],
  review: TriagedFinding[],
  completeness: string,
  coverage: Awaited<ReturnType<typeof readCoverageStatus>>,
  repo: string
): string {
  const grouped = (list: TriagedFinding[]) => {
    const map = new Map<string, TriagedFinding[]>();
    for (const f of list) {
      const key = f.triage.priority;
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  const findingFull = (f: TriagedFinding): string => {
    const files = f.files.map((file) => `\`${repoRelativePath(repo, file.path)}:${file.start_line}-${file.end_line}\``).join("\n") || "unknown";
    const evidenceBlock = f.evidence.map((e) =>
      `  - **[${e.kind}]** ${e.path ? repoRelativePath(repo, e.path) : ""}${e.line ? `:${e.line}` : ""}: ${e.content.slice(0, 300)}`
    ).join("\n") || "  - none";
    const rationale = f.triage.rationale.split("\n").filter(Boolean).map((r) => `  - ${r}`).join("\n");
    const checks = f.triage.required_human_checks.map((c) => `  - [ ] ${c}`).join("\n");
    const votes = `attacker=${f.triage.votes.attacker}, defender=${f.triage.votes.defender}, maintainer=${f.triage.votes.maintainer}`;
    return `### ${f.id}

| Field | Value |
|-------|-------|
| **Title** | ${f.title} |
| **Priority** | ${f.triage.priority} |
| **Final Severity** | ${f.triage.final_severity} |
| **Claimed Severity** | ${f.severity_claim} |
| **Status** | ${f.triage.status} |
| **Bug Class** | ${f.bug_class} |
| **Confidence** | ${f.confidence} |
| **Tool** | ${f.tool} |
| **Source Agent** | ${f.source_agent} |
| **External Source** | ${f.external_source} / ${f.external_status} |
| **Reachability** | ${f.triage.reachability} |
| **Exploitability** | ${f.triage.exploitability} |
| **Impact** | ${f.triage.impact} |
| **FP Risk** | ${f.triage.false_positive_risk} |
| **Votes** | ${votes} |
| **Next Stage** | ${f.triage.next_stage_recommendation} |

**Files**:
${files}

**Triage Rationale**:
${rationale || "  - none"}

**Evidence**:
${evidenceBlock}

${checks ? `**Required Human Checks**:\n${checks}\n` : ""}**Ghost Reconciliation**: ${f.triage.ghost_reconciliation.agreement} — ${f.triage.ghost_reconciliation.notes}

---
`;
  };

  const section = (title: string, list: TriagedFinding[]) => {
    if (!list.length) return "";
    const byPrio = grouped(list);
    return `## ${title} (${list.length})\n\n${byPrio.map(([prio, items]) => `### Priority ${prio} (${items.length})\n\n${items.map(findingFull).join("\n")}`).join("\n\n")}\n\n`;
  };

  const evidencePaths = [
    ["Ghost Combined Report", `evidence/ghost/combined-report.md`],
    ["Ghost Deps Report", `evidence/ghost/deps-report.md`],
    ["Ghost Secrets Report", `evidence/ghost/secrets-report.md`],
    ["Ghost Code Findings", `evidence/ghost/code-findings.md`],
    ["Ghost Repo Context", `evidence/ghost/repo-context.md`],
    ["codeTree Structure", `evidence/graph/codetree-structure.json`],
    ["GitNexus Queries", `evidence/graph/gitnexus-query.json`],
    ["OpenGrep Raw", `findings/raw/opengrep.json`],
    ["Cognium Raw", `findings/raw/semantic-sast.json`],
    ["Normalized Findings", `findings/normalized/findings.json`],
    ["Triaged Findings", `findings/triaged/findings.json`],
  ];

  const cogniumSource = triaged.filter((f) => f.source_agent === "semantic-sast-agent" || f.tool === "cognium");
  const ghostSource = triaged.filter((f) => f.external_source === "ghost");
  const opengrepSource = triaged.filter((f) => f.tool === "opengrep");
  const heuristicSource = triaged.filter((f) => f.tool === "local-heuristic");

  return `# Detailed Security Report

## Coverage
- Scan status: ${coverage.scan_status}
- Repo: \`${repo}\`
- Blocked gates: ${coverage.blocked_gates.length ? coverage.blocked_gates.join(", ") : "none"}

## Findings By Source

| Source | Count |
|--------|-------|
| Ghost | ${ghostSource.length} |
| OpenGrep | ${opengrepSource.length} |
| Cognium | ${cogniumSource.length} |
| Local Heuristics | ${heuristicSource.length} |
| **Total** | **${triaged.length}** |

## Evidence Sources

${(() => {
    const sources = new Map<string, { count: number; ghost: boolean }>();
    for (const f of triaged) {
      const key = f.external_source === "ghost" ? `Ghost (${f.bug_class})` : f.tool;
      const prev = sources.get(key) ?? { count: 0, ghost: f.external_source === "ghost" };
      sources.set(key, { count: prev.count + 1, ghost: prev.ghost });
    }
    return [...sources.entries()].sort(([,a], [,b]) => b.count - a.count).map(([k, v]) => `| ${k} | ${v.count} | ${v.ghost ? "Ghost evidence" : "Native scanner"} |`).join("\n");
  })()}

## Data Completeness

${completeness}

## Findings By Priority

| Priority | Severity | Count |
|----------|----------|-------|
${grouped(triaged).map(([prio, items]) => `| ${prio} | ${items[0]?.triage.final_severity ?? "unknown"} | ${items.length} |`).join("\n")}

---

${section("Accepted Findings", accepted)}
${section("Needs Human Review", review)}
${section("Rejected Findings", rejected)}

## Evidence Artifact Index

${evidencePaths.map(([name, artifact]) => `- **${name}**: \`${artifact}\``).join("\n")}

## Recommended Next Actions
- Prove accepted findings in a future explicit prove stage.
- Manually review P3 queue before engineering escalation.
- Improve rules for repeated false-positive patterns.
- Do not generate PoCs, patches, proxy captures, or live validations in this MVP.
`;
}

function renderReviewChecklist(review: TriagedFinding[], repo: string): string {
  if (!review.length) return "# Review Checklist\n\nAll findings resolved. No manual review needed.\n";

  const grouped = (list: TriagedFinding[]) => {
    const map = new Map<string, TriagedFinding[]>();
    for (const f of list) {
      const key = f.triage.priority;
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  const checkItem = (f: TriagedFinding): string => {
    const locs = f.files.map((file) => `\`${repoRelativePath(repo, file.path)}:${file.start_line}\``).join(", ") || "unknown";
    const checks = f.triage.required_human_checks.map((c) => `    - [ ] ${c}`).join("\n");
    return `## ${f.id.slice(-12)} — ${f.title.slice(0, 60)}

| Field | Value |
|-------|-------|
| **Priority** | ${f.triage.priority} |
| **Severity** | ${f.triage.final_severity} |
| **Bug Class** | ${f.bug_class} |
| **Files** | ${locs} |

${checks ?? "    - [ ] Review source context"}

---
`;
  };

  return `# Review Checklist

${review.length} findings require manual review.

${grouped(review).map(([prio, items]) => `## Priority ${prio} (${items.length})\n\n${items.map(checkItem).join("\n")}`).join("\n\n")}
`;
}
