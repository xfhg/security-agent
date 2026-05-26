import { readFile } from "node:fs/promises";
import path from "node:path";
import { nowIso, repoCommit, stableHash } from "../../core/provenance.ts";
import { secretFingerprint } from "../../core/redaction.ts";
import type { Finding } from "../../core/types.ts";
import { walk } from "../recon/repo-cartographer.ts";

export interface HeuristicRule {
  agent: string;
  tool: string;
  bugClass: Finding["bug_class"];
  title: string;
  severity: Finding["severity_claim"];
  confidence: Finding["confidence"];
  pattern: RegExp;
  sink?: string;
  missingChecks?: string[];
  fileFilter?: RegExp;
  evidenceKind?: Finding["evidence"][number]["kind"];
}

export async function runHeuristicRules(repo: string, rules: HeuristicRule[], rawName: string): Promise<Finding[]> {
  const files = (await walk(repo)).filter((file) => /\.(ts|tsx|js|jsx|py|go|java|rb|php|cs|yaml|yml|json|toml|tf|env|md|txt|sh|Dockerfile)$/i.test(file));
  const commit = await repoCommit(repo);
  const findings: Finding[] = [];
  for (const file of files) {
    for (const rule of rules) {
      if (rule.fileFilter && !rule.fileFilter.test(file)) continue;
      const body = await readFile(path.join(repo, file), "utf8").catch(() => "");
      const lines = body.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        if (!rule.pattern.test(line)) continue;
        rule.pattern.lastIndex = 0;
        const evidence = rule.bugClass === "secrets" ? line.replace(/(.{0,20})([A-Za-z0-9_+=/-]{12,})(.{0,20})/, `$1[REDACTED:${secretFingerprint(line)}]$3`) : line.trim().slice(0, 500);
        const key = stableHash([rule.bugClass, file, index + 1, rule.title, evidence].join("|"));
        findings.push({
          id: `finding-${key.slice(0, 16)}`,
          title: rule.title,
          bug_class: rule.bugClass,
          severity_claim: rule.severity,
          confidence: rule.confidence,
          stage: "discovery",
          source_agent: rule.agent,
          tool: rule.tool,
          external_source: "none",
          external_status: "none",
          files: [{ path: file, start_line: index + 1, end_line: index + 1 }],
          entrypoint: { type: "unknown", name: "unknown", reachable: false, evidence: "Heuristic finding; reachability assessed in triage" },
          dataflow: { source: "unknown", sink: rule.sink ?? "unknown", sanitizers: [], missing_checks: rule.missingChecks ?? [] },
          evidence: [{ kind: rule.evidenceKind ?? "code", content: evidence, path: file, line: index + 1, provenance: `findings/raw/${rawName}.json` }],
          reproduction_hint: "Manual source review required. MVP does not generate exploit payloads.",
          dedup_key: stableHash([rule.bugClass, file, rule.sink ?? rule.title].join("|")),
          limitations: ["heuristic match; must pass native triage"],
          created_at: nowIso(),
          repo_commit: commit
        });
      }
    }
  }
  return findings;
}
