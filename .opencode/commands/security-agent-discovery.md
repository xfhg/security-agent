---
description: Run security-agent discovery after recon
agent: security-agent-lead
subtask: true
---

Load skill `security-agent-mvp`.

Harness requirement:
- Use `agent-harness-kit` MCP before discovery work.
- Claim `tool-opengrep-sast` before OpenGrep execution and `tool-cognium-semantic-sast` before Cognium execution.
- Mark each tool task done only after `findings/raw/opengrep.json` or `findings/raw/semantic-sast.json` exists with either results or unavailable status.
- After verifying each raw artifact or unavailable blocker, call `tasks.acceptance.update(criterionId)` for the relevant OpenGrep/Cognium criteria.

Command:

```bash
node --experimental-strip-types ./src/cli.ts discovery --repo "$1"
```

Return:
- normalized findings path
- raw findings paths
- Ghost code/deps/secrets import status
- `reports/discovery.md`
