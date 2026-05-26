---
description: Run the default Ghost evidence-generation workflows against a target repo
agent: security-agent-lead
subtask: true
---

Load skill `security-agent-mvp`.

Target:

```bash
TARGET_REPO="$1"
```

Harness requirement:
- Use the `agent-harness-kit` MCP tools before work for operator-visible ownership.
- The CLI writes authoritative Ghost gate/action/acceptance state into `.harness/harness.db`.
- Mark Ghost gate tasks done only after artifacts are generated and imported, or mark them blocked with a `scans/<reponame>/evidence/tool-gates/*.json` blocker.

Run these Ghost workflows against `TARGET_REPO`, not this control repo:

1. `ghost-repo-context`
2. `ghost-scan-deps`
3. `ghost-scan-secrets`
4. `ghost-scan-code`
5. `ghost-report`

Rules:
- Do not run `ghost-validate`.
- Do not run `ghost-proxy`.
- Do not capture traffic.
- Do not do live validation.
- If a Ghost skill cannot run, write the blocker into the harness task and mark the complete workflow `coverage_incomplete`. Continue only when the operator explicitly chooses degraded research mode.

After Ghost workflows complete, import them into canonical artifacts:

```bash
node --experimental-strip-types ./src/cli.ts recon --repo "$TARGET_REPO" --prepare-tools
node --experimental-strip-types ./src/cli.ts discovery --repo "$TARGET_REPO"
node --experimental-strip-types ./src/cli.ts triage --repo "$TARGET_REPO"
node --experimental-strip-types ./src/cli.ts report --repo "$TARGET_REPO"
```
