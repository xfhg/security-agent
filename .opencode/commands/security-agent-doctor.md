---
description: Run containment doctor for the target security-agent workflow
agent: security-agent-lead
subtask: true
---

Load skill `security-agent-mvp`.

Harness requirement:
- Claim or update `toolchain-containment-preflight`.
- Mark acceptance criteria only after `scans/<reponame>/evidence/containment-doctor.json` and `reports/containment-doctor.md` exist.

Command:

```bash
TARGET_REPO="$1"
node --experimental-strip-types ./src/cli.ts doctor --repo "$TARGET_REPO"
```

The command fails closed on containment errors. Do not continue Ghost or external-tool gates until it passes.
