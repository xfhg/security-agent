import { readFile } from "node:fs/promises";
import path from "node:path";
import { agentPath, exists } from "../core/paths.ts";
import { nowIso, repoCommit, stableHash } from "../core/provenance.ts";
import { writeJson } from "../core/artifact-writer.ts";
import type { Finding, ToolRunRecord } from "../core/types.ts";
import { detectCommand, runTool } from "./tool-runner.ts";

// CWE-20 (External Taint Escape): produces excessive noise from taint analysis of internal/third-party data flows.
// Excluded at scanner level. Add more comma-separated CWEs as noise patterns are discovered.
const COGNIUM_EXCLUDE_CWES = "CWE-20";

export async function detectCognium() {
  return detectCommand("cognium", ["semantic-sast", "security-category", "exclude-tests", "json-output"]);
}

export async function runCogniumSecurityScan(repo: string): Promise<{ findings: Finding[]; toolRun: ToolRunRecord | null; unavailable?: string }> {
  const rawPath = agentPath(repo, "findings", "raw", "semantic-sast.json");
  const capability = await detectCognium();
  const scanTarget = await exists(path.join(repo, "src")) ? "./src" : ".";
  const limitations = scanTarget === "." ? ["./src not found; scanned repository root instead"] : [];

  if (!capability.available) {
    await writeJson(rawPath, {
      unavailable: true,
      reason: capability.reason,
      capability,
      command: ["cognium", "scan", scanTarget, "--category", "security", "--exclude-tests", "--exclude-cwe", COGNIUM_EXCLUDE_CWES, "--format", "json"],
      results: [],
      limitations
    });
    return { findings: [], toolRun: null, unavailable: capability.reason };
  }

  const command = ["cognium", "scan", scanTarget, "--category", "security", "--exclude-tests", "--exclude-cwe", COGNIUM_EXCLUDE_CWES, "--format", "json", "--output", rawPath];
  const run = await runTool(repo, "cognium", command, rawPath, 120_000, [0, 1]);
  const raw = await readCogniumRaw(rawPath, run.stdout, run.stderr);
  await writeJson(rawPath, {
    ...asObject(raw),
    capability,
    command,
    tool_run: run.record,
    accepted_exit_codes: [0, 1],
    exit_code_note: "Cognium exits 1 when security findings are present; this is not treated as tool failure.",
    limitations
  });

  return { findings: await normalizeCognium(repo, rawPath), toolRun: run.record };
}

async function readCogniumRaw(rawPath: string, stdout: string, stderr: string): Promise<unknown> {
  const candidates: string[] = [];
  try {
    candidates.push(await readFile(rawPath, "utf8"));
  } catch {
    // Cognium may emit JSON to stdout if --output is unsupported by an older build.
  }
  candidates.push(stdout);

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Keep looking.
    }
  }

  return {
    parse_error: true,
    stdout_preview: stdout.slice(0, 1000),
    stderr_preview: stderr.slice(0, 1000),
    results: []
  };
}

async function normalizeCognium(repo: string, rawPath: string): Promise<Finding[]> {
  const raw = JSON.parse(await readFile(rawPath, "utf8"));
  const results = extractResults(raw);
  const commit = await repoCommit(repo);

  return results.map((result: any): Finding => {
    const filePath = String(result.path ?? result.file ?? result.filename ?? result.location?.file ?? result.location?.path ?? "unknown");
    const line = Number(result.line ?? result.start_line ?? result.location?.line ?? result.location?.startLine ?? 1);
    const ruleId = String(result.rule_id ?? result.ruleId ?? result.id ?? result.type ?? result.name ?? "cognium-finding");
    const cwe = String(result.cwe ?? result.cwe_id ?? result.cweId ?? result.metadata?.cwe ?? "");
    const message = String(result.message ?? result.description ?? result.title ?? result.details ?? ruleId);
    const severity = mapSeverity(result.severity ?? result.level);
    const bugClass = classifyCognium(ruleId, message, cwe);
    const key = stableHash(["cognium", ruleId, cwe, filePath, line, message].join("|"));

    return {
      id: `finding-${key.slice(0, 16)}`,
      title: message.slice(0, 120),
      bug_class: bugClass,
      severity_claim: severity,
      confidence: "medium",
      stage: "discovery",
      source_agent: "semantic-sast-agent",
      tool: "cognium",
      external_source: "none",
      external_status: "none",
      files: [{ path: filePath, start_line: line, end_line: Number(result.end_line ?? result.location?.endLine ?? line) }],
      entrypoint: { type: "unknown", name: "unknown", reachable: false, evidence: "Cognium semantic finding does not prove external reachability by itself" },
      dataflow: {
        source: String(result.source ?? result.taint_source ?? result.dataflow?.source ?? "unknown"),
        sink: String(result.sink ?? result.taint_sink ?? result.dataflow?.sink ?? ruleId),
        sanitizers: Array.isArray(result.sanitizers) ? result.sanitizers.map(String) : [],
        missing_checks: inferMissingChecks(bugClass)
      },
      evidence: [{ kind: "rule", content: [ruleId, cwe, message].filter(Boolean).join(" ").slice(0, 500), path: filePath, line, provenance: rawPath }],
      reproduction_hint: "Review the referenced source, source/sink trace, and missing checks. No exploit payload generated by MVP.",
      dedup_key: stableHash([bugClass, filePath, line, ruleId, cwe].join("|")),
      limitations: ["semantic SAST finding requires native reachability and false-positive triage before acceptance"],
      created_at: nowIso(),
      repo_commit: commit
    };
  });
}

function extractResults(raw: any): any[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry: any): any[] => {
      const vulns = entry?.vulnerabilities ?? entry?.findings ?? entry?.issues;
      if (Array.isArray(vulns) && vulns.length > 0) {
        return vulns.map((v: any) => ({
          ...v,
          file: v.file ?? v.path ?? entry?.file ?? entry?.path,
          line: v.line ?? entry?.line
        }));
      }
      if (entry?.vulnerabilities !== undefined || entry?.findings !== undefined || entry?.issues !== undefined) return [];
      return [{ ...entry, file: entry.file ?? entry.path }];
    });
  }
  for (const key of ["results", "findings", "vulnerabilities", "issues"]) {
    if (Array.isArray(raw?.[key])) return extractResults(raw[key]);
  }
  return [];
}

function asObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return { results: Array.isArray(raw) ? raw : [] };
}

function mapSeverity(severity: unknown): Finding["severity_claim"] {
  const value = String(severity ?? "").toLowerCase();
  if (value === "critical") return "critical";
  if (value === "high") return "high";
  if (value === "medium") return "medium";
  if (value === "low") return "low";
  return "medium";
}

function classifyCognium(ruleId: string, message: string, cwe: string): Finding["bug_class"] {
  const text = `${ruleId} ${message} ${cwe}`.toLowerCase();
  if (/cwe-89|cwe-78|cwe-90|cwe-643|cwe-943|cwe-918|cwe-22|sql|nosql|ldap|xpath|command|code.injection|ssrf|traversal/.test(text)) return "injection";
  if (/authz|authorization|idor|access.control|tenant|cwe-639|cwe-862|cwe-863/.test(text)) return "authz";
  if (/authn|authentication|jwt|session|cwe-287|cwe-384/.test(text)) return "authn";
  if (/secret|token|credential|password|apikey|api.key/.test(text)) return "secrets";
  if (/crypto|hash|cipher|random|tls|ssl|cwe-327|cwe-330/.test(text)) return "crypto";
  if (/deserialize|xxe|xml|yaml|pickle|marshal|prototype|cwe-502|cwe-611/.test(text)) return "deserialization";
  if (/config|cors|debug|cookie|cwe-614/.test(text)) return "config";
  return "other";
}

function inferMissingChecks(bugClass: Finding["bug_class"]): string[] {
  if (bugClass === "injection") return ["validation", "escaping"];
  if (bugClass === "authz") return ["authorization", "ownership check"];
  if (bugClass === "authn") return ["authentication"];
  if (bugClass === "crypto") return ["secure algorithm/configuration"];
  if (bugClass === "deserialization") return ["safe parser", "type check"];
  if (bugClass === "config") return ["secure configuration"];
  return [];
}
