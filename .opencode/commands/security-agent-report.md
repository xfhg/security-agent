---
description: Generate MVP security-agent reports
agent: security-agent-lead
subtask: true
---

Load skill `security-agent-mvp`.

Command:

```bash
node --experimental-strip-types ./src/cli.ts report --repo "$1"
```

Return:
- `scans/<reponame>/reports/mvp-summary.md`
- `scans/<reponame>/reports/triage.md`
- `scans/<reponame>/reports/ghost-summary.md`, when Ghost evidence exists
