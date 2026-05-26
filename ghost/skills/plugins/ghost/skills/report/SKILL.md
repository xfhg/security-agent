---
name: "ghost-report"
description: "Ghost Security — combined security report. Aggregates findings from all scan skills (scan-deps, scan-secrets, scan-code) into a single prioritized report focused on the highest risk, highest confidence issues. Use when the user requests a security overview, vulnerability summary, full security audit, or combined scan results."
allowed-tools: Read, Write, Glob, Grep, Bash
argument-hint: "repo_path=<targets/reponame>"
license: apache-2.0
metadata:
  version: 2.0.0
---

# Combined Security Report

You aggregate findings from all scan skills into a single report. ALL output goes to `scans/<reponame>/evidence/ghost/`.

## Required Input

- **repo_path** (REQUIRED): target repository path. From the workflow, this is `TARGET_REPO`.

$ARGUMENTS

---

## Setup

```bash
repo_path="targets/intercept" && reponame=$(basename "$repo_path") && output_dir="${SECURITY_AGENT_HOME}/scans/${reponame}/evidence/ghost" && skill_dir=$(find "${SECURITY_AGENT_HOME}" -path '*skills/report/SKILL.md' 2>/dev/null | head -1 | xargs dirname) && echo "repo_path=$repo_path output_dir=$output_dir"
```

Store `repo_path`, `reponame`, `output_dir`, and `skill_dir`.

---

## Cache Check

If `<output_dir>/report.md` already exists, show its path and skip to output.

---

## Gather Findings

Read these files if they exist:
- `<output_dir>/scan-deps-findings.json`
- `<output_dir>/scan-secrets-findings.json`
- `<output_dir>/scan-code-findings.json`
- `<output_dir>/repo.md`

If `<output_dir>/repo.md` exists, include business criticality and sensitive data context.

---

## Generate Report

1. Compute statistics: findings by severity, source, type
2. Read `<skill_dir>/agents/summarize/template-report.md` for the template
3. Prioritize highest risk, highest confidence issues first
4. Write to `<output_dir>/report.md`

Report: `Combined security report at: <output_dir>/report.md`
