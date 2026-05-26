import type { Finding, TriagedFinding } from "../../core/types.ts";

export function assessImpact(finding: Finding): { impact: TriagedFinding["triage"]["impact"]; asset: string; rationale: string } {
  if (finding.severity_claim === "critical") return { impact: "critical", asset: "runtime/security boundary", rationale: "Scanner or import claimed critical impact; triage still gates acceptance" };
  if (finding.bug_class === "secrets") return { impact: "high", asset: "credential or token", rationale: "Secret compromise can cross trust boundaries" };
  if (finding.bug_class === "injection" || finding.bug_class === "authz" || finding.bug_class === "authn") return { impact: "high", asset: "application trust boundary", rationale: "Bug class can affect confidentiality, integrity, or privilege boundaries" };
  if (finding.bug_class === "dependency" || finding.bug_class === "crypto") return { impact: "medium", asset: "supply chain or cryptographic control", rationale: "Impact depends on runtime usage and configuration" };
  return { impact: "medium", asset: "application behavior", rationale: "Impact requires more context" };
}
