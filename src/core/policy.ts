import type { Finding, TriagedFinding } from "./types.ts";

export function priorityFor(finding: Finding, reachability: TriagedFinding["triage"]["reachability"], exploitability: TriagedFinding["triage"]["exploitability"], impact: TriagedFinding["triage"]["impact"]): TriagedFinding["triage"]["priority"] {
  if (reachability === "confirmed" && exploitability === "high" && (impact === "critical" || impact === "high")) return "P0";
  if (finding.bug_class === "secrets" && finding.confidence === "high" && (finding.severity_claim === "critical" || finding.severity_claim === "high")) return "P1";
  if ((reachability === "confirmed" || reachability === "likely") && (finding.severity_claim === "critical" || finding.severity_claim === "high")) return "P1";
  if (reachability === "likely" || finding.confidence === "medium") return "P2";
  if (finding.confidence === "low" || reachability === "possible" || reachability === "unknown") return "P3";
  return "P4";
}

export function finalSeverity(priority: TriagedFinding["triage"]["priority"]): TriagedFinding["triage"]["final_severity"] {
  return ({ P0: "critical", P1: "high", P2: "medium", P3: "low", P4: "info" } as const)[priority];
}

export function statusFromVotes(votes: TriagedFinding["triage"]["votes"]): TriagedFinding["triage"]["status"] {
  const values = Object.values(votes);
  const tp = values.filter((vote) => vote === "true_positive").length;
  const fp = values.filter((vote) => vote === "false_positive").length;
  if (tp >= 2) return "accepted";
  if (fp >= 2) return "rejected";
  return "needs-human-review";
}
