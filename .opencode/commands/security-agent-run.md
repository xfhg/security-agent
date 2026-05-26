---
description: Run the MVP security-agent pipeline
agent: security-agent-lead
subtask: true
---

Load skill `security-agent-mvp`.

Harness requirement:
- Use `agent-harness-kit` MCP before shell execution for operator-visible ownership.
- The CLI writes authoritative task/action/tool/file/acceptance state into `.harness/harness.db`; do not maintain a parallel `harness-tasks.json` store.
- Treat external tools as mandatory harness gates: `mcp-filesystem`, `ahk`, `mcp-codetree`, `mcp-gitnexus`, `tool-gitnexus`, `tool-semble`, `tool-opengrep`, `tool-cognium`, `ghost-repo-context`, `ghost-deps`, `ghost-secrets`, `ghost-scan-code`, and `ghost-report`.
- If a tool is unavailable, close the task only after recording the blocker and confirming the unavailable artifact exists under `scans/<reponame>/`.
- If the MCP is unavailable, run `bins/shims/ahk sync --direction in` and then `bins/shims/ahk status --json` sequentially, and record the blocker in the final response.

Command:

```bash
TARGET_REPO="$1"
node --experimental-strip-types ./src/cli.ts init --repo "$TARGET_REPO"
node --experimental-strip-types ./src/cli.ts doctor --repo "$TARGET_REPO"
node --experimental-strip-types ./src/cli.ts toolchain verify
```

Before native recon, codeTree MCP must initialize against `TARGET_REPO` and write a compact summary/blocker artifact:

```text
scans/<reponame>/evidence/graph/codetree-structure.json
```

Then actively run Ghost workflows against `TARGET_REPO`, not this control repo:

1. `ghost-repo-context`
2. `ghost-scan-deps`
3. `ghost-scan-secrets`
4. `ghost-scan-code`
5. `ghost-report`

Forbidden during this command:
- `ghost-validate`
- `ghost-proxy`
- live validation
- traffic interception

After Ghost workflows complete, run the strict native orchestration:

```bash
node --experimental-strip-types ./src/cli.ts run --repo "$TARGET_REPO" --stages "${2:-recon,discovery,triage}"
```

Do not add `--allow-degraded` for CISO-facing complete scans. If the strict run fails with `coverage_incomplete`, report the blocker artifacts and stop.

Before triage, verify:
- `scans/<reponame>/evidence/graph/gitnexus-query.json` or GitNexus blocker exists
- `scans/<reponame>/evidence/graph/semble-searches.json` or Semble blocker exists
- `scans/<reponame>/findings/raw/opengrep.json` exists
- `scans/<reponame>/findings/raw/semantic-sast.json` exists and records Cognium command/unavailable status

Do not report a tool gate as complete if its acceptance criteria remain unmarked in AHK.

Return:
- `scan_status` from `scans/<reponame>/evidence/coverage-status.json`
- tool gate status from `scans/<reponame>/evidence/tool-gates/summary.json`
- top risks
- manual review count
- report artifact paths
- `scans/<reponame>/kb/supporting-tools.json`
- Ghost workflow status and canonical import status
