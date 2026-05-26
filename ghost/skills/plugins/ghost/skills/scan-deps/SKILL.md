---
name: "ghost-scan-deps"
description: |
  Ghost Security - Software Composition Analysis (SCA) scanner. Scans dependency lockfiles for known vulnerabilities, identifies CVEs, and generates findings with severity levels and remediation guidance. Use when the user asks about dependency vulnerabilities, vulnerable packages, CVE checks, security audits of dependencies, or wants to scan lockfiles like package-lock.json, yarn.lock, go.sum, or Gemfile.lock.
allowed-tools: Read, Write, Glob, Grep, Bash
argument-hint: "repo_path=<targets/reponame> [optional: output_dir]"
license: apache-2.0
metadata:
  version: 3.0.0
---

# Ghost Security SCA Scanner

You execute all scanning steps directly. ALL output goes to `scans/<reponame>/evidence/ghost/`.

## Required Input

- **repo_path** (REQUIRED): the target repository path. Must be passed explicitly (e.g. `targets/intercept`). From the workflow, this is `TARGET_REPO`. DO NOT default to `$(pwd)` — the scan WILL fail if this is not the target repo path.

$ARGUMENTS

---

## Step 0: Setup

Run this Bash command (replace `<repo_path>` with the actual path, e.g. `targets/intercept`):

```bash
repo_path="targets/intercept" && reponame=$(basename "$repo_path") && output_dir="${SECURITY_AGENT_HOME}/scans/${reponame}/evidence/ghost" && mkdir -p "$output_dir" && skill_dir=$(find "${SECURITY_AGENT_HOME}" -path '*skills/scan-deps/SKILL.md' 2>/dev/null | head -1 | xargs dirname) && echo "repo_path=$repo_path reponame=$reponame output_dir=$output_dir"
```

Store `repo_path`, `reponame`, `output_dir`, and `skill_dir`. All scan artifacts go under `$output_dir`.

---

## Step 1: Initialize Wraith

```bash
SECURITY_AGENT_HOME="${SECURITY_AGENT_HOME:?SECURITY_AGENT_HOME must be set}"
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]') && ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')
WRAPPER="$SECURITY_AGENT_HOME/bins/ghost/${PLATFORM}-${ARCH}/wraith"
if [ -x "$WRAPPER" ]; then WRAPPER_BIN="$WRAPPER"; else echo "ERROR: wraith not found"; exit 1; fi
echo "WRAPPER_BIN=$WRAPPER_BIN"
```

Store `WRAPPER_BIN`. Do NOT use `~/.ghost/bin/wraith` — use the contained `${SECURITY_AGENT_HOME}/bins/ghost/` path.

---

## Step 2: Discover Lockfiles

Find all supported lockfiles using Glob. Read `<skill_dir>/agents/discover/agent.md` for the full lockfile type list.

Write `<output_dir>/lockfiles.json` with the discovery results.

If no lockfiles found: write `{"lockfiles_found": 0, "lockfiles": []}`. Skip to Step 5.

---

## Step 3: Scan for Vulnerabilities

For each lockfile, run wraith. Try online first, fall back to `--offline` if network is unavailable:

```bash
# Try online (queries OSV.dev API — accurate, requires network)
"$WRAPPER_BIN" scan --format json --output "<output_dir>/scan-<id>.json" "<repo_path>/<lockfile_path>"

# If the above fails (network error), retry with offline flag (uses local OSV database)
if [ $? -ne 0 ]; then
  "$WRAPPER_BIN" scan --offline --format json --output "<output_dir>/scan-<id>.json" "<repo_path>/<lockfile_path>"
  echo "OFFLINE_SCAN=true" >> "<output_dir>/scan-mode.txt"
fi
```

Exit codes 0 (no vulns) and 1 (vulns found) are both normal.

## Step 3a: Scan Mode Awareness

After scanning, check if offline mode was used and handle 0 findings appropriately:

- **Online scan + 0 vulns**: repo has no known CVEs — valid result.
- **Offline scan + 0 vulns**: SUSPICIOUS — may mean the OSV database was never downloaded rather than a clean scan. Write a warning in the findings:
  ```json
  { "offline_scan": true, "offline_db_available": <bool>, "note": "0 findings in offline mode may indicate missing OSV database" }
  ```
- **Offline scan + N vulns**: valid result, the offline DB was available.

Detect offline mode and DB availability:
```bash
if [ -f "<output_dir>/scan-mode.txt" ] && grep -q "OFFLINE_SCAN=true" "<output_dir>/scan-mode.txt"; then
  OFFLINE=true
fi
# Check if OSV DB exists
OSV_CACHE="$HOME/Library/Caches/osv-scanner"
[ -d "$OSV_CACHE" ] && [ "$(ls -A "$OSV_CACHE" 2>/dev/null)" ] && DB_AVAILABLE=true || DB_AVAILABLE=false
```

Aggregate all scan results into `<output_dir>/candidates.json`. Read `<skill_dir>/agents/scan/agent.md` for the schema. Include `offline_scan` and `offline_db_available` fields in the output.

If no vulnerabilities found: write candidates.json with `candidates_created: 0`. Skip to Step 5.

---

## Step 4: Analyze Candidates

For each candidate in candidates.json, process sequentially following `<skill_dir>/agents/analyze/analyzer.md`.

If exploitable: write finding to `<output_dir>/<candidate_id>.md` using template at `<skill_dir>/agents/analyze/template-finding.md`.

---

## Step 5: Write Findings JSON

Write the final findings to `<output_dir>/scan-deps-findings.json`. This is the canonical evidence file the CLI import expects.

```
<output_dir>/scan-deps-findings.json
```
