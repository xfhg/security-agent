import { writeStageLog } from "./artifact-writer.ts";
import { agentPath, requireInitialized } from "./paths.ts";
import { AhkRuntimeAdapter } from "../harness/ahk-runtime-adapter.ts";
import { stageTaskSpecs } from "./workflow-contract.ts";

export async function runStage(repo: string, stage: string, fn: () => Promise<void>, requireInit = true): Promise<void> {
  if (requireInit) await requireInitialized(repo);
  if (requireInit) await writeStageLog(repo, stage, "stage started");
  const harness = requireInit ? new AhkRuntimeAdapter() : null;
  const spec = stageTaskSpecs[stage];
  const taskId = harness && spec ? harness.ensureTask(spec) : null;
  if (harness && taskId) harness.claim(taskId);
  const actionId = harness && taskId ? harness.startAction(taskId) : null;
  try {
    await fn();
    if (harness && taskId && actionId) {
      harness.writeSection(actionId, "result", `${stage} completed`);
      harness.recordFile(actionId, `scans/<repo>/logs/${stage}.log`, "created", "stage log");
      harness.completeAction(actionId, `${stage} completed`);
      await harness.completeTaskWithArtifacts(taskId, stageArtifacts(repo, stage), `${stage} completed`);
    }
    await writeStageLog(repo, stage, "stage completed");
  } catch (error) {
    if (harness && taskId && actionId) {
      const message = error instanceof Error ? error.message : String(error);
      harness.writeSection(actionId, "blockers", message);
      harness.completeAction(actionId, message, "blocked");
      harness.blockTask(taskId, message);
    }
    if (requireInit) await writeStageLog(repo, stage, `stage failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    harness?.close();
  }
}

function stageArtifacts(repo: string, stage: string): string[] {
  const artifacts: Record<string, string[]> = {
    doctor: ["evidence/containment-doctor.json", "workflow/containment-doctor.md"],
    recon: ["kb/supporting-tools.json", "evidence/graph/codetree-structure.json", "kb/repo-map.json", "kb/entrypoints.json", "workflow/recon-summary.md"],
    discovery: ["findings/normalized/findings.json", "findings/normalized/ghost-code-findings.json", "findings/normalized/ghost-deps-findings.json", "findings/normalized/ghost-secrets-findings.json", "workflow/discovery-summary.md"],
    triage: ["findings/triaged/findings.json", "security/triage-report.md"],
    rescore: ["review/rescore-report.md"],
    report: ["security/executive-summary.md"]
  };
  return (artifacts[stage] ?? [`logs/${stage}.log`]).map((artifact) => agentPath(repo, artifact));
}
