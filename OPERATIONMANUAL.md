# Security-Agent Operation Manual

## 1. Starting Position

You are in the security-agent control repo:

```bash
cd <vulnops-root>
export SECURITY_AGENT_HOME="$PWD"
```

Target repositories live under:

```text
targets/<reponame>
```

Filesystem boundary:

- Allowed roots are this VulnOps workspace and `/tmp` for fixtures.
- Do not read or import from the global Ghost home.
- Ghost artifacts must be generated or mirrored under `scans/<reponame>/evidence/ghost/` before native import.

The path contract is non-negotiable:

- `SECURITY_AGENT_HOME` is this folder.
- `TARGET_REPO` is the repo being analyzed.
- OpenCode runs from `SECURITY_AGENT_HOME`.
- The pipeline writes artifacts under `scans/<reponame>/`.
- Do not bulk-read the target source into chat. Produce recon artifacts first.

### Offline Mode

This security-agent toolkit runs primarily offline. The offline tarball includes vendored binaries, Python runtimes, and pre-built `node_modules` — no network calls during scans.

**Before going fully offline, run once while online:**

```bash
bash scripts/offline-bootstrap.sh
```

This downloads the OSV vulnerability database for Ghost SCA scans (`wraith download-db`). Without this, dependency scans will return zero findings.

**What works offline:**
- All native scanners: Cognium, OpenGrep, poltergeist (secrets), codetree, semble, GitNexus
- All Ghost skills: repo-context, scan-code, scan-secrets, report
- Ghost scan-deps: after one-time `wraith download-db`
- Full pipeline: recon → discovery → triage → rescore → report

**What needs network (one-time):**
- `scripts/offline-bootstrap.sh` — pre-downloads wraith DB
- `npm install` — only needed if `node_modules/` is not vendored in the offline tarball
- `uv venv / pip install codetree` — only needed if `.local/` is not vendored in the offline tarball

**Offline limitations:**
- Ghost SCA scans return zero findings without pre-downloaded OSV database
- OpenCode may log a benign warning about unreachable update checks (ignored)
- No GitHub advisory lookups during analysis; CVE data comes from local DB only

## 2. Clone A Target Repo

From this folder:

```bash
mkdir -p targets
git clone <repo-url> targets/<reponame>
```

Set a shell variable if running raw CLI commands:

```bash
export TARGET_REPO="$PWD/targets/<reponame>"
```

## 3. Start OpenCode

Run the vendored OpenCode shim from this folder, not from the target repo:

```bash
bins/shims/opencode
```

Expected loaded control surface:

- default agent: `security-agent-lead`
- skill: `security-agent-mvp`
- MCP tools: `agent-harness-kit`, `codetree`, filesystem, GitNexus, Semble, through `bins/shims/*`
- commands: `/security-agent-*`

Quick verification outside the TUI:

```bash
bins/shims/opencode debug config
bins/shims/opencode mcp list
```

AHK bootstrap status:

- This repo already contains the headless equivalent of `local shim @cardor/agent-harness-kit init`: `agent-harness-kit.config.ts`, `.harness/feature_list.json`, `.harness/current.md`, and `health.sh`.
- The stock `ahk init` command is interactive, so target analysis should not depend on rerunning it.
- Use `bins/shims/ahk sync --direction in` followed by `bins/shims/ahk status --json` to seed and verify the SQLite task state.
- OpenCode serves the harness MCP with `bins/shims/ahk serve --port 3742`.

Containment preflight:

```bash
node --experimental-strip-types ./src/cli.ts doctor --repo "$TARGET_REPO"
node --experimental-strip-types ./src/cli.ts toolchain verify
```

Both must pass before treating Ghost/tool evidence as complete. `toolchain verify` writes `toolchain.lock.json`; any `not_portable_blocker` means the workflow is not portable yet.

## 4. Fast Path

Inside OpenCode, run:

```text
/security-agent-run targets/<reponame> recon,discovery,triage
```

This command performs:

1. claims/resumes the matching AHK task through the `agent-harness-kit` MCP server
2. `init`, which creates the target scan workspace and records AHK status
3. containment doctor and mandatory coverage gates
4. safe Ghost evidence checks against `TARGET_REPO`: `ghost-repo-context`, `ghost-scan-deps`, `ghost-scan-secrets`, `ghost-scan-code`, `ghost-report`
5. recon with default supporting-tool preparation, which imports Ghost repo context and prepares GitNexus/Semble/code graph evidence
6. `discovery`, which runs OpenGrep/focused native agents, sensitive exposure checks, and imports Ghost code/deps/secrets evidence
7. `triage`, with dedup, reachability, exploitability, impact, false-positive challenge, severity panel, and Ghost reconciliation
8. auto-rescore to re-evaluate needs-human-review with full KB context
9. automatic report generation after triage, including Ghost summary when evidence exists

Default behavior is strict. If any mandatory gate is blocked, the run stops with `scan_status: coverage_incomplete` and writes blocker artifacts under `evidence/tool-gates/`. Use `--allow-degraded` only for development or research runs.

Read outputs:

```text
scans/<reponame>/security/executive-summary.md
scans/<reponame>/security/triage-report.md
scans/<reponame>/security/detailed-report.md
scans/<reponame>/review/rescore-report.md
scans/<reponame>/review/checklist.md
```

## 5. Step-By-Step OpenCode Commands

Use this when you want phase control.

Initialize target workspace:

```text
/security-agent-init targets/<reponame>
```

Run recon and prepare supporting tool artifacts:

```text
/security-agent-recon targets/<reponame>
```

Run discovery:

```text
/security-agent-discovery targets/<reponame>
```

Run harsh triage:

```text
/security-agent-triage targets/<reponame>
```

Generate final reports:

```text
/security-agent-report targets/<reponame>
```

Run only the Ghost evidence-generation step, then import it into canonical artifacts:

```text
/security-agent-ghost targets/<reponame>
```

## 6. Raw CLI Equivalent

Use this if OpenCode slash-command behavior is unclear or you need exact flags.

Important: the raw CLI now enforces coverage gates before the native stages. It imports Ghost artifacts and records missing Ghost workflow evidence as blockers. Active Ghost execution is still an OpenCode workflow step because Ghost is packaged as skills. Use `/security-agent-run` or `/security-agent-ghost` when you want Ghost scans generated first.

```bash
node --experimental-strip-types ./src/cli.ts init --repo "$TARGET_REPO"
node --experimental-strip-types ./src/cli.ts recon --repo "$TARGET_REPO" --prepare-tools
node --experimental-strip-types ./src/cli.ts discovery --repo "$TARGET_REPO"
node --experimental-strip-types ./src/cli.ts triage --repo "$TARGET_REPO"
node --experimental-strip-types ./src/cli.ts report --repo "$TARGET_REPO"
```

One-shot:

```bash
node --experimental-strip-types ./src/cli.ts init --repo "$TARGET_REPO"
node --experimental-strip-types ./src/cli.ts run --repo "$TARGET_REPO" --stages recon,discovery,triage
```

Development-only degraded run:

```bash
node --experimental-strip-types ./src/cli.ts run --repo "$TARGET_REPO" --stages recon,discovery,triage --allow-degraded
```

## 7. Command Options

### `init`

```bash
node --experimental-strip-types ./src/cli.ts init --repo "$TARGET_REPO"
```

Creates:

- `config/project.json`
- `config/target.json`
- `config/tools.json`
- `config/agents.json`
- `config/skills.json`
- `config/triage-policy.yaml`
- `evidence/agent-harness-kit.json`

AHK behavior:

- root harness config lives at `agent-harness-kit.config.ts`
- seeded tasks are written into `.harness/harness.db`; `.harness/feature_list.json` remains a bootstrap source, not the runtime authority
- OpenCode connects the `agent-harness-kit` MCP server with `bins/shims/ahk serve --port 3742`
- `init` records `bins/shims/ahk sync --direction in`, `bins/shims/ahk status --json`, and AHK SQLite task/action state into the target evidence artifact
- AHK CLI calls must run sequentially; SQLite can lock if `sync` and `status` run in parallel
- every operator request that starts, resumes, changes, or reviews a target workflow should start with AHK task lookup
- critical external tools are separate harness gates: codeTree, GitNexus, Semble, Ghost, OpenGrep, and Cognium
- a tool gate is done only when its artifact exists or a blocker/unavailable artifact is written
- each verified acceptance criterion is marked in AHK SQLite before task completion; task `done` with unmet acceptance is not audit-clean and is downgraded to `blocked`

### `recon`

```bash
node --experimental-strip-types ./src/cli.ts recon --repo "$TARGET_REPO" --prepare-tools
```

Options:

- `--prepare-tools`: run supporting recon tools before KB generation.
- `--no-ghost`: disable default Ghost repo context import.

Creates:

- `kb/repo-map.json`
- `kb/languages.json`
- `kb/dependencies.json`
- `kb/entrypoints.json`
- `kb/callgraph.json`
- `kb/dataflows.json`
- `kb/threat-model.md`
- `kb/supporting-tools.json`
- `kb/ghost-context.json`
- `integrations/ghost/skills.json`
- `evidence/graph/gitnexus-analyze.json`
- `evidence/graph/gitnexus-query.json`
- `evidence/graph/semble-searches.json`
- `workflow/recon-summary.md`

Supporting tool behavior:

- GitNexus indexes the target and writes graph/query evidence.
- codeTree MCP is shim-launched and rooted at the explicit target repo during recon; OpenCode's standing MCP root is `targets/` so agents do not accidentally analyze the VulnOps control repo.
- Semble performs focused retrieval searches.
- Recon writes `evidence/graph/codetree-structure.json` from codeTree MCP, or an explicit blocker artifact.
- Ghost repo context generated by `/security-agent-run` or `/security-agent-ghost` is imported into canonical KB artifacts.
- Ghost imports read only local target evidence from `evidence/ghost/` and `integrations/ghost/`.
- Tool failures and timeouts are written as artifacts instead of blocking the whole run.

Harness-gated recon artifacts:

- codeTree: `evidence/graph/codetree-structure.json` or blocker
- GitNexus: `evidence/graph/gitnexus-analyze.json` and `evidence/graph/gitnexus-query.json` or blocker
- Semble: `evidence/graph/semble-searches.json` or blocker

### `discovery`

```bash
node --experimental-strip-types ./src/cli.ts discovery --repo "$TARGET_REPO"
```

Options:

- Ghost code/deps/secrets import is enabled by default.
- `--no-ghost`: disable Ghost import.
- `--bug-classes injection,authz,secrets,crypto`: limit focused discovery.

Examples:

```bash
node --experimental-strip-types ./src/cli.ts discovery --repo "$TARGET_REPO" --bug-classes injection,authz,secrets
node --experimental-strip-types ./src/cli.ts discovery --repo "$TARGET_REPO" --no-ghost
```

Creates:

- `findings/raw/*.json`
- `findings/normalized/findings.json`
- `workflow/discovery-summary.md`

Cognium behavior:

- If installed, semantic SAST runs as `cognium scan ./src --category security --exclude-tests --format json`.
- If `./src` is missing in the target, the adapter scans `.` and records a limitation.
- Exit code `1` means Cognium found security issues; it is accepted as a successful tool run.
- Harness task `tool-cognium-semantic-sast` must be closed only after `findings/raw/semantic-sast.json` exists with results or unavailable status.
- Harness task `tool-opengrep-sast` must be closed only after `findings/raw/opengrep.json` exists with results or unavailable status.

### `triage`

```bash
node --experimental-strip-types ./src/cli.ts triage --repo "$TARGET_REPO"
```

Options:

- Ghost finding import and reconciliation are enabled by default.
- `--no-ghost`: disable Ghost import during triage.

Creates:

- `findings/triaged/findings.json`
- `security/triage-report.md`

Triage is intentionally harsh:

- unknown reachability blocks high-confidence acceptance
- low-evidence findings go to human review
- Ghost status is external evidence, not source of truth
- scanner findings are not accepted without supporting context

### `report`

```bash
node --experimental-strip-types ./src/cli.ts report --repo "$TARGET_REPO"
```

Options:

- Ghost summary generation is enabled by default.
- `--no-ghost`: disable Ghost summary generation.
- `--partial`: allow report generation before triage.

Creates:

- `security/executive-summary.md`
- `security/detailed-report.md`
- `security/ghost-findings.md`, generated by default when Ghost mode is enabled
- `review/checklist.md`

### `run`

```bash
node --experimental-strip-types ./src/cli.ts run --repo "$TARGET_REPO" --stages recon,discovery,triage
```

Options:

- `--stages recon,discovery,triage`: choose stage sequence.
- `--no-prepare-tools`: development-only escape hatch; complete scans should keep supporting-tool preparation enabled.
- Ghost evidence is enabled by default.
- `--no-ghost`: disables Ghost repo context, findings import, reconciliation, and summary.
- `--allow-degraded`: development-only; continue after blocked required gates and mark reports `coverage_incomplete`.

Valid stage names:

- `init`
- `recon`
- `discovery`
- `triage`
- `rescore`
- `report`

The recommended stage list is:

```text
recon,discovery,triage
```

Run automatically generates the final report after triage.

## 8. Artifact-First Workflow

The agent should read artifacts in this order:

1. `config/target.json`
2. `kb/supporting-tools.json`
3. `workflow/recon-summary.md`
4. `kb/entrypoints.json`
5. `kb/dependencies.json`
6. `evidence/graph/gitnexus-query.json`
7. `evidence/graph/semble-searches.json`
8. `findings/normalized/findings.json`
9. `findings/triaged/findings.json`
10. `security/executive-summary.md`
11. `security/detailed-report.md`
12. `review/rescore-report.md`

Only read target source files after a finding or KB artifact gives a specific path and line.

Bad behavior:

```text
Read every controller, route, model, and config file into context.
```

Correct behavior:

```text
Read repo-map, entrypoints, GitNexus/Semble summaries, then inspect only targeted snippets.
```

## 9. Failure Rules

Discovery fails closed if recon has not run.

Triage fails closed if discovery has not produced normalized findings.

Report fails closed if triage has not run, unless `--partial` is explicit.

Complete scans require mandatory coverage gates:

- Missing OpenGrep, Cognium, Semble, GitNexus, codeTree, AHK, filesystem MCP, or Ghost workflow evidence makes the default run fail as `coverage_incomplete`.
- `--allow-degraded` is the only mode where the native pipeline may continue after blocked gates.
- Local Ghost skills are loaded from `ghost/skills/plugins/ghost`; only repo-context, scan-code, scan-deps, scan-secrets, and report are part of the default workflow.
- Every blocked gate must have an artifact under `evidence/tool-gates/`.

## 10. Forbidden MVP Actions

These commands are intentionally blocked:

- `prove`
- `patch`
- `patch-validate`
- `autofix`
- `docker-sanitize`
- `ghost-proxy`

Do not do:

- PoC generation
- exploit payload generation
- live validation
- traffic interception
- patch generation
- destructive testing
- production target interaction

The next sane evolution is better recon and triage fidelity, not jumping to exploits. The shiny knife stays in the drawer until the cutting board exists.
