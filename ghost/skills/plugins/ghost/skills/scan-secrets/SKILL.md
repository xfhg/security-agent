---
name: "ghost-scan-secrets"
description: |
  Ghost Security - Secrets and credentials scanner. Scans codebase for leaked API keys, tokens, passwords, and sensitive data. Detects hardcoded secrets and generates findings with severity and remediation guidance. Use when the user asks to check for leaked secrets, scan for credentials, find hardcoded API keys or passwords, detect exposed .env values, or audit code for sensitive data exposure.
allowed-tools: Read, Write, Glob, Grep, Bash
argument-hint: "[path-to-scan]"
license: apache-2.0
metadata:
  version: 2.0.0
---

# Ghost Security Secrets Scanner — Direct Execution Mode

You execute all scanning steps directly without subagent spawning. Follow each section in order.

## Defaults

- **repo_path**: the current working directory
- **scan_dir**: `~/.ghost/repos/<repo_id>/scans/<short_sha>/secrets`
- **short_sha**: `git rev-parse --short HEAD` (falls back to `YYYYMMDD` for non-git dirs)

$ARGUMENTS

Any values provided above override the defaults.

---

## Step 0: Setup

Run this Bash command to compute paths and create output directories:

```
repo_name=$(basename "$(pwd)") && remote_url=$(git remote get-url origin 2>/dev/null || pwd) && short_hash=$(printf '%s' "$remote_url" | git hash-object --stdin | cut -c1-8) && repo_id="${repo_name}-${short_hash}" && short_sha=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d) && ghost_repo_dir="$HOME/.ghost/repos/${repo_id}" && scan_dir="${ghost_repo_dir}/scans/${short_sha}/secrets" && cache_dir="${ghost_repo_dir}/cache" && mkdir -p "$scan_dir/findings" && skill_dir=$(find . -path '*skills/scan-secrets/SKILL.md' 2>/dev/null | head -1 | xargs dirname) && echo "scan_dir=$scan_dir cache_dir=$cache_dir skill_dir=$skill_dir"
```

Store `scan_dir`, `cache_dir`, and `skill_dir`. Assign a scan timestamp: `SCAN_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)`.

---

## Step 1: Initialize Poltergeist

Install poltergeist if not already present:

```bash
if [ ! -x ~/.ghost/bin/poltergeist ] && [ ! -x ~/.ghost/bin/poltergeist.exe ]; then
  curl -sfL https://raw.githubusercontent.com/ghostsecurity/poltergeist/main/scripts/install.sh | bash
fi
SECURITY_AGENT_HOME="${SECURITY_AGENT_HOME:-$(pwd)}"
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]') && ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')
WRAPPER="$SECURITY_AGENT_HOME/bins/ghost/${PLATFORM}-${ARCH}/poltergeist"
if [ -x "$WRAPPER" ]; then POLTER_BIN="$WRAPPER"; else POLTER_BIN=~/.ghost/bin/poltergeist; fi
echo "POLTER_BIN=$POLTER_BIN"
```

Store `POLTER_BIN`. If the curl install fails but a bundled poltergeist exists at `$SECURITY_AGENT_HOME/bins/ghost/`, use that.

---

## Step 2: Scan for Secrets

Run the poltergeist scanner against the repository:

```bash
"$POLTER_BIN" --output "<scan_dir>/scan-output.json" "<repo_path>"
```

Exit code 1 means secrets were found (normal). Exit code 0 means none found.

Read `<scan_dir>/scan-output.json` and transform results into `<scan_dir>/candidates.json` with sequential IDs:

```json
{
  "scan_id": "<short_sha>",
  "repo_path": "<repo_path>",
  "timestamp": "<SCAN_TS>",
  "summary": { "files_scanned": <N>, "candidates_found": <N> },
  "candidates": [
    {
      "id": 1,
      "file_path": "src/config.ts",
      "line_number": 42,
      "redacted": "sk-ant-***",
      "rule_name": "Anthropic API Key",
      "rule_id": "ghost.anthropic.1",
      "entropy": 4.5
    }
  ]
}
```

Read `<skill_dir>/agents/scan/agent.md` for the complete scan result schema and edge case handling.

If no candidates found, write candidates.json with `candidates_found: 0` and `candidates: []`. Skip to Step 4.

---

## Step 3: Analyze Candidates

Read the analyzer instructions at `<skill_dir>/agents/analyze/analyzer.md` for the full analysis criteria.

For each candidate in `<scan_dir>/candidates.json`, process sequentially:
1. Read the candidate's file at `<repo_path>/<file_path>`, focusing on 10-15 lines around `line_number`
2. Evaluate against the 5 analysis criteria: real secret? hardcoded? production code? exposure evidence? severity?
3. If it's a genuine security risk (real + hardcoded + production path): write a finding file to `<scan_dir>/findings/<finding_id>.md` using the template at `<skill_dir>/agents/analyze/template-finding.md`
4. If any criterion indicates safety (placeholder, env var, test path): mark as clean
5. If `<cache_dir>/repo.md` exists, use the business criticality and sensitive data context to adjust severity

Never include the full secret value — always use the redacted version.

---

## Step 4: Summarize Results

Read the summarize instructions at `<skill_dir>/agents/summarize/agent.md`.

1. Read `<scan_dir>/candidates.json` for scan metadata
2. List and read all finding files from `<scan_dir>/findings/`
3. Compute statistics: total candidates, findings by severity, findings by rule
4. If `<cache_dir>/repo.md` exists, include project criticality and sensitive data context in the executive summary
5. Read `<skill_dir>/agents/summarize/template-report.md` for the report template
6. Write the final report to `<scan_dir>/report.md`

Copy the report to the recognized evidence path so the CLI pipeline can import it:

```bash
EVIDENCE_DIR="scans/<reponame>/evidence/ghost"
if [ -d "$EVIDENCE_DIR" ]; then
  mkdir -p "$EVIDENCE_DIR"
  cp "<scan_dir>/report.md" "$EVIDENCE_DIR/"
fi
```

Report the final statistics to the user: files scanned, candidates found, confirmed findings, and report path.
