import type { Finding, TriagedFinding } from "../../core/types.ts";

export function runSeverityPanel(finding: Finding, reachability: TriagedFinding["triage"]["reachability"], fpRisk: TriagedFinding["triage"]["false_positive_risk"]): TriagedFinding["triage"]["votes"] {
  const attacker = reachability === "confirmed" || reachability === "likely" || finding.bug_class === "secrets" ? "true_positive" : "unsure";
  const defender = fpRisk === "high" ? "false_positive" : fpRisk === "medium" ? "unsure" : "true_positive";
  const maintainer = /test|spec|fixture|example|docs?\//i.test(finding.files.map((file) => file.path).join(" ")) ? "false_positive" : finding.confidence === "low" ? "unsure" : "true_positive";
  return { attacker, defender, maintainer };
}
