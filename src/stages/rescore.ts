import { writeFile } from "node:fs/promises";
import { readJson, writeJson } from "../core/artifact-writer.ts";
import { agentPath, exists } from "../core/paths.ts";
import { priorityFor, finalSeverity, statusFromVotes } from "../core/policy.ts";
import type { TriagedFinding } from "../core/types.ts";
import { readCoverageGates, readCoverageStatus } from "../core/coverage-gates.ts";

export async function rescoreStage(repo: string): Promise<void> {
  const triagedPath = agentPath(repo, "findings", "triaged", "findings.json");
  if (!(await exists(triagedPath))) throw new Error("rescore requires triaged findings");

  const triaged = await readJson<TriagedFinding[]>(triagedPath, []);
  const entrypoints = await readJson<any>(agentPath(repo, "kb", "entrypoints.json"), { entrypoints: [] });
  const repoMap = await readJson<any>(agentPath(repo, "kb", "repo-map.json"), { files_count: 0 });
  const ghostContext = await readJson<any>(agentPath(repo, "kb", "ghost-context.json"), { imported: false });

  const review = triaged.filter((f) => f.triage.status === "needs-human-review");
  if (!review.length) {
    await writeFile(agentPath(repo, "review", "rescore-report.md"), renderEmptyRescore(review, triaged), "utf8");
    return;
  }

  const changes: Array<{
    id: string;
    title: string;
    before: { status: string; priority: string };
    after: { status: string; priority: string };
    rule: string;
  }> = [];

  for (const finding of review) {
    const entry = rescoreFinding(finding, entrypoints, repoMap, ghostContext);
    if (entry) changes.push(entry);
  }

  const rescored = triaged.map((finding) => {
    const entry = changes.find((c) => c.id === finding.id);
    if (!entry) return finding;
    return {
      ...finding,
      triage: {
        ...finding.triage,
        status: entry.after.status as TriagedFinding["triage"]["status"],
        priority: entry.after.priority as TriagedFinding["triage"]["priority"],
        final_severity: finalSeverity(entry.after.priority as TriagedFinding["triage"]["priority"]),
        rationale: finding.triage.rationale + "\n[RESCORE] " + entry.rule,
        next_stage_recommendation: entry.after.status === "accepted" ? "prove" : entry.after.status === "rejected" ? "ignore" : "manual-review"
      }
    };
  });

  await writeJson(agentPath(repo, "findings", "triaged", "findings.json"), rescored);
  await writeFile(agentPath(repo, "review", "rescore-report.md"), renderRescoreReport(rescored, changes, triaged, await readCoverageStatus(repo), await readCoverageGates(repo)), "utf8");
}

function rescoreFinding(
  finding: TriagedFinding,
  entrypoints: any,
  repoMap: any,
  ghostContext: any
): { id: string; title: string; before: { status: string; priority: string }; after: { status: string; priority: string }; rule: string } | null {
  const id = finding.id;
  const title = finding.title.slice(0, 80);
  const before = { status: finding.triage.status, priority: finding.triage.priority };
  const pathText = finding.files.map((f) => f.path).join(" ");
  const titleText = finding.title.toLowerCase();
  const evidenceText = finding.evidence.map((e) => e.content).join(" ").toLowerCase();

  // Rule 1: Ghost-verified findings with specific file evidence → accept at Ghost-claimed severity
  if (finding.external_source === "ghost" && finding.external_status === "verified") {
    const priority = finding.severity_claim === "critical" || finding.severity_claim === "high" ? "P1" : "P2";
    return { id, title, before, after: { status: "accepted", priority }, rule: "Ghost-verified with external evidence; native reachability inferred from external scan" };
  }

  // Rule 2: Cognium/noise findings with no substantive evidence → reject
  if ((finding.tool === "cognium" || finding.source_agent === "semantic-sast-agent") && finding.triage.false_positive_risk === "high") {
    return { id, title, before, after: { status: "rejected", priority: "P4" }, rule: "Scanner noise or insufficient evidence; rejected in rescore pass" };
  }

  // Rule 3: Test/example/documentation path AND no runtime evidence → reject
  if (/test|spec|fixture|example|docs?\//i.test(pathText) && !/verified|confirmed|production/i.test(evidenceText)) {
    const hasEvidence = finding.evidence.some((e) => e.kind === "ghost-import" && e.content.length > 100);
    if (!hasEvidence) return { id, title, before, after: { status: "rejected", priority: "P4" }, rule: "Test/example/documentation path without runtime or production usage evidence" };
  }

  // Rule 4: Same-directory entrypoint proximity → upgrade reachability, accept at P2
  const eps = entrypoints.entrypoints ?? [];
  for (const ep of eps) {
    for (const file of finding.files) {
      if (ep.file && file.path && ep.file.includes(file.path.split("/").pop() ?? "")) {
        return { id, title, before, after: { status: "accepted", priority: "P2" }, rule: `Finding in same file as entrypoint ${ep.name ?? ep.type}` };
      }
    }
  }

  // Rule 5: Dependency finding with Ghost/external evidence → accept at claimed severity
  if (finding.bug_class === "dependency" && (finding.external_source !== "none" || evidenceText.includes("cve-") || evidenceText.includes("ghsa-"))) {
    const priority = finding.severity_claim === "critical" ? "P1" : finding.severity_claim === "high" ? "P2" : "P3";
    return { id, title, before, after: { status: "accepted", priority }, rule: "Dependency finding with external CVE/GHSA evidence" };
  }

  // Rule 6: Secrets in production code paths → accept at P2
  if (finding.bug_class === "secrets" && !/test|spec|example|docs?\//i.test(pathText) && finding.files.some((f) => f.path.includes("cmd/") || f.path.includes("src/") || f.path.includes("lib/"))) {
    return { id, title, before, after: { status: "accepted", priority: "P2" }, rule: "Secret found in production code paths; runtime confirmation pending" };
  }

  return null;
}

function renderRescoreReport(
  rescored: TriagedFinding[],
  changes: Array<{ id: string; title: string; before: { status: string; priority: string }; after: { status: string; priority: string }; rule: string }>,
  original: TriagedFinding[],
  coverage: Awaited<ReturnType<typeof readCoverageStatus>>,
  gates: Awaited<ReturnType<typeof readCoverageGates>>
): string {
  const accepted = rescored.filter((f) => f.triage.status === "accepted");
  const rejected = rescored.filter((f) => f.triage.status === "rejected");
  const stillReview = rescored.filter((f) => f.triage.status === "needs-human-review");
  const beforeReview = original.filter((f) => f.triage.status === "needs-human-review");

  const grouped = (list: typeof changes) => {
    const map = new Map<string, typeof changes>();
    for (const c of list) {
      const key = c.rule;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  };

  return `# Human Review Rescore Report

## Summary
- Scan status: ${coverage.scan_status}
- Findings needing review before rescore: ${beforeReview.length}
- Rescored: ${changes.length} findings
- Still needs human review: ${stillReview.length}

## Rescore Impact

| Status | Before | After |
|--------|--------|-------|
| Accepted | ${accepted.length - changes.filter((c) => c.after.status === "accepted").length} | ${accepted.length} |
| Rejected | ${rejected.length - changes.filter((c) => c.after.status === "rejected").length} | ${rejected.length} |
| Needs Review | ${beforeReview.length} | ${stillReview.length} |

${changes.length > 0 ? `## Rescored Findings (${changes.length})

${grouped(changes).map(([rule, items]) => `### ${rule} (${items.length} findings)

| ID | Title | Before | After |
|----|-------|--------|-------|
${items.map((c) => `| \`${c.id.slice(-12)}\` | ${c.title.slice(0, 60)} | ${c.before.priority}/${c.before.status} | ${c.after.priority}/${c.after.status} |`).join("\n")}
`).join("\n\n")}` : "## Rescored Findings\n\nNo findings were rescored.\n"}

${stillReview.length > 0 ? `## Still Needs Human Review (${stillReview.length})

${stillReview.map((f) => `- \`${f.id.slice(-12)}\`: ${f.title.slice(0, 80)} (${f.triage.priority}/${f.triage.status} — ${f.triage.rationale.split("\\n").pop()})`).join("\n")}
` : "## Still Needs Human Review\n\nAll findings resolved. No manual review needed.\n"}

## Rescore Rules Applied
1. Ghost-verified findings → accepted at claimed severity
2. Scanner noise / insufficient evidence → rejected P4
3. Test/example/doc paths without evidence → rejected P4
4. Same-directory entrypoint proximity → accepted P2
5. Dependency CVE/GHSA evidence → accepted at claimed severity
6. Secrets in production paths → accepted P2

## Pipeline Improvement Signals
- If still-review count is high, the reachability agent may need annotation-aware routing detection (e.g., @RequestMapping, @Get, @Post in Spring, Express, Gin).
- Ghost-verified findings with specific file:line evidence should trigger automatic reachability upgrade in the main triage stage.
`;
}

function renderEmptyRescore(review: TriagedFinding[], triaged: TriagedFinding[]): string {
  return `# Human Review Rescore Report

## Summary
- No findings required rescue scoring. All ${triaged.length} findings already resolved in primary triage.
`;
}
