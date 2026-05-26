import type { Finding, TriagedFinding } from "../../core/types.ts";

export function reconcileGhost(finding: Finding, status: TriagedFinding["triage"]["status"], reachability: TriagedFinding["triage"]["reachability"]): TriagedFinding["triage"]["ghost_reconciliation"] {
  if (finding.external_source !== "ghost") return { external_source_present: false, external_status: "none", agreement: "not_applicable", effect_on_confidence: "unchanged", notes: "No Ghost evidence present" };
  if (finding.external_status === "verified" && reachability === "unknown") return { external_source_present: true, external_status: "verified", agreement: "unclear", effect_on_confidence: "unchanged", notes: "Ghost verified, but native reachability is unknown; requires human review" };
  if (finding.external_status === "verified" && status === "accepted") return { external_source_present: true, external_status: "verified", agreement: "agrees", effect_on_confidence: "raised", notes: "Ghost and native triage agree" };
  if (finding.external_status === "rejected" && status !== "rejected") return { external_source_present: true, external_status: "rejected", agreement: "disagrees", effect_on_confidence: "lowered", notes: "Ghost rejected but native evidence survived; human review required" };
  return { external_source_present: true, external_status: finding.external_status, agreement: "unclear", effect_on_confidence: "unchanged", notes: "External status preserved but not authoritative" };
}
