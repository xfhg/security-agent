#!/usr/bin/env -S node --experimental-strip-types
import { initStage } from "./stages/init.ts";
import { reconStage } from "./stages/recon.ts";
import { discoveryStage } from "./stages/discovery.ts";
import { triageStage } from "./stages/triage.ts";
import { reportStage } from "./stages/report.ts";
import { rescoreStage } from "./stages/rescore.ts";
import { doctorStage } from "./stages/doctor.ts";
import { bundleToolchain, verifyToolchain } from "./stages/toolchain.ts";
import { runStage } from "./core/stage-runner.ts";
import { runCoverageGates, runMcpDoctor } from "./core/coverage-gates.ts";

type Args = Record<string, string | boolean>;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  const args = parseArgs(rest);
  const repo = typeof args.repo === "string" ? args.repo : ".";
  try {
    switch (command) {
      case "init":
        await runStage(repo, "init", () => initStage(repo), false);
        break;
      case "recon":
        await runStage(repo, "recon", () => reconStage(repo, { importGhostContext: !Boolean(args["no-ghost"]) || Boolean(args["import-ghost-context"]), prepareTools: Boolean(args["prepare-tools"]) }));
        break;
      case "discovery":
        await runStage(repo, "discovery", () => discoveryStage(repo, { useGhost: !Boolean(args["no-ghost"]) || Boolean(args["use-ghost"]), bugClasses: csv(args["bug-classes"]) }));
        break;
      case "triage":
        await runStage(repo, "triage", () => triageStage(repo, { importGhostFindings: !Boolean(args["no-ghost"]) || Boolean(args["import-ghost-findings"]) }));
        break;
      case "report":
        await runStage(repo, "report", () => reportStage(repo, { includeGhostEvidence: !Boolean(args["no-ghost"]) || Boolean(args["include-ghost-evidence"]), partial: Boolean(args.partial) }));
        break;
      case "rescore":
        await runStage(repo, "rescore", () => rescoreStage(repo));
        break;
      case "doctor":
        await runStage(repo, "doctor", () => doctorStage(repo), false);
        break;
      case "run":
        await runPipeline(repo, csv(args.stages) ?? ["recon", "discovery", "triage"], !Boolean(args["no-prepare-tools"]), !Boolean(args["no-ghost"]), Boolean(args["allow-degraded"]));
        break;
      case "toolchain":
        if (rest[0] === "verify") {
          const lock = await verifyToolchain();
          console.log(JSON.stringify({ portable: lock.portable, blockers: lock.blockers }, null, 2));
        } else if (rest[0] === "bundle") {
          const bundle = await bundleToolchain();
          console.log(JSON.stringify(bundle, null, 2));
        } else {
          throw new Error("toolchain requires subcommand: verify | bundle");
        }
        break;
      case "mcp":
        if (rest[0] === "doctor") {
          await initStage(repo);
          await runMcpDoctor(repo);
        } else {
          throw new Error("mcp requires subcommand: doctor --repo <path>");
        }
        break;
      case "prove":
      case "patch":
      case "patch-validate":
      case "autofix":
      case "docker-sanitize":
      case "ghost-proxy":
        throw new Error(`${command} is not_implemented_for_mvp. No PoC, live validation, traffic interception, or patching is allowed in this MVP.`);
      default:
        printHelp();
        process.exit(command ? 1 : 0);
    }
    console.log(`security-agent ${command} completed for ${repo}`);
  } catch (error) {
    console.error(`security-agent ${command ?? ""} failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function runPipeline(repo: string, stages: string[], prepareTools = false, useGhost = true, allowDegraded = false) {
  await runStage(repo, "init", () => initStage(repo), false);
  await runStage(repo, "doctor", () => doctorStage(repo), false);
  await runCoverageGates(repo, { allowDegraded });
  for (const stage of stages) {
    if (stage === "recon") await runStage(repo, "recon", () => reconStage(repo, { prepareTools, importGhostContext: useGhost }));
    else if (stage === "discovery") await runStage(repo, "discovery", () => discoveryStage(repo, { useGhost }));
    else if (stage === "triage") await runStage(repo, "triage", () => triageStage(repo, { importGhostFindings: useGhost }));
    else if (stage === "rescore") await runStage(repo, "rescore", () => rescoreStage(repo));
    else if (stage === "report") await runStage(repo, "report", () => reportStage(repo, { includeGhostEvidence: useGhost }));
    else if (stage !== "init") throw new Error(`unknown stage: ${stage}`);
  }
  if (stages.includes("triage") && !stages.includes("rescore")) await runStage(repo, "rescore", () => rescoreStage(repo));
  if (!stages.includes("report") && stages.includes("triage")) await runStage(repo, "report", () => reportStage(repo, { includeGhostEvidence: useGhost }));
}

function parseArgs(args: string[]): Args {
  const parsed: Args = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}

function csv(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function printHelp() {
  console.log(`security-agent

Commands:
  init --repo <path>
  recon --repo <path> [--prepare-tools] [--no-ghost]
  discovery --repo <path> [--bug-classes injection,authz,secrets,crypto] [--no-ghost]
  triage --repo <path> [--no-ghost]
  report --repo <path> [--partial] [--no-ghost]
  rescore --repo <path>
  doctor --repo <path>
  run --repo <path> --stages recon,discovery,triage [--no-prepare-tools] [--no-ghost] [--allow-degraded]
  toolchain verify
  toolchain bundle
  mcp doctor --repo <path>

Ghost canonical import is enabled by default. OpenCode /security-agent-run executes safe Ghost skills before this CLI imports their artifacts. Use --no-ghost to opt out.

MVP-forbidden stubs:
  prove, patch, patch-validate, autofix, docker-sanitize, ghost-proxy
`);
}

await main();
