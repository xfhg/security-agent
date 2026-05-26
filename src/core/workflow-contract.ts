import type { AhkTaskSpec } from "../harness/ahk-runtime-adapter.ts";

export const stageTaskSpecs: Record<string, AhkTaskSpec> = {
  init: {
    slug: "target-workspace-init",
    title: "Initialize target security-agent workspace",
    description: "Create target scan workspace and record AHK status.",
    acceptance: [
      "config/target.json exists",
      "config/tools.json records Ghost enabled by default",
      "evidence/agent-harness-kit.json records AHK status"
    ]
  },
  doctor: {
    slug: "toolchain-containment-preflight",
    title: "Run contained toolchain preflight",
    description: "Verify active workflow tools, Ghost binaries, MCP launchers, caches, and templates are contained.",
    acceptance: [
      "evidence/containment-doctor.json exists",
      "workflow/containment-doctor.md exists"
    ]
  },
  recon: {
    slug: "recon-prepare-tools",
    title: "Run native recon with supporting tools",
    description: "Build KB artifacts and supporting graph/retrieval evidence before source-level analysis.",
    acceptance: [
      "kb/supporting-tools.json exists",
      "evidence/graph/codetree-structure.json exists",
      "kb/repo-map.json exists",
      "kb/entrypoints.json exists",
      "workflow/recon-summary.md exists"
    ]
  },
  discovery: {
    slug: "native-discovery-import",
    title: "Run native discovery and import Ghost evidence",
    description: "Run SAST, focused discovery agents, and Ghost imports into canonical findings.",
    acceptance: [
      "findings/normalized/findings.json exists",
      "findings/normalized/ghost-code-findings.json exists",
      "findings/normalized/ghost-deps-findings.json exists",
      "findings/normalized/ghost-secrets-findings.json exists",
      "workflow/discovery-summary.md exists"
    ]
  },
  triage: {
    slug: "triage-reconcile",
    title: "Run triage and reconcile native plus Ghost findings",
    description: "Dedup, score, challenge, vote, and reconcile Ghost/native evidence.",
    acceptance: [
      "findings/triaged/findings.json exists",
      "security/triage-report.md exists"
    ]
  },
  rescore: {
    slug: "rescore-needs-review",
    title: "Rescore needs-human-review findings with full KB context",
    description: "Apply Ghost evidence, entrypoint proximity, noise detection, and path heuristics to rescore findings needing human review.",
    acceptance: [
      "review/rescore-report.md exists"
    ]
  },
  report: {
    slug: "ghost-and-mvp-report",
    title: "Generate final MVP and Ghost summaries",
    description: "Generate final operator reports after triage.",
    acceptance: [
      "security/executive-summary.md exists"
    ]
  }
};

export const gateTaskSpecs: Record<string, AhkTaskSpec> = {
  "mcp-filesystem": gate("mcp-filesystem", "filesystem MCP JSON-RPC initialize succeeds"),
  ahk: gate("ahk", "AHK sync/status succeeds"),
  "mcp-codetree": gate("mcp-codetree", "codeTree MCP JSON-RPC initialize succeeds"),
  "mcp-gitnexus": gate("mcp-gitnexus", "GitNexus MCP JSON-RPC initialize succeeds"),
  "tool-gitnexus": gate("tool-gitnexus", "GitNexus contained command is available"),
  "tool-semble": gate("tool-semble", "Semble contained command is available"),
  "tool-opengrep": gate("tool-opengrep", "OpenGrep contained command is available"),
  "tool-cognium": gate("tool-cognium", "Cognium contained command is available"),
  "ghost-repo-context": gate("ghost-repo-context", "Ghost repo context evidence exists"),
  "ghost-deps": gate("ghost-deps", "Ghost dependency scan evidence exists"),
  "ghost-secrets": gate("ghost-secrets", "Ghost secrets scan evidence exists"),
  "ghost-scan-code": gate("ghost-scan-code", "Ghost code scan evidence exists"),
  "ghost-report": gate("ghost-report", "Ghost report evidence exists")
};

function gate(name: string, criterion: string): AhkTaskSpec {
  return {
    slug: `gate-${name}`,
    title: `Coverage gate: ${name}`,
    description: `Mandatory complete-scan gate for ${name}.`,
    acceptance: [
      `evidence/tool-gates/${name}.json exists`,
      criterion
    ]
  };
}
