import { writeFile } from "node:fs/promises";
import { writeJson, writeStageLog } from "../core/artifact-writer.ts";
import { agentPath, binPath, ensureControlPlaneDirs, ensureWorkspaceDirs, securityAgentHome } from "../core/paths.ts";
import { baseEnvelope, repoCommit } from "../core/provenance.ts";
import { detectAgentHarnessKit } from "../adapters/agent-harness-kit.ts";
import { DEFAULT_GHOST_SKILLS_REPO_PATH } from "../adapters/ghost.ts";
import { AhkRuntimeAdapter } from "../harness/ahk-runtime-adapter.ts";
import { gateTaskSpecs, stageTaskSpecs } from "../core/workflow-contract.ts";

export async function initStage(repo: string): Promise<void> {
  await ensureControlPlaneDirs();
  await ensureWorkspaceDirs(repo);
  const harness = new AhkRuntimeAdapter();
  harness.resetForNewScan();
  const initTask = harness.ensureTask(stageTaskSpecs.init);
  harness.claim(initTask);
  const actionId = harness.startAction(initTask);
  const commit = await repoCommit(repo);
  await writeJson(agentPath(repo, "config", "project.json"), { ...(await baseEnvelope(repo, "project-config", "security-agent-init")), name: "security-agent-target", repo_path: repo, repo_commit: commit, initialized: true });
  await writeJson(agentPath(repo, "config", "target.json"), { ...(await baseEnvelope(repo, "target-config", "security-agent-init")), security_agent_home: securityAgentHome(), target_repo: repo, target_repo_commit: commit, contract: "OpenCode runs in security-agent home; CLI stages operate on target_repo and write artifacts under scans/<project>/" });
  await writeJson(agentPath(repo, "config", "tools.json"), {
    ...(await baseEnvelope(repo, "tools-config", "security-agent-init")),
    opengrep: { required: true, command: `${binPath("shims", "opengrep")} scan --json --quiet <repo>` },
    rtk: { required: false, command: "rtk <command>" },
    ghost: { enabled: true, mode: "local-artifact-import-only", skills_repo_path: DEFAULT_GHOST_SKILLS_REPO_PATH, ghost_home: ".local/ghost", bins_dir: "bins/ghost", evidence_dir: "evidence/ghost", import_markdown_findings: true, normalize_to_canonical_schema: true, allow_live_validation: false, allow_proxy: false, default_in_complete_workflow: true, forbidden_external_paths: ["global-user-ghost-home"] }
  });
  await writeJson(agentPath(repo, "config", "agents.json"), { ...(await baseEnvelope(repo, "agents-config", "security-agent-init")), agents: ["repo-cartographer-agent", "dependency-agent", "entrypoint-agent", "graph-agent", "threat-model-agent", "opengrep-sast-agent", "semantic-sast-agent", "secrets-config-agent", "sensitive-exposure-agent", "injection-agent", "authz-authn-agent", "deserialization-parser-agent", "crypto-agent", "dependency-risk-agent", "business-logic-agent", "dedup-agent", "reachability-agent", "exploitability-agent", "impact-agent", "false-positive-agent", "severity-panel-agent", "ghost-status-reconciliation-agent", "report-agent"] });
  await writeJson(agentPath(repo, "config", "skills.json"), { ...(await baseEnvelope(repo, "skills-config", "security-agent-init")), skills: ["skill-repo-recon", "skill-build-repo-map", "skill-build-code-graph", "skill-run-sast", "skill-find-injection", "skill-find-authz", "skill-find-secrets-config", "skill-find-sensitive-exposure", "skill-find-crypto", "skill-find-dependency-risk", "skill-triage-findings", "skill-generate-report", "skill-import-ghost-context", "skill-import-ghost-findings"] });
  await writeFile(agentPath(repo, "config", "triage-policy.yaml"), defaultPolicy(), "utf8");
  for (const spec of Object.values(stageTaskSpecs)) harness.ensureTask(spec);
  for (const spec of Object.values(gateTaskSpecs)) harness.ensureTask(spec);
  await detectAgentHarnessKit(repo);
  await writeStageLog(repo, "init", "workspace initialized");
  harness.writeSection(actionId, "result", "target workspace initialized and AHK task backlog seeded");
  harness.recordFile(actionId, "scans/targets_intercept/config/target.json", "created", "target path contract");
  harness.recordFile(actionId, "scans/targets_intercept/evidence/agent-harness-kit.json", "created", "AHK sync/status evidence");
  harness.completeAction(actionId, "init completed");
  await harness.completeTaskWithArtifacts(initTask, [
    agentPath(repo, "config", "target.json"),
    agentPath(repo, "config", "tools.json"),
    agentPath(repo, "evidence", "agent-harness-kit.json")
  ], "init completed");
  harness.close();
}

function defaultPolicy(): string {
  return `p0:
  - confirmed reachable RCE
  - confirmed auth bypass/account takeover
  - confirmed tenant isolation break
  - confirmed exposed production secret with meaningful privilege
p1:
  - likely reachable injection
  - likely serious authz issue
  - high-confidence sensitive data exposure
p2:
  - medium-confidence reachable vulnerability
  - dependency issue with plausible but unconfirmed reachability
p3:
  - low-confidence vulnerability hypothesis
  - Ghost-verified but native reachability unknown
p4:
  - informational
  - hardening
  - test-only issues
false_positive_rules:
  - generated files default downgrade unless executed
  - missing validation is not enough without source sink and trust boundary
  - Ghost verification is not enough without native agreement
forbidden_mvp:
  - poc_generation
  - live_validation
  - traffic_interception
  - patch_generation
`;
}
