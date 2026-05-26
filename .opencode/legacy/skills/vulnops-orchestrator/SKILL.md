---
name: vulnops-orchestrator
description: Run ad hoc repository/model/app security assessments end-to-end with local artifacts and MCP-assisted exploration
compatibility: opencode
metadata:
  owner: vulnops
  scope: adhoc-assessment
---

## Purpose
You are the orchestration layer for ad hoc VulnOps assessments. Your job is to run targeted scans, normalize findings, enforce severity policy, and produce a final report bundle with evidence.

## When To Use
Use this skill when a VulnOps operator asks to:
- assess a repository, model artifact set, or app
- triage security posture for a PR or branch
- generate a remediation-focused report package

## Non-Negotiables
- Pin tools and image versions. Do not use floating `latest` in production runs.
- Always record provenance: commit SHA, scanner versions, config hash, UTC timestamp.
- Treat MCP tools as privileged integrations; use the minimum required domains/tools.
- Do not stream full verbose logs to SIEM for ad hoc runs.
- Fail closed on missing required inputs.

## Required Inputs
Collect or infer these inputs before execution:
1. `target_type`: one of `repo|model|app`
2. `target_ref`: repo URL/path, model directory, or app identifier
3. `revision`: commit SHA/branch/tag (for repo/app)
4. `profile`: `quick|standard|deep`
5. `policy`: gate thresholds and exception policy
6. `output_dir`: where report artifacts will be written

## Run Plan
Execute in this order:
1. Preflight
- verify required tools are installed and versions are captured
- resolve target and lock revision
- create run directory and manifest

2. Static and supply-chain scans
- Opengrep
- CodeQL (if language support and profile require it)
- OSV-Scanner
- Trivy repo
- Syft + Grype (optional for deep profile)

3. Model/artifact scans (if target has model artifacts)
- ModelScan
- any required artifact integrity checks

4. Prompt/runtime scans (if LLM-facing app)
- Garak baseline probes
- Promptfoo red-team scenarios
- PyRIT campaigns (standard/deep)

5. Normalization and policy
- convert outputs to canonical schema and SARIF where possible
- map to CWE, OWASP LLM Top 10, MITRE ATLAS, CVSS
- deduplicate by deterministic fingerprint
- enforce gate policy and produce pass/fail decision

6. Packaging and handoff
- build artifact bundle: raw, normalized, summary, remediation plan
- write local evidence and report artifacts
- produce import-ready remediation records when a tracker sync is requested

## Output Contract
Always produce:
1. `run_manifest.json`
2. `provenance.json`
3. `findings.normalized.json`
4. `findings.sarif` (if available)
5. `policy_decision.json`
6. `report.executive.md`
7. `report.technical.md`
8. `remediation.todo.md`

## Decision Policy (Default)
- `Critical`: fail
- `High`: fail unless approved exception exists
- `Medium`: pass with mandatory remediation plan
- `Low/Info`: pass

## Repository Source Rules
- Treat repository hosting as a source location only.
- Resolve a local checkout and pinned revision before scanning.
- Do not assume any specific forge, tracker, CI, or artifact store.
- If a tracker sync is requested, generate import-ready records separately from canonical findings.

## MCP Usage Rules
- GitNexus MCP: exploration, call graph, blast-radius analysis
- Opengrep CLI: static analysis execution in scan stages and remediation verification
- Filesystem MCP: report browsing only in scoped directory

Use only the MCP servers required for the active task to reduce context bloat.

## Refusal Conditions
Stop and request operator input if:
- target scope is ambiguous
- policy configuration is missing
- required credentials are unavailable
- output destination is not writable

## Operator-Facing Summary Format
Return final status in this compact form:
- Scope: <target + revision>
- Coverage: <tools executed>
- Decision: <pass|fail>
- Top Risks: <up to 5>
- Fix Queue: <ordered actions>
- Artifacts: <paths/links>
