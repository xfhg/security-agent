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
init → doctor → recon → discovery → triage → rescore → report
```

| Stage | What it does | Tools |
|-------|-------------|-------|
| `recon` | Repo map, entrypoints, call graph, dependencies | codeTree, GitNexus, Semble |
| `discovery` | Agent, SAST, SCA, secrets, heuristics | OpenGrep, Cognium, wraith, poltergeist |
| `triage` | Agent Dedup, reachability, exploitability, severity panel | deterministic rules |
| `rescore` | Re-evaluate needs-human-review with full KB context | Ghost evidence, entrypoint proximity, noise rejection |
| `report` | Executive summary, detailed findings, review checklist | — |

Ghost skills (`ghost-repo-context`, `ghost-scan-deps`, `ghost-scan-secrets`, `ghost-scan-code`, `ghost-report`) run before discovery by default and are imported as canonical evidence.

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
├── findings/          # normalized and triaged JSON
└── kb/               # repo map, entrypoints, dependencies
```

## Offline Mode

The entire pipeline runs without network access after a one-time bootstrap. See [`MULTIPLATFORM.md`](MULTIPLATFORM.md) for platform-specific setup and the offline tarball.

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
| 10 | recon | **codeTree** | `codetree --root <repo>` → `get_repository_map` | `evidence/graph/codetree-structure.json` | discovery, triage context |
| 11 | recon | **GitNexus** | `gitnexus analyze <repo> && gitnexus query` | `evidence/graph/gitnexus-query.json` | reachability triage |
| 12 | recon | **Semble** | `semble search <query> <repo>` (3 queries) | `evidence/graph/semble-searches.json` | discovery, triage context |
| 13 | ghost | **repo-context** | Ghost skill: detect projects, map structure | `evidence/ghost/repo.md` → `kb/ghost-context.json` | recon, report |
| 14 | ghost | **scan-deps (wraith)** | `wraith scan --offline --format json` per lockfile | `evidence/ghost/scan-deps-findings.json` | `importGhostFindings("deps")` |
| 15 | ghost | **scan-secrets (poltergeist)** | `poltergeist <repo>` (163 regex rules) | `evidence/ghost/scan-secrets-findings.json` | `importGhostFindings("secrets")` |
| 16 | ghost | **scan-code** | Ghost SAST: planner → nominator → analyzer → verifier | `evidence/ghost/scan-code-findings.json` | `importGhostFindings("code")` — or skipped if OpenGrep+Cognium ran |
| 17 | ghost | **report** | Ghost skill: aggregate all scan findings | `evidence/ghost/report.md` | report stage (ghost summary) |
| 18 | discovery | **OpenGrep** | `opengrep scan --json --quiet --exclude .codetree .` | `findings/raw/opengrep.json` → normalized findings | triage |
| 19 | discovery | **Cognium** | `cognium scan ./src --category security --exclude-tests --exclude-cwe CWE-20 --format json` | `findings/raw/semantic-sast.json` → normalized findings | triage |
| 20 | discovery | `ghost-finding-import` | `importGhostFindings(repo, scanType)` — deps, secrets, or code | `findings/normalized/ghost-*-findings.json` | triage |
| 21 | discovery | `secrets-config-agent` | local heuristic: grep patterns in source | `findings/raw/secrets.json` → normalized findings | triage |
| 22 | discovery | `sensitive-exposure-agent` | local heuristic: log/telemetry/response pattern scan | `findings/raw/logging-exposure.json` → normalized findings | triage |
| 23 | discovery | `injection-agent` | local heuristic: command/shell pattern scan | `findings/raw/injection.json` → normalized findings | triage |
| 24 | discovery | `crypto-agent` | local heuristic: weak hash/cipher/TLS patterns | `findings/raw/crypto.json` → normalized findings | triage |
| 25 | discovery | `deserialization-parser-agent` | local heuristic: unsafe parser patterns | `findings/raw/deserialization.json` → normalized findings | triage |
| 26 | triage | `dedup-agent` | hash-based dedup across all normalized findings | in-memory deduped set | all triage agents |
| 27 | triage | `reachability-agent` | entrypoint matching + file proximity | reachability score per finding | severity panel |
| 28 | triage | `exploitability-agent` | sink analysis + missing checks | exploitability score per finding | severity panel |
| 29 | triage | `impact-agent` | bug class + severity claim → impact | impact score per finding | severity panel |
| 30 | triage | `false-positive-agent` | path analysis + confidence check | FP risk per finding | severity panel |
| 31 | triage | `severity-panel-agent` | 3-member vote: attacker/defender/maintainer | finding status + priority | rescore, report |
| 32 | triage | `ghost-status-reconciliation` | compare Ghost external_status vs native triage | ghost agreement notes | report |
| 33 | rescore | `rescore-agent` | 6 rules: Ghost boost, noise rejection, test-path demotion, entrypoint proximity, dep CVE, secrets paths | updated triage scores | report |
| 34 | report | `report-agent` | read triaged findings + coverage status | `security/executive-summary.md`, `security/triage-report.md`, `security/detailed-report.md`, `security/ghost-findings.md`, `review/rescore-report.md`, `review/checklist.md` | operator decision |

## Documentation

- [`AGENTS.md`](AGENTS.md) — operator posture and workflow rules
- [`OPERATIONMANUAL.md`](OPERATIONMANUAL.md) — step-by-step usage
- [`MULTIPLATFORM.md`](MULTIPLATFORM.md) — deployment for Linux and macOS
- [`docs/security-agent-workflow.md`](docs/security-agent-workflow.md) — pipeline specification
- [`docs/security-agent-flow.md`](docs/security-agent-flow.md) — mermaid diagrams and checkpoints
- [`config/versions.json`](config/versions.json) — pinned tool versions


