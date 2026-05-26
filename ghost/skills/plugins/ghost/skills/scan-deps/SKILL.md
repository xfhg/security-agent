---
name: "ghost-scan-deps"
description: |
  Ghost Security - Software Composition Analysis (SCA) scanner. Scans dependency lockfiles for known vulnerabilities, identifies CVEs, and generates findings with severity levels and remediation guidance. Use when the user asks about dependency vulnerabilities, vulnerable packages, CVE checks, security audits of dependencies, or wants to scan lockfiles like package-lock.json, yarn.lock, go.sum, or Gemfile.lock.
allowed-tools: Read, Write, Glob, Grep, Bash
argument-hint: "[path-to-scan]"
license: apache-2.0
metadata:
  version: 2.0.0
---

# Ghost Security SCA Scanner — Direct Execution Mode

You execute all scanning steps directly without subagent spawning. Follow each section in order.

## Defaults

- **repo_path**: the current working directory
- **scan_dir**: `~/.ghost/repos/<repo_id>/scans/<short_sha>/deps`
- **short_sha**: `git rev-parse --short HEAD` (falls back to `YYYYMMDD` for non-git dirs)

$ARGUMENTS

Any values provided above override the defaults.

---

## Step 0: Setup

Run this Bash command to compute paths and create output directories:

```
repo_name=$(basename "$(pwd)") && remote_url=$(git remote get-url origin 2>/dev/null || pwd) && short_hash=$(printf '%s' "$remote_url" | git hash-object --stdin | cut -c1-8) && repo_id="${repo_name}-${short_hash}" && short_sha=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d) && ghost_repo_dir="$HOME/.ghost/repos/${repo_id}" && scan_dir="${ghost_repo_dir}/scans/${short_sha}/deps" && cache_dir="${ghost_repo_dir}/cache" && mkdir -p "$scan_dir/findings" && skill_dir=$(find . -path '*skills/scan-deps/SKILL.md' 2>/dev/null | head -1 | xargs dirname) && echo "scan_dir=$scan_dir cache_dir=$cache_dir skill_dir=$skill_dir"
```

Store `scan_dir`, `cache_dir`, and `skill_dir`. Assign a scan timestamp: `SCAN_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)`.

---

## Step 1: Initialize Wraith

Install wraith if not already present:

```bash
if [ ! -x ~/.ghost/bin/wraith ] && [ ! -x ~/.ghost/bin/wraith.exe ]; then
  curl -sfL https://raw.githubusercontent.com/ghostsecurity/wraith/main/scripts/install.sh | bash
fi
SECURITY_AGENT_HOME="${SECURITY_AGENT_HOME:-$(pwd)}"
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]') && ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')
WRAPPER="$SECURITY_AGENT_HOME/bins/ghost/${PLATFORM}-${ARCH}/wraith"
if [ -x "$WRAPPER" ]; then WRAPPER_BIN="$WRAPPER"; else WRAPPER_BIN=~/.ghost/bin/wraith; fi
echo "WRAPPER_BIN=$WRAPPER_BIN"
```

Store `WRAPPER_BIN`. If the curl install fails but a bundled wraith exists at `$SECURITY_AGENT_HOME/bins/ghost/`, use that. Only block if no binary can be found.

---

## Step 2: Discover Lockfiles

Find all supported lockfiles. Read the full discovery instructions in `<skill_dir>/agents/discover/agent.md` for the complete lockfile type list. Execute directly:

1. Use Glob to find each lockfile type: `**/go.mod`, `**/package-lock.json`, `**/yarn.lock`, `**/pnpm-lock.yaml`, `**/uv.lock`, `**/poetry.lock`, `**/Pipfile.lock`, `**/requirements.txt`, `**/Gemfile.lock`, `**/Cargo.lock`, `**/pom.xml`, `**/gradle.lockfile`, `**/composer.lock`
2. Map each to an ecosystem (go, npm, pypi, rubygems, cargo, maven, packagist)
3. Write `<scan_dir>/lockfiles.json` with sequential IDs:

```json
{
  "scan_id": "<short_sha>",
  "repo_path": "<repo_path>",
  "timestamp": "<SCAN_TS>",
  "lockfiles_found": <count>,
  "lockfiles": [{"id": 1, "path": "go.mod", "type": "go", "ecosystem": "Go"}, ...]
}
```

If no lockfiles found, write lockfiles.json with `lockfiles_found: 0` and `lockfiles: []`. Skip to Step 5.

---

## Step 3: Scan for Vulnerabilities

For each lockfile in `lockfiles.json`, run wraith:

```bash
# Read lockfiles.json, then for each:
"$WRAPPER_BIN" scan --offline --format json --output "<scan_dir>/scan-<id>.json" "<repo_path>/<lockfile_path>"
```

Exit codes 0 (no vulns) and 1 (vulns found) are both normal.

After all scans complete, aggregate results into `<scan_dir>/candidates.json`:

```json
{
  "scan_id": "<short_sha>",
  "repo_path": "<repo_path>",
  "timestamp": "<SCAN_TS>",
  "summary": { "lockfiles_scanned": N, "packages_scanned": N, "vulnerabilities_found": N, "candidates_created": N },
  "candidates": [
    {
      "id": 1,
      "lockfile": "go.mod",
      "lockfile_id": 1,
      "package": {"name": "...", "version": "...", "ecosystem": "Go", "purl": "..."},
      "vulnerability": {"id": "GO-...", "aliases": [...], "summary": "...", "severity": [...], "references": [...]}
    }
  ]
}
```

Read `<skill_dir>/agents/scan/agent.md` for the complete aggregation logic and JSON schema.

If no vulnerabilities found, write candidates.json with `candidates_created: 0` and `candidates: []`. Skip to Step 5.

---

## Step 4: Analyze Candidates

Read the analyzer instructions at `<skill_dir>/agents/analyze/analyzer.md` for the full analysis criteria.

For each candidate in `<scan_dir>/candidates.json`, process sequentially:
1. Read the candidate's package name, version, and vulnerability details
2. Search the codebase for import/usage of the vulnerable package using Grep (ecosystem-specific patterns from analyzer.md)
3. Determine if the vulnerable code path is actually reachable in this codebase
4. If exploitable: write a finding file to `<scan_dir>/findings/<candidate_id>.md` using the template at `<skill_dir>/agents/analyze/template-finding.md`
5. If not exploitable (not imported, test-only, version overridden, mitigated): note as clean, skip

Track the count of findings written vs clean candidates.

---

## Step 5: Summarize Results

Read the summarize instructions at `<skill_dir>/agents/summarize/agent.md` for the complete report generation logic.

1. Read `<scan_dir>/lockfiles.json` and `<scan_dir>/candidates.json`
2. List and read all finding files from `<scan_dir>/findings/`
3. Compute statistics: lockfiles scanned, packages scanned, vulns detected, confirmed findings, false positives
4. Read `<skill_dir>/agents/summarize/template-report.md` for the report template
5. If `<cache_dir>/repo.md` exists, include repo context in the executive summary
6. Write the final report to `<scan_dir>/report.md`

Copy the report to the recognized evidence path so the CLI pipeline can import it:

```bash
EVIDENCE_DIR="scans/<reponame>/evidence/ghost"
if [ -d "$EVIDENCE_DIR" ]; then
  mkdir -p "$EVIDENCE_DIR"
  cp "<scan_dir>/report.md" "$EVIDENCE_DIR/"
fi
```

Report the final statistics to the user: lockfiles scanned, packages, vulnerabilities detected, confirmed findings, false positives filtered, and report path.
