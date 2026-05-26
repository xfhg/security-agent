---
description: Build executive + technical VulnOps reports from a run directory
agent: vulnops-operator
subtask: true
---

Run directory: `$1`

Tasks:
1. Read provenance, policy decision, and normalized findings.
2. Generate:
- `report.executive.md` (risk posture, decisions, deadlines)
- `report.technical.md` (evidence, exploit paths, exact fixes)
3. Ensure every high/critical item has:
- affected component
- evidence reference
- recommended fix
- validation step

Return a concise summary suitable for leadership and engineering handoff.
