---
name: "ghost-scan-code"
description: "Ghost Security - SAST code scanner. Finds security vulnerabilities in source code by planning and executing targeted scans for issues like SQL injection, XSS, BOLA, BFLA, SSRF, and other OWASP categories. Supports applications (backend, frontend, mobile) and libraries (prototype pollution, unsafe deserialization, ReDoS, path traversal, zip slip). Use when the user asks for a code security audit, SAST scan, vulnerability scan of source code, or wants to find security flaws in a codebase or library."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
argument-hint: "repo_path=<targets/reponame> [depth=quick]"
license: apache-2.0
metadata:
  version: 2.0.0
---

# Find Issues

You find security issues in a repository. ALL output goes to `scans/<reponame>/evidence/ghost/`.

## Required Input

- **repo_path** (REQUIRED): target repository path. From the workflow, this is `TARGET_REPO`.
- **depth**: `quick` (default), `balanced`, or `full`

$ARGUMENTS

> Note: If native OpenGrep and Cognium SAST are both available and ran successfully, you may skip this scan and write a note to `<output_dir>/scan-code-findings.json` indicating "skipped: native SAST coverage provided".

---

## Step 1: Setup

```bash
repo_path="targets/intercept" && reponame=$(basename "$repo_path") && output_dir="${SECURITY_AGENT_HOME}/scans/${reponame}/evidence/ghost" && mkdir -p "$output_dir" && echo "repo_path=$repo_path output_dir=$output_dir"
```

Store `repo_path`, `reponame`, and `output_dir`.

1. Read `<output_dir>/repo.md` — if missing, run `ghost-repo-context` first
2. Read [criteria/index.yaml](criteria/index.yaml) for agent→vector mappings per project type
3. Set `depth` to `quick` if not provided
4. If `depth` is `full`, warn user and confirm

---

## Step 2: Plan Scans

If `<output_dir>/plan.md` already exists, skip. Otherwise run the planner using [scripts/loop.sh](scripts/loop.sh).

---

## Step 3: Execute Scans

Run planned scans against files in `repo_path`. Write findings to `<output_dir>/` as individual markdown files.

---

## Step 4: Write Findings JSON

Aggregate findings into `<output_dir>/scan-code-findings.json`. This is the canonical evidence file the CLI import expects.
