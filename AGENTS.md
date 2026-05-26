# VulnOps Security-Agent Workspace

## Operating posture
Be formal, direct, skeptical, and evidence-driven. Do not flatter the operator. Challenge weak assumptions and scanner output. Prioritize pragmatic security work that produces auditable artifacts.

Use RTK for shell output reduction when running noisy commands:

```bash
rtk <command>
```

## Default workflow
When OpenCode starts in this repository, treat the local security-agent MVP as the primary workflow for repository security analysis.

Path contract:
- `SECURITY_AGENT_HOME` is this repository root (`${SECURITY_AGENT_HOME}` at runtime).
- `TARGET_REPO` is the repository being analyzed and must be passed explicitly to every `security-agent` command.
- OpenCode starts in `SECURITY_AGENT_HOME`; the CLI writes artifacts under `scans/<reponame>/` (never inside the target repo).
- **Target boundary**: `TARGET_REPO` is the ONLY repo under analysis. Do not read files from other directories under `targets/`. Keep one target repo under `targets/` at a time.
- MCP tools rooted at `SECURITY_AGENT_HOME`. The `codetree` MCP is scoped to `targets/` — it sees all repos under `targets/`. **Repo-wide queries** (`get_repository_map`, `search_graph`, `find_hot_paths`, `detect_clones`, `find_dead_code`) MUST read CLI-produced artifacts from `scans/<reponame>/evidence/graph/` — the CLI `recon` stage scopes to TARGET_REPO exactly. **Deep-dive queries** (`get_symbol`, `get_call_graph`, `analyze_dataflow`, `find_references`, `get_file_skeleton`) may use session MCP with `<reponame>/` prefix. Never call `get_repository_map` via session MCP — it will mix repos.
- Ghost skills must run against the explicit `TARGET_REPO` path, never default to `$(pwd)`. All Ghost output goes to `scans/<reponame>/evidence/ghost/`. No intermediate caches outside `scans/`.
- Use GitNexus MCP for graph/call-chain/execution-flow context during all phases.
- Use Semble MCP for targeted semantic retrieval during all phases.
- Do not read or import from the global Ghost home or any path outside `SECURITY_AGENT_HOME`, except `/tmp` fixtures. Ghost evidence must be local target evidence under `scans/<reponame>/evidence/ghost/`.
- Use contained launchers from `bins/shims/*`; do not call package runners or globally installed scanner/graph tools directly.
- Run `security-agent doctor --repo <target>` before relying on Ghost or external-tool evidence.
- Run `security-agent toolchain verify` before calling a scan portable or complete.
- Default `security-agent run` is strict. If required gates fail, report `coverage_incomplete` and stop. Use `--allow-degraded` only for development/research runs.

Load and follow:
- `.opencode/skills/security-agent-mvp/SKILL.md`
- `.opencode/agents/security-agent-lead.md`
- `docs/security-agent-workflow.md`
- `docs/security-agent-flow.md`
- `OPERATIONMANUAL.md`

Use the OpenCode commands:
- `/security-agent-init <repo>`
- `/security-agent-run <repo> [stages]`
- `/security-agent-ghost <repo>`
- `/security-agent-recon <repo>`
- `/security-agent-discovery <repo>`
- `/security-agent-triage <repo>`
- `/security-agent-report <repo>`
- `/security-agent-doctor <repo>`

## Hard scope boundary
The MVP includes only:
- recon
- discovery
- triage
- rescore
- reporting

Ghost evidence is enabled by default:
- use local Ghost skills from `ghost/skills/plugins/ghost`
- actively run `ghost-repo-context`, `ghost-scan-deps`, `ghost-scan-secrets`, `ghost-scan-code`, and `ghost-report` during the complete `/security-agent-run` workflow
- import repo context, code findings, dependency findings, secrets findings, and Ghost report evidence from `scans/<reponame>/evidence/ghost/` into canonical artifacts
- canonical `scans/<reponame>/` artifacts remain source of truth

Harness is mandatory:
- `agent-harness-kit` is configured in `agent-harness-kit.config.ts`
- tasks are seeded in `.harness/feature_list.json`
- OpenCode has an `agent-harness-kit` MCP server
- agents must claim/update harness tasks before phase work
- every operator request that starts, resumes, changes, or reviews a target workflow must begin with `tasks.get('in_progress')` and `tasks.get('pending')`
- every critical external tool has a harness task gate: codeTree, GitNexus, Ghost, OpenGrep, and Cognium
- complete scans require `scans/<reponame>/evidence/tool-gates/<gate>.json` for every required gate and `scans/<reponame>/evidence/coverage-status.json`
- do not mark a tool task done until its raw/intermediary artifact exists or a blocker artifact explains why the tool could not run
- after verifying each acceptance criterion, call `tasks.acceptance.update(criterionId)`; `tasks.update(taskId, 'done')` without acceptance updates is not sufficient

Recon tool order:
- the CLI's `recon` stage starts codeTree with `--root TARGET_REPO` and writes `scans/<reponame>/evidence/graph/codetree-structure.json` — read that baseline artifact first.
- use codetree MCP for deep-dive queries on specific files/symbols during discovery and triage (prepend `<reponame>/` to all file paths)
- use GitNexus MCP for graph/call-chain/execution-flow context
- only then read targeted source snippets referenced by artifacts

Forbidden by default:
- PoC generation
- live validation
- traffic interception
- Ghost proxy
- patch generation
- patch validation
- AutoFix
- destructive testing
- production target interaction

## Key report artifacts
After a complete `/security-agent-run`, review:
- `scans/<reponame>/security/executive-summary.md` — executive summary with findings table and top risks
- `scans/<reponame>/security/triage-report.md` — full triage queue with per-finding detail (IDs, file:line, bug class, severity, evidence, human checks)
- `scans/<reponame>/security/detailed-report.md` — comprehensive per-finding detail with every triage field, findings-by-source breakdown, and evidence artifact index
- `scans/<reponame>/security/ghost-findings.md` — Ghost findings with reconciliation status and artifact paths
- `scans/<reponame>/review/rescore-report.md` — post-triage rescore decisions (auto-runs after triage)
- `scans/<reponame>/review/checklist.md` — aggregated human review checklist

Operational workflow reports (toolchain, stage summaries) are under `scans/<reponame>/workflow/`.

## Evidence rules
Every claim needs provenance. Prefer deterministic artifacts under `scans/<reponame>/` over conversational claims. Treat Ghost findings and scanner results as evidence, not truth.

Do not bulk-read target source files during recon. First run the workflow to produce `scans/<reponame>/kb/*` and `scans/<reponame>/evidence/graph/*`, then read those artifacts.

Reports must start from the recorded scan status. `coverage_incomplete` is not a successful complete scan.
