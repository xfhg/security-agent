# vulnops

**Offline-first security-agent pipeline for repository auditing.**

VulnOps produces deterministic, auditable security reports by running a multi-stage pipeline enhanced by ghost security skills.

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
| `discovery` | SAST, SCA, secrets, heuristics | OpenGrep, Cognium, wraith, poltergeist |
| `triage` | Dedup, reachability, exploitability, severity panel | deterministic rules |
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

## Roadmap

PoC generation, live validation, traffic interception, patch generation, exploit replay, Ghost proxy, production target interaction.

## Documentation

- [`AGENTS.md`](AGENTS.md) — operator posture and workflow rules
- [`OPERATIONMANUAL.md`](OPERATIONMANUAL.md) — step-by-step usage
- [`MULTIPLATFORM.md`](MULTIPLATFORM.md) — deployment for Linux and macOS
- [`docs/security-agent-workflow.md`](docs/security-agent-workflow.md) — pipeline specification
- [`docs/security-agent-flow.md`](docs/security-agent-flow.md) — mermaid diagrams and checkpoints
- [`config/versions.json`](config/versions.json) — pinned tool versions

