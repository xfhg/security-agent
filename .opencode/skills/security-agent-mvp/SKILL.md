---
name: security-agent-mvp
description: Run the local-first MVP security-agent pipeline for recon, discovery, harsh triage, and report generation
compatibility: opencode
metadata:
  owner: vulnops
  scope: mvp-security-analysis
---

## Purpose
Run the MVP multi-agent AppSec pipeline against one local repository at a time.

The only implemented stages are:
- recon
- discovery
- triage
- rescore
- report

## Inputs
- `repo`: local target repository path
- optional `stages`: comma-separated subset of `recon,discovery,triage,report`
- optional `bug_classes`: discovery focus list
- Ghost evidence generation plus canonical import is enabled by default in the OpenCode workflow.
- optional `--no-ghost` opt-out flag
- optional `--allow-degraded` flag for research runs only; complete scans must not use it

## Path Contract
- `SECURITY_AGENT_HOME`: this VulnOps control repo root (`${SECURITY_AGENT_HOME}` at runtime)
- `TARGET_REPO`: the value passed as `--repo`
- Run CLI commands from `SECURITY_AGENT_HOME`.
- Write and read pipeline artifacts under `scans/<reponame>/` (not inside the target repo).
- Never infer the target repo from the OpenCode working directory unless the operator explicitly passes this repo as the target.

## Outputs
- `scans/<repo>/kb/*.json`
- `scans/<repo>/findings/raw/*.json`
- `scans/<repo>/findings/normalized/findings.json`
- `scans/<repo>/findings/triaged/findings.json`
- `scans/<repo>/reports/*.md`
- `scans/<repo>/evidence/tool-runs/*`

## Allowed Tools
- local filesystem read/write under `scans/<repo>/`
- git read commands
- OpenGrep CLI
- RTK wrapper for noisy command output
- `codetree` MCP for tree-sitter structure and symbol extraction — scoped to `targets/` (sees ALL repos under `targets/`). **Repo-wide queries** (`get_repository_map`, `search_graph`, `find_hot_paths`, `detect_clones`, `find_dead_code`) MUST read the CLI-produced artifacts from `scans/<repo>/evidence/graph/` — the CLI `recon` stage scopes codetree to TARGET_REPO exactly. **Deep-dive queries** (`get_symbol`, `get_call_graph`, `analyze_dataflow`, `find_references`, `get_file_skeleton`) on specific files/symbols may use the session MCP with the `<reponame>/` path prefix (e.g. `intercept/cmd/sarif.go`). Never call `get_repository_map` or `search_graph` via session MCP — these will see other repos.
- Cognium CLI for semantic SAST using `cognium scan ./src --category security --exclude-tests`
- Semble MCP for targeted semantic code retrieval (MCP-only, not CLI)
- `agent-harness-kit` MCP for task ownership, action logs, acceptance tracking, and handoffs
- safe Ghost skills enabled by default: `ghost-repo-context`, `ghost-scan-code`, `ghost-scan-deps`, `ghost-scan-secrets`, `ghost-report`

## Forbidden Actions
- PoC generation
- exploit payload generation
- live validation
- traffic interception
- ghost-proxy execution
- patch generation
- patch validation
- AutoFix
- Docker sanitizer execution
- destructive testing
- **Writing gate artifacts manually** — the CLI's `runCoverageGates()` produces all `evidence/tool-gates/*.json` artifacts via `probeMcpGate` and `probeCommandGate`. Do not hand-write blocker gate artifacts. If the CLI blocks a gate, record the CLI's blocker reason and stop.

## Workflow
1. Set `TARGET_REPO` from the operator argument.
2. Use the `agent-harness-kit` MCP before shell execution for operator-visible ownership. The CLI also writes task/action/tool/file/acceptance state directly to `.harness/harness.db`, which is the authoritative AHK store.
3. Claim and close the matching harness task for each critical external tool gate: `mcp-filesystem`, `mcp-codetree`, `mcp-gitnexus`, `ahk`, `tool-gitnexus`, `tool-opengrep`, `tool-cognium`, `ghost-repo-context`, `ghost-deps`, `ghost-secrets`, `ghost-scan-code`, and `ghost-report`.
4. Run `node --experimental-strip-types ./src/cli.ts init --repo "$TARGET_REPO"`.
5. Run `node --experimental-strip-types ./src/cli.ts doctor --repo "$TARGET_REPO"` and `node --experimental-strip-types ./src/cli.ts toolchain verify`.
6. Run `recon` via the CLI to produce scoped codeTree structure: `node --experimental-strip-types ./src/cli.ts run --repo "$TARGET_REPO" --stages recon`. This produces all recon artifacts including `codetree-structure.json`, security symbol scans, entrypoint skeletons, and hot-path analysis under `scans/<repo>/evidence/graph/`. Read these baseline artifacts first. Use codetree MCP directly (with `<reponame>/` path prefix) for deep-dive queries during discovery and triage.
7. Run safe Ghost workflows against `TARGET_REPO`. Each Ghost skill REQUIRES `repo_path` — pass it explicitly (e.g. `ghost-scan-deps repo_path=targets/intercept`). All Ghost output goes to `scans/<reponame>/evidence/ghost/`. Run: `ghost-repo-context`, `ghost-scan-deps`, `ghost-scan-secrets`, `ghost-scan-code` (skip if OpenGrep+Cognium both ran), and `ghost-report`.
8. Run `node --experimental-strip-types ./src/cli.ts run --repo "$TARGET_REPO" --stages recon,discovery,triage`. Rescore auto-triggers after triage, followed by auto-report.
9. If this returns `coverage_incomplete`, stop and report `evidence/tool-gates/summary.json`. Do not call the scan complete.
10. Read only `scans/<repo>/kb/*` and `scans/<repo>/evidence/graph/*` for recon context.
11. Record action output with AHK action records, mark each verified acceptance criterion after artifact verification, and mark a task `done` only after acceptance artifacts exist. `done` with unmet acceptance is invalid and must be converted to `blocked`.
12. Review `scans/<repo>/security/executive-summary.md`, `scans/<repo>/security/triage-report.md`, `scans/<repo>/review/rescore-report.md`, and `scans/<repo>/review/checklist.md`.

Ghost defaults:
- `/security-agent-run` actively invokes safe Ghost workflows first.
- Recon imports generated Ghost repo context when available.
- Discovery imports generated Ghost code/deps/secrets findings when available.
- Triage imports/reconciles Ghost findings by default.
- Report emits Ghost summary by default.
- Use `--no-ghost` only when intentionally disabling Ghost evidence.
- Default runs are strict. Use `--allow-degraded` only for development, and label the result `coverage_incomplete`.
- `ghost-validate` and `ghost-proxy` remain forbidden in the MVP.

## Context Discipline
- Do not read whole target source files into context during recon.
- Use the CLI's `recon` stage to produce baseline codetree artifacts; during discovery and triage, use codetree MCP **only** for deep-dive on specific symbols/files (with `<reponame>/` path prefix).
- Never call `get_repository_map` or `search_graph` via session MCP — these scan all of `targets/`, not just TARGET_REPO. Read `scans/<repo>/evidence/graph/codetree-structure.json` instead.
- Semble MCP can be used directly for targeted semantic retrieval during all phases.
- GitNexus MCP can be used directly for graph/call-chain/execution-flow context during all phases.
- Never let codeTree scan the control repo as the analysis target; scope paths to explicit `TARGET_REPO` values, normally under `targets/<reponame>`.
- **Target boundary**: TARGET_REPO is the ONLY repo being analyzed. Do not read files from other directories under `targets/`. Ghost skills must run against the explicit TARGET_REPO path, never default to `$(pwd)`.
- Read targeted snippets only when a finding references a file and line.
- Prefer `scans/<repo>/kb/repo-map.json`, `scans/<repo>/kb/entrypoints.json`, `scans/<repo>/kb/supporting-tools.json`, and `scans/<repo>/evidence/graph/*.json` over source browsing.

## Artifact Contract
Every claim must cite a deterministic artifact path. Raw outputs are immutable evidence. Normalized and triaged findings are canonical.

## Failure Modes
- Discovery fails if recon has not run.
- Triage fails if discovery has not produced normalized findings.
- Report fails if triage has not run, unless `--partial` is explicit.
- Optional-only tools produce unavailable artifacts and warnings. Required complete-scan gates block the native pipeline.
- Complete runs block on required coverage gates. Degraded runs may continue only with explicit `--allow-degraded`.
- Harness task failure is not silent: if codeTree, GitNexus, Ghost, OpenGrep, or Cognium cannot run, the claimed task must record a blocker and the target `scans/<repo>/` artifact must show unavailable status.
- A task cannot be considered audit-clean unless its acceptance criteria are marked met in AHK after artifact verification.

## Acceptance Criteria
- `security-agent run --repo <repo> --stages recon,discovery,triage` produces a KB, normalized findings, triaged findings, and `reports/mvp-summary.md`.
- No default path performs PoC, live validation, proxying, patching, or exploit replay.
