import { writeFile } from "node:fs/promises";
import { readJson, writeJson } from "../core/artifact-writer.ts";
import { agentPath, exists } from "../core/paths.ts";
import type { Finding } from "../core/types.ts";
import { runOpenGrepSastAgent } from "../agents/discovery/opengrep-sast.ts";
import { runSemanticSastAgent } from "../agents/discovery/semantic-sast.ts";
import { runSecretsConfigAgent } from "../agents/discovery/secrets-config.ts";
import { runSensitiveExposureAgent } from "../agents/discovery/sensitive-exposure.ts";
import { runInjectionAgent } from "../agents/discovery/injection.ts";
import { runAuthzAuthnAgent } from "../agents/discovery/authz-authn.ts";
import { runDeserializationParserAgent } from "../agents/discovery/deserialization-parser.ts";
import { runCryptoAgent } from "../agents/discovery/crypto.ts";
import { runDependencyRiskAgent } from "../agents/discovery/dependency-risk.ts";
import { runBusinessLogicAgent } from "../agents/discovery/business-logic.ts";
import { ghostPreflight, importGhostFindings } from "../adapters/ghost.ts";
import { readCoverageGates, readCoverageStatus } from "../core/coverage-gates.ts";

export async function discoveryStage(repo: string, options: { useGhost?: boolean; bugClasses?: string[] } = {}): Promise<void> {
  if (!(await exists(agentPath(repo, "kb", "repo-map.json")))) throw new Error("discovery requires recon artifacts");
  const all: Finding[] = [];
  const opengrep = await runOpenGrepSastAgent(repo);
  all.push(...opengrep.findings);
  all.push(...await runSemanticSastAgent(repo));
  const candidates: Array<[string, () => Promise<Finding[]>]> = [
    ["secrets", () => runSecretsConfigAgent(repo)],
    ["logging", () => runSensitiveExposureAgent(repo)],
    ["injection", () => runInjectionAgent(repo)],
    ["authz", () => runAuthzAuthnAgent(repo)],
    ["deserialization", () => runDeserializationParserAgent(repo)],
    ["crypto", () => runCryptoAgent(repo)],
    ["dependency", () => runDependencyRiskAgent(repo)],
    ["business_logic", () => runBusinessLogicAgent(repo)]
  ];
  for (const [bugClass, fn] of candidates) {
    if (!options.bugClasses?.length || options.bugClasses.includes(bugClass)) {
      const findings = await fn();
      all.push(...findings);
      if (findings.length > 0) {
        await writeJson(agentPath(repo, "findings", "raw", `${rawName(bugClass)}.json`), { results: findings });
      }
    }
  }
  if (options.useGhost) {
    await ghostPreflight(repo);
    all.push(...await importGhostFindings(repo, "code"));
    all.push(...await importGhostFindings(repo, "deps"));
    all.push(...await importGhostFindings(repo, "secrets"));
  }
  await writeJson(agentPath(repo, "findings", "normalized", "findings.json"), all);
  await writeFile(agentPath(repo, "workflow", "discovery-summary.md"), renderDiscovery(all, opengrep.unavailable, await readCoverageStatus(repo), await readCoverageGates(repo)), "utf8");
}

function rawName(bugClass: string): string {
  return bugClass === "authz" ? "authz-authn" : bugClass === "business_logic" ? "business-logic" : bugClass === "logging" ? "logging-exposure" : bugClass;
}

function renderDiscovery(findings: Finding[], opengrepUnavailable: string | undefined, coverage: Awaited<ReturnType<typeof readCoverageStatus>>, gates: Awaited<ReturnType<typeof readCoverageGates>>): string {
  const byClass = countBy(findings, (finding) => finding.bug_class);
  const byConfidence = countBy(findings, (finding) => finding.confidence);
  const byAgent = countBy(findings, (finding) => finding.source_agent);
  return `# Discovery Report

## Summary
- Scan status: ${coverage.scan_status}
- Blocked gates: ${coverage.blocked_gates.length ? coverage.blocked_gates.join(", ") : "none"}
- Total normalized findings: ${findings.length}
- OpenGrep status: ${opengrepUnavailable ? `unavailable (${opengrepUnavailable})` : "executed or returned no availability error"}

## Coverage Gates
${gates.map((gate) => `- ${gate.gate}: ${gate.status}${gate.blocker_reason ? ` (${gate.blocker_reason})` : ""}`).join("\n") || "- none"}

## By Bug Class
${formatCounts(byClass)}

## By Source Agent
${formatCounts(byAgent)}

## By Confidence
${formatCounts(byConfidence)}

## Top 10 Candidates
${findings.slice(0, 10).map((finding) => `- ${finding.severity_claim.toUpperCase()} ${finding.title} (${finding.source_agent})`).join("\n") || "- none"}

## Limitations
- Discovery is intentionally noisy.
- Native triage must decide acceptance, priority, and false-positive handling.
`;
}

function countBy<T>(items: T[], fn: (item: T) => string): Record<string, number> {
  return items.reduce((acc, item) => ({ ...acc, [fn(item)]: (acc[fn(item)] ?? 0) + 1 }), {} as Record<string, number>);
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- none";
}
