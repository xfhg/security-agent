import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentPath, binPath, ensureControlPlaneDirs, ensureWorkspaceDirs, platformArch, securityAgentHome } from "../core/paths.ts";
import { writeJson, writeStageLog } from "../core/artifact-writer.ts";
import { nowIso, repoCommit } from "../core/provenance.ts";
import { executable } from "../core/toolchain.ts";

const forbiddenPathPattern = new RegExp([
  "~/" + "\\.ghost",
  "\\$HOME/" + "\\.ghost",
  "/Users/[^/\\s]+/\\.(?:bun|npm|cache|local|ghost)",
  "%USER" + "PROFILE%\\\\\\.ghost"
].join("|"));
const bareLauncherPattern = new RegExp(`"command"\\s*:\\s*\\[\\s*"(${["n" + "px", "u" + "vx", "gitnexus", "opengrep", "cognium", "codetree", "semble"].join("|")})"`);

export async function doctorStage(repo: string): Promise<void> {
  await ensureControlPlaneDirs();
  await ensureWorkspaceDirs(repo);

  const issues: Array<{ severity: "error" | "warning"; category: string; message: string; path?: string; line?: number }> = [];
  const ghostBins = [];
  const platform = platformArch();
  for (const name of ["wraith", "osv-scanner", "poltergeist"]) {
    const file = binPath("ghost", platform, name);
    const ok = await executable(file);
    ghostBins.push({ platform, name, path: file, executable: ok });
    if (!ok) issues.push({ severity: "error", category: "ghost-binary", message: `missing executable ${name} for ${platform}`, path: file });
  }

  const opencodeBins = [];
  const opencodeFile = binPath("opencode", platform, "opencode");
  const ok = await executable(opencodeFile);
  opencodeBins.push({ platform, path: opencodeFile, executable: ok });
  if (!ok) issues.push({ severity: "warning", category: "opencode-binary", message: `vendored opencode missing for ${platform}`, path: opencodeFile });

  for (const file of [
    path.join(securityAgentHome(), "opencode.jsonc"),
    path.join(securityAgentHome(), "AGENTS.md"),
    path.join(securityAgentHome(), "OPERATIONMANUAL.md"),
    path.join(securityAgentHome(), "docs", "security-agent-workflow.md"),
    path.join(securityAgentHome(), "docs", "security-agent-flow.md"),
    path.join(securityAgentHome(), ".opencode", "skills", "security-agent-mvp", "SKILL.md"),
    path.join(securityAgentHome(), ".opencode", "agents", "security-agent-lead.md"),
    path.join(securityAgentHome(), ".opencode", "commands", "security-agent-run.md")
  ]) {
    await scanFile(file, issues, true);
  }

  await scanTree(path.join(securityAgentHome(), "ghost", "skills", "plugins", "ghost"), issues);
  await scanTree(agentPath(repo), issues);

  const artifact = {
    status: issues.some((issue) => issue.severity === "error") ? "failed" : issues.length ? "warning" : "passed",
    checked_at: nowIso(),
    repo_commit: await repoCommit(repo),
    security_agent_home: securityAgentHome(),
    allowed_roots: [securityAgentHome(), "/tmp"],
    local_roots: {
      ghost_home: ".local/ghost",
      cache_home: ".local/cache",
      opencode_state: ".local/state/opencode",
      bins: "bins"
    },
    current_platform: platformArch(),
    ghost_binaries: ghostBins,
    opencode_binaries: opencodeBins,
    issues
  };

  await writeJson(agentPath(repo, "evidence", "containment-doctor.json"), artifact);
  await writeFile(agentPath(repo, "workflow", "containment-doctor.md"), renderDoctor(artifact), "utf8");
  await writeStageLog(repo, "doctor", `containment doctor ${artifact.status} with ${issues.length} issue(s)`);
  if (artifact.status === "failed") throw new Error(`containment doctor failed with ${issues.filter((issue) => issue.severity === "error").length} error(s)`);
}

async function scanTree(root: string, issues: Array<{ severity: "error" | "warning"; category: string; message: string; path?: string; line?: number }>) {
  async function walk(dir: string) {
    for (const name of await readdir(dir)) {
      const full = path.join(dir, name);
      const s = await stat(full);
      if (s.isDirectory()) await walk(full);
      else if (/\.(md|sh|yaml|yml|json|txt|jsonc)$/i.test(name)) await scanFile(full, issues, false);
    }
  }
  try {
    await walk(root);
  } catch {}
}

async function scanFile(file: string, issues: Array<{ severity: "error" | "warning"; category: string; message: string; path?: string; line?: number }>, checkLaunchers: boolean) {
  let body = "";
  try {
    body = await readFile(file, "utf8");
  } catch {
    return;
  }
  body.split("\n").forEach((line, index) => {
    if (forbiddenPathPattern.test(line)) issues.push({ severity: "error", category: "forbidden-path", message: "forbidden global/user path reference", path: file, line: index + 1 });
    if (checkLaunchers && bareLauncherPattern.test(line)) issues.push({ severity: "error", category: "bare-launcher", message: "active config uses a bare global launcher instead of a local shim", path: file, line: index + 1 });
  });
}

function renderDoctor(artifact: any): string {
  return `# Containment Doctor

- Status: ${artifact.status}
- Current platform: ${artifact.current_platform}
- Security agent home: ${artifact.security_agent_home}
- Ghost home: ${artifact.local_roots.ghost_home}
- Issues: ${artifact.issues.length}

## Issues
${artifact.issues.map((issue: any) => `- ${issue.severity.toUpperCase()} ${issue.category}: ${issue.message}${issue.path ? ` (${issue.path}${issue.line ? `:${issue.line}` : ""})` : ""}`).join("\n") || "- none"}

## Ghost Binaries
${artifact.ghost_binaries.map((bin: any) => `- ${bin.platform}/${bin.name}: ${bin.executable ? "ok" : "missing"} (${bin.path})`).join("\n")}

## OpenCode Binaries
${artifact.opencode_binaries.map((bin: any) => `- ${bin.platform}: ${bin.executable ? "ok" : "missing"} (${bin.path})`).join("\n")}
`;
}
