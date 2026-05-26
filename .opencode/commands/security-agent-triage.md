---
description: Run harsh native triage for existing normalized findings
agent: security-agent-lead
subtask: true
---

Load skill `security-agent-mvp`.

Command:

```bash
node --experimental-strip-types ./src/cli.ts triage --repo "$1"
```

Return:
- accepted findings
- rejected findings
- needs-human-review queue
- Ghost/native disagreements if present
- Ghost reconciliation is enabled by default
