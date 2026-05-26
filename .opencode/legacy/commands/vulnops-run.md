---
description: Run a full ad hoc VulnOps assessment from a run manifest
agent: vulnops-operator
subtask: true
---

Load skill `vulnops-orchestrator` and execute this run end-to-end.

Run manifest path: `$1`

Preflight checks:
- Validate manifest schema and required fields.
- Confirm target revision is pinned.
- Capture tool versions and environment metadata.

Execution:
- Run the configured profile (`quick|standard|deep`) exactly as declared in the manifest.
- Normalize findings and apply policy gates.
- Generate all required output artifacts.

Publishing:
- Write report bundle to the configured local output directory.
- Generate import-ready remediation records if a tracker sync is requested.
- If target metadata includes a PR/commit context, write a concise summary artifact with remediation priorities.

Return:
- Scope, coverage, policy decision, top risks, fix queue, artifact locations.
