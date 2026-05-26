import type { Finding, TriagedFinding } from "../../core/types.ts";

export function challengeFinding(finding: Finding): { risk: TriagedFinding["triage"]["false_positive_risk"]; notes: string[] } {
  const notes: string[] = [];
  const pathText = finding.files.map((file) => file.path).join(" ");
  if (/test|spec|fixture|example|docs?\//i.test(pathText)) notes.push("test/example/documentation path defaults to downgrade unless runtime usage is proved");
  if (finding.confidence === "low") notes.push("low-confidence discovery evidence");
  if (finding.entrypoint.type === "unknown" && !finding.entrypoint.reachable) notes.push("no confirmed entrypoint");
  if (finding.dataflow.sink === "unknown") notes.push("no concrete sink");
  if (finding.bug_class === "authz" && !/auth|owner|tenant|role|policy/i.test(JSON.stringify(finding.evidence))) notes.push("authz claim has no policy/ownership context");
  const risk = notes.length >= 2 ? "high" : notes.length === 1 ? "medium" : "low";
  return { risk, notes };
}
