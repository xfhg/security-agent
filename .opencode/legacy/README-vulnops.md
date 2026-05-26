# OpenCode VulnOps Pack

## What this adds
- Skill: `vulnops-orchestrator`
- Skill: `security-agent-mvp`
- Agent: `vulnops-operator`
- Agent: `security-agent-lead`
- Commands:
  - `/vulnops-run <manifest-path>`
  - `/vulnops-triage <normalized-findings-path> [repo-path]`
  - `/vulnops-report <run-dir>`
  - `/security-agent-init <repo>`
  - `/security-agent-run <repo> [stages]`
  - `/security-agent-recon <repo>`
  - `/security-agent-discovery <repo>`
  - `/security-agent-triage <repo>`
  - `/security-agent-report <repo>`
- Template manifest: `.opencode/templates/run-manifest.example.json`
- Example config: `.opencode/opencode.vulnops.jsonc`
- Active project config: `opencode.jsonc`

## Quick start
1. From this repository, run `opencode`.
2. For the local MVP security-agent flow, run:
   - `/security-agent-init /path/to/target-repo`
   - `/security-agent-run /path/to/target-repo recon,discovery,triage`
   - `/security-agent-report /path/to/target-repo`
3. Read `docs/security-agent-workflow.md` for the path contract. OpenCode runs here; the target repo is always explicit.
4. For the older ad hoc VulnOps manifest flow, copy the manifest template and fill required fields.
5. In OpenCode TUI, run:
   - `/vulnops-run .opencode/templates/run-manifest.example.json`
6. Then triage/report:
   - `/vulnops-triage /lab-data/results/.../findings.normalized.json /lab-data/repos/your-repo`
   - `/vulnops-report /lab-data/results/.../run-id`

## Opinionated defaults
- Ad hoc mode: local logs + report artifacts, no full SIEM streaming.
- Policy default: fail on critical; fail on high unless approved exception exists.
- MCP hygiene: enable only MCPs needed for the current run.
