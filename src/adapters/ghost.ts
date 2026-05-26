import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentPath, binPath, exists, isAllowedWorkspacePath, localPath, platformArch, securityAgentHome } from "../core/paths.ts";
import { nowIso, repoCommit, stableHash } from "../core/provenance.ts";
import { redactSecrets } from "../core/redaction.ts";
import { writeJson } from "../core/artifact-writer.ts";
import type { Finding } from "../core/types.ts";
import { executable } from "../core/toolchain.ts";

export const DEFAULT_GHOST_SKILLS_REPO_PATH = path.join(securityAgentHome(), "ghost", "skills", "plugins", "ghost");

type GhostScanType = "code" | "deps" | "secrets";

export async function detectGhost(repo: string, skillsRepoPath = process.env.GHOST_SKILLS_REPO_PATH ?? DEFAULT_GHOST_SKILLS_REPO_PATH) {
  const evidenceDir = agentPath(repo, "evidence", "ghost");
  const integrationsDir = agentPath(repo, "integrations", "ghost");
  const repoId = stableHash(path.resolve(repo)).slice(0, 16);
  const ghostRepoDir = localPath("ghost", "repos", repoId);
  const repoContext = await firstExisting([path.join(evidenceDir, "repo.md"), path.join(integrationsDir, "repo.md")]);
  const report = await firstExisting([path.join(evidenceDir, "report.md"), path.join(integrationsDir, "report.md")]);
  const skills = await detectGhostSkills(skillsRepoPath);
  const detected = {
    repo_context: Boolean(repoContext),
    code_scan: Boolean(await firstExisting([path.join(evidenceDir, "scan-code-findings.json")])) || (await collectMarkdown(integrationsDir, "code")).length > 0,
    deps_scan: Boolean(await firstExisting([path.join(evidenceDir, "scan-deps-findings.json")])) || (await collectMarkdown(integrationsDir, "deps")).length > 0,
    secrets_scan: Boolean(await firstExisting([path.join(evidenceDir, "scan-secrets-findings.json")])) || (await collectMarkdown(integrationsDir, "secrets")).length > 0,
    report: Boolean(report),
    skills_repo: skills.available
  };

  return {
    available: Object.values(detected).some(Boolean),
    mode: "local-artifact-import-only",
    ghost_home: ".local/ghost",
    forbidden_external_paths: ["global-user-ghost-home"],
    allowed_roots: [securityAgentHome(), "/tmp"],
    repo_id: repoId,
    cache_dir: path.join(".local", "ghost", "repos", repoId, "cache"),
    scans_dir: path.join(".local", "ghost", "repos", repoId, "scans"),
    evidence_dir: evidenceDir,
    integrations_dir: integrationsDir,
    skills_repo_path: skills.available ? skillsRepoPath : null,
    detected_artifacts: detected,
    detected_skills: skills.skills,
    forbidden_skills: skills.forbidden
  };
}

export async function ghostPreflight(repo: string) {
  const detection = await detectGhost(repo);
  const currentPlatform = platformArch();
  const requiredBinaries = ["wraith", "osv-scanner", "poltergeist"].map((name) => ({
    name,
    path: binPath("ghost", currentPlatform, name)
  }));
  const binaryChecks = await Promise.all(requiredBinaries.map(async (item) => ({
    ...item,
    executable: await executable(item.path)
  })));
  const skillLeakChecks = await scanGhostSkillLeaks(DEFAULT_GHOST_SKILLS_REPO_PATH);
  const blockers = [
    ...binaryChecks.filter((item) => !item.executable).map((item) => `missing executable ${item.name}: ${item.path}`),
    ...skillLeakChecks.leaks.map((leak) => `forbidden Ghost path reference in ${leak.path}:${leak.line}`)
  ];
  const artifact = {
    status: blockers.length ? "blocked" : "ready",
    checked_at: nowIso(),
    repo_commit: await repoCommit(repo),
    platform: currentPlatform,
    ghost_home: detection.ghost_home,
    cache_dir: detection.cache_dir,
    scans_dir: detection.scans_dir,
    evidence_dir: detection.evidence_dir,
    required_binaries: binaryChecks,
    skill_path_scan: skillLeakChecks,
    forbidden_external_paths: detection.forbidden_external_paths,
    blockers
  };
  await mkdir(agentPath(repo, "evidence", "ghost"), { recursive: true });
  await writeJson(agentPath(repo, "evidence", "ghost", "preflight.json"), artifact);
  return artifact;
}

export async function importGhostRepoContext(repo: string) {
  const detection = await detectGhost(repo);
  const output = agentPath(repo, "kb", "ghost-context.json");
  const targetMd = agentPath(repo, "integrations", "ghost", "repo.md");
  const source = await firstExisting([agentPath(repo, "evidence", "ghost", "repo.md"), targetMd]);

  if (!source) {
    const artifact = { imported: false, reason: "Local Ghost repo context not found", detection, imported_at: nowIso() };
    await writeJson(output, artifact);
    await writeGhostSkills(repo, detection);
    return artifact;
  }

  if (source !== targetMd) await cp(source, targetMd);
  const body = redactSecrets(await readFile(source, "utf8"));
  const artifact = {
    imported: true,
    source: "ghost-repo-context",
    original_file_path: source,
    imported_file_path: targetMd,
    imported_at: nowIso(),
    repo_commit: await repoCommit(repo),
    confidence: "imported",
    extracted_notes: body.split("\n").filter((line) => /^#{1,3}\s+|critical|sensitive|auth|route|service|dependency/i.test(line)).slice(0, 80)
  };
  await writeJson(output, artifact);
  await writeGhostSkills(repo, detection);
  return artifact;
}

export async function importGhostFindings(repo: string, scanType: GhostScanType): Promise<Finding[]> {
  const detection = await detectGhost(repo);
  const logPath = agentPath(repo, "integrations", "ghost", "import-log.json");
  const outPath = agentPath(repo, "findings", "normalized", `ghost-${scanType === "code" ? "code" : scanType}-findings.json`);
  const findings = [
    ...(await importLocalGhostJson(repo, scanType)),
    ...(await importLocalGhostMarkdown(repo, scanType))
  ];

  await writeJson(outPath, findings);
  await writeJson(logPath, {
    imported: findings.length > 0,
    reason: findings.length > 0 ? null : "No local Ghost evidence found under evidence/ghost or integrations/ghost",
    scan_type: scanType,
    count: findings.length,
    imported_at: nowIso(),
    evidence_dir: detection.evidence_dir,
    integrations_dir: detection.integrations_dir,
    forbidden_external_paths: detection.forbidden_external_paths
  });
  return findings;
}

async function importLocalGhostJson(repo: string, scanType: GhostScanType): Promise<Finding[]> {
  const source = await firstExisting([agentPath(repo, "evidence", "ghost", `scan-${scanType}-findings.json`)]);
  if (!source) return [];

  const rawText = redactSecrets(await readFile(source, "utf8"));
  let raw: any;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return [];
  }

  let findings: any[] = [];
  if (Array.isArray(raw)) {
    findings = raw;
  } else if (Array.isArray(raw.findings)) {
    findings = raw.findings;
  } else if (Array.isArray(raw.results)) {
    if (scanType === "deps") {
      findings = raw.results.flatMap((pkg: any) => {
        const vulns = pkg.found_vulnerabilities ?? pkg.FoundVulnerabilities ?? pkg.vulnerabilities ?? [];
        return Array.isArray(vulns) ? vulns.map((v: any) => ({
          ...v,
          _package: pkg.package ?? pkg.Package ?? pkg.name,
          _version: pkg.version ?? pkg.Version,
          _ecosystem: pkg.ecosystem ?? pkg.Ecosystem
        })) : [];
      });
    } else {
      findings = raw.results.flatMap((r: any) =>
        Array.isArray(r.vulnerabilities ?? r.Vulnerabilities) ? (r.vulnerabilities ?? r.Vulnerabilities) : [r]
      );
    }
  }

  const commit = await repoCommit(repo);
  const normalized: Finding[] = [];
  await mkdir(agentPath(repo, "findings", "raw", `ghost-${scanType}`), { recursive: true });

  for (const [index, item] of findings.entries()) {
    const mirror = agentPath(repo, "findings", "raw", `ghost-${scanType}`, `${String(item.id ?? index).replace(/[^a-z0-9_.-]/gi, "-")}.json`);
    await writeJson(mirror, item);
    normalized.push(normalizeGhostItem(repo, scanType, item, source, mirror, commit));
  }

  return normalized;
}

async function importLocalGhostMarkdown(repo: string, scanType: GhostScanType): Promise<Finding[]> {
  const files = await collectMarkdown(agentPath(repo, "integrations", "ghost"), scanType);
  const commit = await repoCommit(repo);
  const findings: Finding[] = [];
  await mkdir(agentPath(repo, "findings", "raw", `ghost-${scanType}`), { recursive: true });

  for (const file of files) {
    const content = redactSecrets(await readFile(file, "utf8"));
    const mirror = agentPath(repo, "findings", "raw", `ghost-${scanType}`, path.basename(file));
    await writeFile(mirror, content, "utf8");
    findings.push(normalizeGhostItem(repo, scanType, {
      title: firstHeading(content) || `Ghost ${scanType} finding`,
      severity: /critical/i.test(content) ? "critical" : /high/i.test(content) ? "high" : /low/i.test(content) ? "low" : "medium",
      evidence: content.slice(0, 500),
      confidence: /verified|confirmed/i.test(content) ? "medium" : "low",
      status: /rejected|false.positive/i.test(content) ? "rejected" : /verified|confirmed/i.test(content) ? "verified" : "unknown"
    }, file, mirror, commit));
  }

  return findings;
}

function normalizeGhostItem(repo: string, scanType: GhostScanType, item: any, source: string, mirror: string, commit: string): Finding {
  const pkgName = item._package ?? String(item.package ?? item.Package ?? "");
  const pkgVersion = item._version ?? String(item.version ?? item.Version ?? "");
  const vulnId = String(item.id ?? item.ID ?? item.aliases?.[0] ?? item.Aliases?.[0] ?? item.CVEs?.[0] ?? item.name ?? "");
  const summary = String(item.summary ?? item.Summary ?? item.description ?? item.title ?? item.details ?? "");
  const title = scanType === "deps" && pkgName
    ? `${vulnId}: ${summary || `vulnerability in ${pkgName}`}`.slice(0, 120)
    : String(item.title ?? item.name ?? item.id ?? `Ghost ${scanType} finding`).slice(0, 120);
  const severity = mapSeverity(item.severity ?? item.Severity);
  const bugClass = scanType === "deps" ? "dependency" : scanType === "secrets" ? "secrets" : classifyGhostCode(item);
  const files = parseGhostFiles(item);
  const status = scanType === "deps" && (vulnId || String(item.ID || ""))
    ? "verified"
    : mapExternalStatus(item.status ?? item.external_status ?? item.confidence);
  const confidence = mapConfidence(item.confidence, status);
  const evidenceContent = redactSecrets(String(item.evidence ?? item.context ?? item.description ?? item.impact ?? summary ?? title)).slice(0, 500);
  const key = stableHash(["ghost-local", scanType, vulnId || item.id, title, JSON.stringify(files), evidenceContent].join("|"));

  return {
    id: `ghost-${key.slice(0, 16)}`,
    title: title.slice(0, 120),
    bug_class: bugClass,
    severity_claim: severity,
    confidence,
    stage: "discovery",
    source_agent: "ghost-finding-import-agent",
    tool: "ghost-import",
    external_source: "ghost",
    external_status: status,
    files,
    entrypoint: { type: "unknown", name: "unknown", reachable: false, evidence: "Imported local Ghost finding; native reachability not established" },
    dataflow: {
      source: String(item.source ?? item.vector ?? "unknown"),
      sink: String(item.sink ?? item.type ?? item.vector ?? "unknown"),
      sanitizers: [],
      missing_checks: inferMissingChecks(bugClass)
    },
    evidence: [{ kind: "ghost-import", content: scanType === "deps" && pkgName ? `${pkgName}@${pkgVersion}: ${evidenceContent}` : evidenceContent, path: mirror, line: files[0]?.start_line, provenance: source }],
    reproduction_hint: "Review imported Ghost evidence. MVP does not run live validation.",
    dedup_key: stableHash([bugClass, title, files.map((file) => `${file.path}:${file.start_line}`).join(","), evidenceContent.slice(0, 120)].join("|")),
    limitations: ["external finding; must pass native triage"],
    created_at: nowIso(),
    repo_commit: commit
  };
}

function parseGhostFiles(item: any): Finding["files"] {
  const refs: string[] = [];

  if (typeof item.file === "string") {
    refs.push(`${item.file}${item.line ? `:${item.line}` : ""}`);
  } else if (item.file && typeof item.file === "object") {
    const p = item.file.path ?? item.file.file ?? "";
    if (typeof p === "string") refs.push(`${p}${item.file.line ? `:${item.file.line}` : ""}`);
  }

  if (Array.isArray(item.files)) {
    for (const f of item.files) {
      if (typeof f === "string") {
        refs.push(f);
      } else if (f && typeof f === "object") {
        const p = f.path ?? f.file ?? f.location ?? "";
        const l = f.line ?? f.start_line ?? "";
        if (typeof p === "string") refs.push(`${p}${l ? `:${l}` : ""}`);
      }
    }
  }

  if (typeof item.location === "string") {
    refs.push(item.location);
  } else if (item.location && typeof item.location === "object") {
    const p = item.location.path ?? item.location.file ?? item.location.location ?? "";
    const l = item.location.line ?? item.location.startLine ?? "";
    if (typeof p === "string") refs.push(`${p}${l ? `:${l}` : ""}`);
  }

  return refs.flatMap((ref) => {
    const match = ref.match(/^(.+?)(?::(\d+(?:,\d+)*))?$/);
    if (!match) return [];
    const filePath = match[1] ?? "unknown";
    const firstLine = Number(match[2]?.split(",")[0] ?? 1);
    return [{ path: filePath, start_line: Number.isFinite(firstLine) ? firstLine : 1, end_line: Number.isFinite(firstLine) ? firstLine : 1 }];
  });
}

function classifyGhostCode(item: any): Finding["bug_class"] {
  const text = `${item.vector ?? ""} ${item.type ?? ""} ${item.title ?? ""} ${item.cwe ?? ""}`.toLowerCase();
  if (/command|injection|ssrf|traversal|cwe-78|cwe-22|cwe-918/.test(text)) return "injection";
  if (/authz|authorization|idor|tenant/.test(text)) return "authz";
  if (/authn|authentication|session|jwt/.test(text)) return "authn";
  if (/secret|credential|password|token|log|cwe-532|cwe-214/.test(text)) return "secrets";
  if (/crypto|tls|ssl|random|hash|cwe-327|cwe-330/.test(text)) return "crypto";
  if (/yaml|xml|deserialize|parser|cwe-502|cwe-611/.test(text)) return "deserialization";
  if (/dependency|package|supply|cve|ghsa/.test(text)) return "dependency";
  if (/config|cors|debug/.test(text)) return "config";
  return "other";
}

function mapSeverity(severity: unknown): Finding["severity_claim"] {
  const value = String(severity ?? "").toLowerCase();
  if (value === "critical") return "critical";
  if (value === "high") return "high";
  if (value === "low") return "low";
  if (value === "info") return "info";
  if (value.startsWith("cvss:")) return cvssToSeverity(value);
  return "medium";
}

function cvssToSeverity(cvss: string): Finding["severity_claim"] {
  const parts = cvss.replace(/^cvss:\d+\.\d+\//i, "").split("/");
  const vals: Record<string, string> = {};
  for (const p of parts) {
    const [k, v] = p.split(":");
    if (k && v) vals[k.toUpperCase()] = v.toUpperCase();
  }
  const c = vals["C"] ?? "";
  const i = vals["I"] ?? "";
  const a = vals["A"] ?? "";
  const s = vals["S"] ?? "";
  if (s === "C" && (c === "H" || i === "H")) return "critical";
  if (c === "H" || i === "H") return "high";
  if (c === "M" || i === "M" || a === "H") return "medium";
  return "low";
}

function mapExternalStatus(status: unknown): Finding["external_status"] {
  const value = String(status ?? "").toLowerCase();
  if (/verified|confirmed/.test(value)) return "verified";
  if (/reject|false/.test(value)) return "rejected";
  if (/unverified/.test(value)) return "unverified";
  return "unknown";
}

function mapConfidence(confidence: unknown, status: Finding["external_status"]): Finding["confidence"] {
  const value = String(confidence ?? "").toLowerCase();
  if (value === "high" || status === "verified") return "high";
  if (value === "medium") return "medium";
  return "low";
}

function inferMissingChecks(bugClass: Finding["bug_class"]): string[] {
  if (bugClass === "secrets") return ["secret redaction"];
  if (bugClass === "injection") return ["validation", "escaping"];
  if (bugClass === "dependency") return ["runtime reachability"];
  if (bugClass === "crypto") return ["secure configuration"];
  return [];
}

async function writeGhostSkills(repo: string, detection: Awaited<ReturnType<typeof detectGhost>>) {
  await writeJson(agentPath(repo, "integrations", "ghost", "skills.json"), {
    imported_at: nowIso(),
    skills_repo_path: detection.skills_repo_path,
    detected_skills: detection.detected_skills,
    forbidden_skills: detection.forbidden_skills,
    forbidden_external_paths: detection.forbidden_external_paths
  });
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    if (!isAllowedWorkspacePath(candidate)) continue;
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function collectMarkdown(root: string, segment: string): Promise<string[]> {
  const found: string[] = [];
  if (!isAllowedWorkspacePath(root)) return found;
  async function walk(dir: string) {
    try {
      for (const name of await readdir(dir)) {
        const full = path.join(dir, name);
        if (!isAllowedWorkspacePath(full)) continue;
        const s = await stat(full);
        if (s.isDirectory()) await walk(full);
        else if (full.includes(`${path.sep}${segment}${path.sep}`) && /\.md$/i.test(name)) found.push(full);
      }
    } catch {}
  }
  await walk(root);
  return found;
}

function firstHeading(markdown: string): string {
  return markdown.split("\n").find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim() ?? "";
}

async function detectGhostSkills(skillsRepoPath: string) {
  const allowedNames = new Set(["ghost-repo-context", "ghost-scan-code", "ghost-scan-deps", "ghost-scan-secrets", "ghost-report"]);
  const forbiddenNames = new Set(["ghost-validate", "ghost-proxy"]);
  if (!isAllowedWorkspacePath(skillsRepoPath)) return { available: false, skills: [], forbidden: [], reason: "skills path outside allowed workspace roots" };
  const available = await exists(skillsRepoPath);
  if (!available) return { available: false, skills: [], forbidden: [] };
  const skillRoot = path.join(skillsRepoPath, "skills");
  const names: string[] = [];
  const forbidden: string[] = [];
  try {
    for (const dir of await readdir(skillRoot)) {
      const skillPath = path.join(skillRoot, dir, "SKILL.md");
      if (!isAllowedWorkspacePath(skillPath) || !(await exists(skillPath))) continue;
      const body = await readFile(skillPath, "utf8");
      const name = body.match(/^name:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim() ?? dir;
      if (allowedNames.has(name)) names.push(name);
      if (forbiddenNames.has(name)) forbidden.push(name);
    }
  } catch {}
  return { available: true, skills: names.sort(), forbidden: forbidden.sort() };
}

async function scanGhostSkillLeaks(root: string): Promise<{ root: string; scanned_files: number; leaks: Array<{ path: string; line: number; content: string }> }> {
  const leaks: Array<{ path: string; line: number; content: string }> = [];
  let scanned = 0;
  if (!isAllowedWorkspacePath(root) || !(await exists(root))) return { root, scanned_files: scanned, leaks };

  async function walk(dir: string) {
    for (const name of await readdir(dir)) {
      const full = path.join(dir, name);
      if (!isAllowedWorkspacePath(full)) continue;
      const s = await stat(full);
      if (s.isDirectory()) {
        await walk(full);
      } else if (/\.(md|sh|yaml|yml|json|txt)$/i.test(name)) {
        scanned++;
        const body = await readFile(full, "utf8");
        body.split("\n").forEach((line, index) => {
          const forbiddenGhostPath = new RegExp(["~/" + "\\.ghost", "\\$HOME/" + "\\.ghost", "%USER" + "PROFILE%\\\\\\.ghost"].join("|"));
          if (forbiddenGhostPath.test(line)) {
            leaks.push({ path: full, line: index + 1, content: line.slice(0, 240) });
          }
        });
      }
    }
  }

  await walk(root);
  return { root, scanned_files: scanned, leaks };
}
