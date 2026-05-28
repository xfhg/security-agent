# VulnOps

**Offline-first security-agent pipeline for repository auditing.**

VulnOps produces deterministic, auditable security reports by running a Opencode multi-stage pipeline enhanced by ghost security skills.

## Quick Start

```bash
git clone https://github.com/xfhg/security-agent.git vulnops
cd vulnops
export SECURITY_AGENT_HOME="$PWD"
bash scripts/bootstrap.sh          # download platform binaries
npm install && cd .opencode && npm install && cd ..
bash scripts/offline-bootstrap.sh  # pre-download CVE database
bins/shims/opencode                # launch the agent
```

Inside OpenCode:

```text
/security-agent-run targets/<reponame> recon,discovery,triage
```

## Pipeline

```
init → doctor (selfcheck) → recon → discovery → triage → rescore → report
```

| Stage | What it does | Tools |
|-------|-------------|-------|
| `recon` | Repo map, entrypoints, call graph, deps, threat model | codeTree, GitNexus |
| `discovery` | SAST, SCA, secrets, heuristics | OpenGrep, Cognium, wraith, poltergeist |
| `triage` | Dedup, reachability, exploitability, severity panel, Ghost reconciliation | deterministic rules + codetree graph evidence |
| `rescore` | Re-evaluate needs-human-review with full KB context + graph-confirmed decisions | Ghost evidence, codetree hot-paths, skeletons, security symbols |
| `report` | Executive summary, detailed findings, review checklist | — |



## Output

```
scans/<reponame>/
├── security/          # findings and summaries
│   ├── executive-summary.md
│   ├── triage-report.md
│   ├── detailed-report.md
│   └── ghost-findings.md
├── review/            # reviewer action queue
│   ├── rescore-report.md
│   └── checklist.md
├── workflow/          # operational logs
├── evidence/          # raw tool output and gate status
│   ├── ghost/         # Ghost skills output (scan-deps, scan-secrets, scan-code)
│   └── graph/         # codeTree, GitNexus artifacts
├── findings/          # normalized and triaged JSON
└── kb/                # repo map, entrypoints, dependencies
```

## Offline Mode

The entire pipeline runs without network access after a one-time bootstrap. See [`MULTIPLATFORM.md`](MULTIPLATFORM.md) for platform-specific setup and the offline tarball.

## Next steps

Integrate Strix, Buttercup and Bumblebee

## v2 Roadmap

PoC generation, live validation, traffic interception, patch generation, exploit replay, Ghost proxy, production target interaction.

## Tool Data Flow

| # | Phase | Tool / Agent | Command | Output | Consumed By |
|---|-------|-------------|---------|--------|-------------|
| 1 | init | `AhkRuntimeAdapter` | `resetForNewScan()` | clean harness DB | all stages (task ownership) |
| 2 | init | `ensureWorkspaceDirs` | `mkdir -p scans/<repo>/{security,review,workflow,…}` | directory tree | all stages |
| 3 | doctor | containment check | `node src/cli.ts doctor --repo <path>` | `workflow/containment-doctor.md` | gate verification |
| 4 | doctor | toolchain verify | `node src/cli.ts toolchain verify` | `toolchain.lock.json` (portable check) | gate verification |
| 5 | recon | `repo-cartographer` | `walk(repo)` — filesystem enumeration | `kb/repo-map.json`, `kb/languages.json` | discovery, triage |
| 6 | recon | `dependency-agent` | manifest parsing (go.mod, package.json, etc.) | `kb/dependencies.json` | dependency-risk discovery |
| 7 | recon | `entrypoint-agent` | pattern scan for routes, controllers, mains | `kb/entrypoints.json` | reachability triage |
| 8 | recon | `graph-agent` | lexical call graph (fallback) | `kb/callgraph.json`, `kb/dataflows.json` | reachability triage |
| 9 | recon | `threat-model-agent` | KB synthesis from repo map + deps + entrypoints | `kb/threat-model.md` | triage context |
| 10 | recon | **codeTree** | `codetree --root <repo>` → repo map, search, security symbols, skeletons, hot paths, dead code | `evidence/graph/codetree-structure.json`, `evidence/graph/codetree-security-symbols.json`, `evidence/graph/codetree-skeletons.json`, `evidence/graph/codetree-hot-paths.json`, `evidence/graph/codetree-graph-context.json` | discovery, triage context |
| 11 | recon | **GitNexus** | `gitnexus analyze --skip-git <repo> && gitnexus query` (retries with --skip-git on failure) | `evidence/graph/gitnexus-analyze.json`, `evidence/graph/gitnexus-query.json` | reachability triage |
| 12 | ghost | **repo-context** | Ghost skill: detect projects, map structure → `evidence/ghost/repo.md` | `evidence/ghost/repo.md` → `kb/ghost-context.json` | recon, report |
| 13 | ghost | **scan-deps (wraith)** | `wraith scan --offline --format json` per lockfile | `evidence/ghost/scan-deps-findings.json` | `importGhostFindings("deps")` |
| 14 | ghost | **scan-secrets (poltergeist)** | `poltergeist <repo>` (163 regex rules) | `evidence/ghost/scan-secrets-findings.json` | `importGhostFindings("secrets")` |
| 15 | ghost | **scan-code** | Ghost SAST: planner → nominator → analyzer → verifier | `evidence/ghost/scan-code-findings.json` | `importGhostFindings("code")` — skipped if OpenGrep+Cognium ran |
| 16 | ghost | **report** | Ghost skill: aggregate all scan findings | `evidence/ghost/report.md` | report stage (ghost summary) |
| 17 | discovery | **OpenGrep** | `opengrep scan --json --quiet --exclude .codetree .` | `findings/raw/opengrep.json` → normalized findings | triage |
| 18 | discovery | **Cognium** | `cognium scan ./src --category security --exclude-tests --exclude-cwe CWE-20 --format json` | `findings/raw/semantic-sast.json` → normalized findings | triage |
| 19 | discovery | `ghost-finding-import` | `importGhostFindings(repo, scanType)` — deps, secrets, or code | `findings/normalized/ghost-*-findings.json` | triage |
| 20 | discovery | `secrets-config-agent` | local heuristic: grep patterns in source | `findings/raw/secrets.json` → normalized findings | triage |
| 21 | discovery | `sensitive-exposure-agent` | local heuristic: log/telemetry/response pattern scan | `findings/raw/logging-exposure.json` → normalized findings | triage |
| 22 | discovery | `injection-agent` | local heuristic: command/shell pattern scan | `findings/raw/injection.json` → normalized findings | triage |
| 23 | discovery | `crypto-agent` | local heuristic: weak hash/cipher/TLS patterns | `findings/raw/crypto.json` → normalized findings | triage |
| 24 | discovery | `deserialization-parser-agent` | local heuristic: unsafe parser patterns | `findings/raw/deserialization.json` → normalized findings | triage |
| 25 | triage | `dedup-agent` | hash-based dedup across all normalized findings | in-memory deduped set | all triage agents |
| 26 | triage | `reachability-agent` | entrypoint matching + codetree security symbols, hot paths, skeletons | reachability score per finding | severity panel |
| 27 | triage | `exploitability-agent` | sink analysis + missing checks | exploitability score per finding | severity panel |
| 28 | triage | `impact-agent` | bug class + severity claim → impact | impact score per finding | severity panel |
| 29 | triage | `false-positive-agent` | path analysis + confidence check | FP risk per finding | severity panel |
| 30 | triage | `severity-panel-agent` | 3-member vote: attacker/defender/maintainer | finding status + priority | rescore, report |
| 31 | triage | `ghost-status-reconciliation` | compare Ghost external_status vs native triage | ghost agreement notes | report |
| 32 | rescore | `rescore-agent` | 7 rules: Ghost boost, noise rejection, test-path demotion, codetree hot-path/skeleton proximity, dep CVE, secrets paths, security symbol match | updated triage scores | report |
| 33 | report | `report-agent` | read triaged findings + coverage status | `security/executive-summary.md`, `security/triage-report.md`, `security/detailed-report.md`, `security/ghost-findings.md`, `review/rescore-report.md`, `review/checklist.md` | operator decision |

## Documentation

- [`AGENTS.md`](AGENTS.md) — operator posture and workflow rules
- [`OPERATIONMANUAL.md`](OPERATIONMANUAL.md) — step-by-step usage
- [`MULTIPLATFORM.md`](MULTIPLATFORM.md) — deployment for Linux and macOS
- [`docs/security-agent-workflow.md`](docs/security-agent-workflow.md) — pipeline specification
- [`docs/security-agent-flow.md`](docs/security-agent-flow.md) — mermaid diagrams and checkpoints
- [`config/versions.json`](config/versions.json) — pinned tool versions


