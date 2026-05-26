export type Confidence = "high" | "medium" | "low";
export type ToolStatus = "available" | "unavailable" | "failed" | "success" | "skipped";
export type FindingStatus = "accepted" | "rejected" | "needs-human-review";

export interface ToolCapability {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
  reason?: string;
  capabilities: string[];
}

export interface ToolRunRecord {
  id: string;
  tool: string;
  command: string[];
  start_time: string;
  end_time: string;
  exit_code: number | null;
  stdout_path: string;
  stderr_path: string;
  output_artifact_path: string | null;
  summarized_failure_reason: string | null;
  repo_commit: string;
}

export interface Evidence {
  kind: "code" | "command" | "graph" | "rule" | "reasoning" | "ghost-import";
  content: string;
  path?: string;
  line?: number;
  provenance: string;
}

export interface Finding {
  id: string;
  title: string;
  bug_class: "injection" | "authz" | "authn" | "secrets" | "crypto" | "deserialization" | "config" | "dependency" | "business_logic" | "other";
  severity_claim: "critical" | "high" | "medium" | "low" | "info";
  confidence: Confidence;
  stage: "discovery";
  source_agent: string;
  tool: string;
  external_source: "ghost" | "none" | "other";
  external_status: "verified" | "unverified" | "rejected" | "unknown" | "none";
  files: Array<{ path: string; start_line: number; end_line: number }>;
  entrypoint: { type: "http" | "cli" | "rpc" | "queue" | "cron" | "library" | "iac" | "unknown"; name: string; reachable: boolean; evidence: string };
  dataflow: { source: string; sink: string; sanitizers: string[]; missing_checks: string[] };
  evidence: Evidence[];
  reproduction_hint: string;
  dedup_key: string;
  limitations: string[];
  created_at: string;
  repo_commit: string;
}

export interface TriagedFinding extends Finding {
  triage: {
    status: FindingStatus;
    final_severity: "critical" | "high" | "medium" | "low" | "info";
    priority: "P0" | "P1" | "P2" | "P3" | "P4";
    reachability: "confirmed" | "likely" | "possible" | "unlikely" | "unknown";
    exploitability: "high" | "medium" | "low" | "unknown";
    impact: "critical" | "high" | "medium" | "low" | "unknown";
    false_positive_risk: "high" | "medium" | "low";
    votes: { attacker: "true_positive" | "false_positive" | "unsure"; defender: "true_positive" | "false_positive" | "unsure"; maintainer: "true_positive" | "false_positive" | "unsure" };
    ghost_reconciliation: { external_source_present: boolean; external_status: Finding["external_status"]; agreement: "agrees" | "disagrees" | "not_applicable" | "unclear"; effect_on_confidence: "raised" | "lowered" | "unchanged"; notes: string };
    rationale: string;
    required_human_checks: string[];
    next_stage_recommendation: "prove" | "ignore" | "manual-review" | "rule-improvement";
  };
}
