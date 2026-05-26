---
description: Run security-agent recon and produce the repository knowledge base
agent: security-agent-lead
subtask: true
---

Load skill `security-agent-mvp`.

Before running the CLI:
- Use `agent-harness-kit` MCP to claim the recon task.
- Claim `tool-codetree-structure`, `tool-gitnexus-recon`, and `tool-semble-retrieval` as separate tool gates when those tasks are pending.
- After verifying each tool artifact/blocker, call `tasks.acceptance.update(criterionId)` for that tool gate.
- Use `codetree` MCP against `TARGET_REPO` paths only to extract structural context: symbols, functions/classes, imports, routes/controllers, and module boundaries.
- Write a compact codeTree evidence artifact or blocker to `scans/<reponame>/evidence/graph/codetree-structure.json`.
- Do not use codeTree results from `SECURITY_AGENT_HOME` as target evidence unless the path is under `TARGET_REPO`.

Command:

```bash
TARGET_REPO="$1"
node --experimental-strip-types ./src/cli.ts recon --repo "$TARGET_REPO" --prepare-tools
```

Return:
- KB artifact paths
- unavailable tools
- supporting tool graph/retrieval artifacts
- codeTree/GitNexus/Semble harness task status
- Ghost repo context import status
- `reports/recon.md`
