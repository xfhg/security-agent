import type { Finding, TriagedFinding } from "../../core/types.ts";

export function assessReachability(finding: Finding, entrypoints: any): { reachability: TriagedFinding["triage"]["reachability"]; rationale: string } {
  if (finding.entrypoint.reachable) return { reachability: "likely", rationale: "Finding already references a candidate entrypoint" };
  const eps = entrypoints.entrypoints ?? [];
  const sameFile = eps.find((ep: any) => finding.files.some((file) => file.path === ep.path));
  if (sameFile) return { reachability: "likely", rationale: `Same file as entrypoint ${sameFile.name}` };
  if (finding.bug_class === "secrets" || finding.bug_class === "dependency") return { reachability: "possible", rationale: "Non-route issue; runtime relevance requires environment or usage confirmation" };
  return { reachability: "unknown", rationale: "No entrypoint or graph path proved by MVP analysis" };
}
