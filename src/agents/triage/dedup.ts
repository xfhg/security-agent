import type { Finding } from "../../core/types.ts";

export function deduplicateFindings(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const finding of findings) {
    const existing = byKey.get(finding.dedup_key);
    if (!existing) {
      byKey.set(finding.dedup_key, finding);
      continue;
    }
    existing.evidence.push(...finding.evidence);
    existing.limitations = [...new Set([...existing.limitations, ...finding.limitations])];
    existing.confidence = maxConfidence(existing.confidence, finding.confidence);
    if (finding.external_source !== "none") {
      existing.external_source = finding.external_source;
      existing.external_status = finding.external_status;
    }
  }
  return [...byKey.values()];
}

function maxConfidence(a: Finding["confidence"], b: Finding["confidence"]): Finding["confidence"] {
  const order = { low: 0, medium: 1, high: 2 };
  return order[b] > order[a] ? b : a;
}
