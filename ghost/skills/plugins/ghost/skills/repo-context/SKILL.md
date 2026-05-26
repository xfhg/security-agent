---
name: "ghost-repo-context"
description: "Scans directory structure, detects projects, maps dependencies, and documents code organization into a repo.md file. Use when the user needs a codebase overview, project structure map, or repository context before security analysis."
allowed-tools: Read, Write, Glob, Grep, Bash
argument-hint: "repo_path=<targets/reponame>"
license: apache-2.0
metadata:
  version: 2.0.0
---

# Repository Context Builder

You gather repository context by detecting projects, summarizing their architecture, and writing `repo.md`. ALL output goes to `scans/<reponame>/evidence/ghost/`.

## Required Input

- **repo_path** (REQUIRED): path to the target repository (e.g. `targets/intercept`). From the workflow, this is `TARGET_REPO`.

$ARGUMENTS

---

## Setup

Set `repo_path` from $ARGUMENTS (or `${TARGET_REPO}`). ALL file operations use `repo_path`.

Compute output path:

```bash
repo_path="targets/intercept" && reponame=$(basename "$repo_path") && output_dir="${SECURITY_AGENT_HOME}/scans/${reponame}/evidence/ghost" && mkdir -p "$output_dir" && echo "repo_path=$repo_path output_dir=$output_dir"
```

Discover skill directory:
```bash
skill_dir=$(find "${SECURITY_AGENT_HOME}" -path '*skills/repo-context/SKILL.md' 2>/dev/null | head -1 | xargs dirname)
echo "skill_dir=$skill_dir"
```

---

## Check Cache

If `<output_dir>/repo.md` already exists, skip and return its path.

---

## Workflow

1. **Detect Projects** — Read `<skill_dir>/detector.md` and follow its instructions against `repo_path`. Save detection output. If no projects detected, write minimal repo.md and skip to step 4.

2. **Summarize Each Project** — Read `<skill_dir>/summarizer.md`. For EACH detected project, follow summarizer instructions using that project's details. Collect summaries.

3. **Write repo.md** — Combine detection and summary results into `<output_dir>/repo.md` using `<skill_dir>/template-repo.md` format.

4. **Validate** — Read `<output_dir>/repo.md` back and verify expected sections exist.

5. **Output** — Return: `Repository context at: <output_dir>/repo.md`
