---
description: Triage normalized findings and build remediation priority queue
agent: vulnops-operator
subtask: true
---

Load skill `vulnops-orchestrator`.

Inputs:
- Normalized findings file: `$1`
- Optional codebase path: `$2`

Tasks:
1. Deduplicate remaining findings.
2. Rank by exploitability, blast radius, and fix effort.
3. Use GitNexus MCP for impact analysis on top findings.
4. Produce a remediation queue with ownership and sequencing.
5. Flag likely false positives needing manual validation.

Output files:
- `remediation.todo.md`
- `triage.notes.md`
- `tracker.import.json` (if tracker sync requested)
