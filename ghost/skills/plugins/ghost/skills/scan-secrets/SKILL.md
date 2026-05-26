---
name: "ghost-scan-secrets"
description: |
  Ghost Security - Secrets and credentials scanner. Scans codebase for leaked API keys, tokens, passwords, and sensitive data. Detects hardcoded secrets and generates findings with severity and remediation guidance. Use when the user asks to check for leaked secrets, scan for credentials, find hardcoded API keys or passwords, detect exposed .env values, or audit code for sensitive data exposure.
allowed-tools: Read, Write, Glob, Grep, Bash
argument-hint: "repo_path=<targets/reponame> [optional: output_dir]"
license: apache-2.0
metadata:
  version: 3.0.0
---

# Ghost Security Secrets Scanner

You execute all scanning steps directly. ALL output goes to `scans/<reponame>/evidence/ghost/`.

## Required Input

- **repo_path** (REQUIRED): the target repository path. Must be passed explicitly (e.g. `targets/intercept`). From the workflow, this is `TARGET_REPO`. DO NOT default to `$(pwd)`.

$ARGUMENTS

---

## Step 0: Setup

Run this Bash command (replace `<repo_path>` with the actual path):

```bash
repo_path="targets/intercept" && reponame=$(basename "$repo_path") && output_dir="${SECURITY_AGENT_HOME}/scans/${reponame}/evidence/ghost" && mkdir -p "$output_dir" && skill_dir=$(find "${SECURITY_AGENT_HOME}" -path '*skills/scan-secrets/SKILL.md' 2>/dev/null | head -1 | xargs dirname) && echo "repo_path=$repo_path reponame=$reponame output_dir=$output_dir"
```

Store `repo_path`, `reponame`, `output_dir`, and `skill_dir`.

---

## Step 1: Initialize Poltergeist

```bash
SECURITY_AGENT_HOME="${SECURITY_AGENT_HOME:?SECURITY_AGENT_HOME must be set}"
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]') && ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')
POLTER="$SECURITY_AGENT_HOME/bins/ghost/${PLATFORM}-${ARCH}/poltergeist"
if [ -x "$POLTER" ]; then POLTER_BIN="$POLTER"; else echo "ERROR: poltergeist not found"; exit 1; fi
echo "POLTER_BIN=$POLTER_BIN"
```

Store `POLTER_BIN`. Do NOT use `~/.ghost/bin/poltergeist`.

---

## Step 2: Scan for Secrets

```bash
"$POLTER_BIN" --output "<output_dir>/scan-output.json" "<repo_path>"
```

Exit code 1 = secrets found (normal). Exit code 0 = none found.

Transform results into `<output_dir>/candidates.json`. Read `<skill_dir>/agents/scan/agent.md` for the schema.

If no candidates: skip to Step 4.

---

## Step 3: Analyze Candidates

For each candidate, process sequentially following `<skill_dir>/agents/analyze/analyzer.md`.

Never include full secret values — always use the redacted version.

If a genuine risk: write finding to `<output_dir>/<finding_id>.md` using `<skill_dir>/agents/analyze/template-finding.md`.

---

## Step 4: Write Findings JSON

Write the final findings to `<output_dir>/scan-secrets-findings.json`. This is the canonical evidence file the CLI import expects.
