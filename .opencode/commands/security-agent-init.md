---
description: Initialize the local security-agent workspace for a target repo
agent: security-agent-lead
subtask: true
---

Load skill `security-agent-mvp`.

Command:

```bash
TARGET_REPO="$1"
node --experimental-strip-types ./src/cli.ts init --repo "$TARGET_REPO"
```

Return:
- created `scans/<reponame>/` workspace path
- initialized config paths
- harness backlog status
- root `agent-harness-kit` sync/status result
- `config/target.json` path contract
