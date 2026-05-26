# Security-Agent Start-To-Finish Flow

This diagram shows the current MVP control flow from OpenCode startup to final report.

Path contract:

- `SECURITY_AGENT_HOME`: `${SECURITY_AGENT_HOME}` at runtime
- `TARGET_REPO`: `${SECURITY_AGENT_HOME}/targets/<reponame>` or an explicit allowed target path
- OpenCode runs in `SECURITY_AGENT_HOME`.
- Artifacts are written under `scans/<reponame>/`.

## 1. Whole Pipeline

```mermaid
flowchart TD
  Operator["Operator arrives in SECURITY_AGENT_HOME"] --> Clone["Clone target repo into targets/<reponame>"]
  Clone --> StartOC["Run: opencode"]

  StartOC --> OCConfig["OpenCode loads opencode.jsonc"]
  OCConfig --> AgentLead["Default agent: security-agent-lead"]
  OCConfig --> SkillMVP["Skill available: security-agent-mvp"]
  OCConfig --> Commands["Commands available: /security-agent-*"]
  OCConfig --> MCPs["MCPs connected: agent-harness-kit, codetree, filesystem_vulnops, gitnexus, semble, global MCPs"]

  AgentLead --> RunCmd["/security-agent-run TARGET_REPO recon,discovery,triage"]
  SkillMVP --> RunCmd
  Commands --> RunCmd

  RunCmd --> AHKClaim["AHK MCP: tasks.get, tasks.claim, actions.start"]
  AHKClaim --> Init["CLI init --repo TARGET_REPO"]
  Init --> Doctor["CLI doctor + toolchain verify"]
  Doctor --> GhostRun["Run safe Ghost skills against TARGET_REPO"]
  GhostRun --> Recon["CLI recon --repo TARGET_REPO with supporting tools"]
  Recon --> Discovery["CLI discovery --repo TARGET_REPO"]
  Discovery --> Triage["CLI triage --repo TARGET_REPO"]
  Triage --> Rescore["CLI rescore --repo TARGET_REPO (auto)"]
  Rescore --> Report["CLI report --repo TARGET_REPO"]

  Init --> InitArtifacts["config/*.json + AHK status + harness task artifacts"]
  GhostRun --> GhostArtifacts["Ghost repo/code/deps/secrets/report artifacts when skills run"]
  Recon --> ReconArtifacts["kb/*.json + evidence/graph/*.json + workflow/recon-summary.md"]
  Discovery --> DiscoveryArtifacts["findings/raw/*.json + findings/normalized/findings.json + workflow/discovery-summary.md"]
  Triage --> TriageArtifacts["findings/triaged/findings.json + security/triage-report.md"]
  Rescore --> RescoreArtifacts["review/rescore-report.md + updated findings/triaged/findings.json"]
  Report --> ReportArtifacts["security/executive-summary.md + security/detailed-report.md + security/ghost-findings.md + review/checklist.md"]

  ReportArtifacts --> OperatorReview["Operator reviews final triage and summary"]
```

## 2. OpenCode Loading And Command Dispatch

```mermaid
sequenceDiagram
  autonumber
  participant Op as Operator
  participant OC as OpenCode TUI
  participant Cfg as opencode.jsonc
  participant Lead as security-agent-lead
  participant Skill as security-agent-mvp
  participant Cmd as /security-agent-run
  participant AHK as agent-harness-kit MCP
  participant Ghost as Ghost safe skills
  participant CLI as src/cli.ts

  Op->>OC: cd SECURITY_AGENT_HOME && opencode
  OC->>Cfg: load project config
  Cfg-->>OC: default_agent=security-agent-lead
  Cfg-->>OC: instructions=AGENTS.md, README-vulnops.md
  Cfg-->>OC: MCP config + project commands
  OC->>Lead: activate default agent
  Lead->>Skill: load security-agent-mvp workflow contract
  Op->>Cmd: /security-agent-run TARGET_REPO recon,discovery,triage
  Cmd->>AHK: tasks.get('in_progress')
  Cmd->>AHK: tasks.get('pending')
  Cmd->>AHK: tasks.claim(taskId)
  Cmd->>AHK: actions.start(taskId, 'security-agent-lead')
  Cmd->>CLI: node --experimental-strip-types ./src/cli.ts init --repo TARGET_REPO
  Cmd->>CLI: node --experimental-strip-types ./src/cli.ts doctor --repo TARGET_REPO
  Cmd->>CLI: node --experimental-strip-types ./src/cli.ts toolchain verify
  Cmd->>AHK: claim tool-codetree-structure
  Cmd->>AHK: claim tool-gitnexus-recon
  Cmd->>AHK: claim tool-semble-retrieval
  Cmd->>Ghost: ghost-repo-context TARGET_REPO
  Cmd->>Ghost: ghost-scan-deps TARGET_REPO
  Cmd->>Ghost: ghost-scan-secrets TARGET_REPO
  Cmd->>Ghost: ghost-scan-code TARGET_REPO
  Cmd->>Ghost: ghost-report TARGET_REPO
  Cmd->>CLI: node --experimental-strip-types ./src/cli.ts run --repo TARGET_REPO --stages recon,discovery,triage
  Cmd->>AHK: verify OpenGrep and Cognium tool gates
  Cmd->>AHK: actions.write / actions.complete
  Cmd->>AHK: tasks.update(taskId, 'done') after acceptance artifacts exist
```

## 3. Init Phase

```mermaid
flowchart TD
  InitStart["init --repo TARGET_REPO"] --> EnsureDirs["Create scans/<reponame> directory tree"]

  EnsureDirs --> Project["config/project.json"]
  EnsureDirs --> Target["config/target.json"]
  EnsureDirs --> Tools["config/tools.json"]
  EnsureDirs --> Agents["config/agents.json"]
  EnsureDirs --> Skills["config/skills.json"]
  EnsureDirs --> Policy["config/triage-policy.yaml"]
  EnsureDirs --> Harness[".harness/harness.db task/action/acceptance state"]
  EnsureDirs --> AHK["evidence/agent-harness-kit.json"]
  EnsureDirs --> InitLog["logs/init.log"]

  Project --> ReconReady["Recon may run"]
  Target --> ReconReady
  Tools --> ReconReady
  Agents --> ReconReady
  Skills --> ReconReady
  Policy --> ReconReady
  Harness --> ReconReady

  AHK --> AHKNote["Records bins/shims/ahk sync/status result from root harness; OpenCode MCP owns claims/actions"]
```

Init skill/agent usage:

- OpenCode agent: `security-agent-lead`
- OpenCode skill: `security-agent-mvp`
- CLI stage: `src/stages/init.ts`
- AHK root config: `agent-harness-kit.config.ts`
- AHK backlog source: `.harness/feature_list.json`
- Target evidence mirror: `scans/<reponame>/evidence/agent-harness-kit.json`

Init supporting tools:

- Filesystem writes only
- Git read for commit SHA when available
- `bins/shims/ahk sync --direction in`, then `bins/shims/ahk status --json`, recorded sequentially as AHK evidence

## 4. Recon Phase

```mermaid
flowchart TD
  ReconStart["recon --repo TARGET_REPO --prepare-tools"] --> ToolPrep["prepareReconTools()"]
  ReconStart --> GhostContext["ghost-context-import-agent imports Ghost output generated earlier"]
  GhostContext --> GhostContextArtifact["kb/ghost-context.json + integrations/ghost/skills.json"]

  ToolPrep --> GitNexusDetect["detect gitnexus"]
  ToolPrep --> CodeTreeMCP["codeTree MCP: structure/symbols/imports scoped to TARGET_REPO"]
  GitNexusDetect --> GitNexusAnalyze["gitnexus analyze --skip-agents-md --name security-agent-<hash> TARGET_REPO"]
  GitNexusAnalyze --> GitNexusAnalyzeArtifact["evidence/graph/gitnexus-analyze.json"]
  GitNexusAnalyze --> GitNexusQuery["gitnexus query -r alias --goal security entrypoints and flows"]
  GitNexusQuery --> GitNexusQueryArtifact["evidence/graph/gitnexus-query.json"]

  ToolPrep --> SembleDetect["detect contained Semble"]
  SembleDetect --> SembleSearch1["semble search: entrypoints routes handlers controllers"]
  SembleDetect --> SembleSearch2["semble search: auth authorization middleware policies ownership tenant"]
  SembleDetect --> SembleSearch3["semble search: database shell file crypto secret config"]
  SembleSearch1 --> SembleArtifact["evidence/graph/semble-searches.json"]
  SembleSearch2 --> SembleArtifact
  SembleSearch3 --> SembleArtifact

  ToolPrep --> CodeTreeDetect["detect codeTree CLI fallback"]
  CodeTreeDetect --> CodeTreeRecord["record unavailable if MCP/CLI structure unavailable"]

  GitNexusAnalyzeArtifact --> SupportingTools["kb/supporting-tools.json"]
  GitNexusQueryArtifact --> SupportingTools
  SembleArtifact --> SupportingTools
  CodeTreeMCP --> SupportingTools
  CodeTreeMCP --> CodeTreeArtifact["evidence/graph/codetree-structure.json or blocker"]
  CodeTreeRecord --> SupportingTools

  SupportingTools --> Cartographer["repo-cartographer-agent"]
  Cartographer --> RepoMap["kb/repo-map.json"]
  Cartographer --> Languages["kb/languages.json"]

  RepoMap --> Dependency["dependency-agent"]
  Dependency --> Dependencies["kb/dependencies.json"]

  RepoMap --> Entrypoint["entrypoint-agent"]
  Entrypoint --> Entrypoints["kb/entrypoints.json"]

  RepoMap --> Graph["graph-agent fallback"]
  Graph --> Callgraph["kb/callgraph.json"]
  Graph --> Dataflows["kb/dataflows.json"]

  RepoMap --> ThreatModel["threat-model-agent"]
  Dependencies --> ThreatModel
  Entrypoints --> ThreatModel
  Callgraph --> ThreatModel
  Dataflows --> ThreatModel
  ThreatModel --> ThreatModelMd["kb/threat-model.md"]

  GhostContextArtifact --> ReconReport["workflow/recon-summary.md"]
  RepoMap --> ReconReport
  Languages --> ReconReport
  Dependencies --> ReconReport
  Entrypoints --> ReconReport
  SupportingTools --> ReconReport
```

Recon skill/agent usage:

- OpenCode agent: `security-agent-lead`
- OpenCode skill: `security-agent-mvp`
- CLI stage: `src/stages/recon.ts`
- Recon agents:
  - `repo-cartographer-agent`
  - `dependency-agent`
  - `entrypoint-agent`
  - `graph-agent`
  - `threat-model-agent`
- `ghost-context-import-agent` imports Ghost repo context generated by the OpenCode safe Ghost workflow

Recon supporting tools:

- GitNexus: graph/index and security-focused query evidence
- Semble: local retrieval searches
- codeTree: MCP-first structural context for symbols/functions/classes/imports/routes, scoped to `TARGET_REPO`; CLI detection remains fallback
- Ghost: active safe skills run before recon in `/security-agent-run`; recon imports their context artifacts
- RTK: operator-facing command-output reduction, not part of internal CLI execution

Recon artifacts available to later phases:

- `config/target.json`
- `kb/supporting-tools.json`
- `kb/repo-map.json`
- `kb/languages.json`
- `kb/dependencies.json`
- `kb/entrypoints.json`
- `kb/callgraph.json`
- `kb/dataflows.json`
- `kb/threat-model.md`
- `kb/ghost-context.json`
- `integrations/ghost/skills.json`
- `evidence/graph/codetree-structure.json`
- `evidence/graph/gitnexus-analyze.json`
- `evidence/graph/gitnexus-query.json`
- `evidence/graph/semble-searches.json`
- `workflow/recon-summary.md`

## 5. Discovery Phase

```mermaid
flowchart TD
  DiscoveryStart["discovery --repo TARGET_REPO"] --> Guard["Fail closed unless kb/repo-map.json exists"]
  Guard --> GhostImport["ghost-finding-import-agent imports Ghost scans generated earlier"]
  Guard --> OpenGrepAgent["opengrep-sast-agent"]
  Guard --> SemanticAgent["semantic-sast-agent"]
  Guard --> SecretsAgent["secrets-config-agent"]
  Guard --> InjectionAgent["injection-agent"]
  Guard --> AuthzAgent["authz-authn-agent"]
  Guard --> ParserAgent["deserialization-parser-agent"]
  Guard --> CryptoAgent["crypto-agent"]
  Guard --> DependencyRiskAgent["dependency-risk-agent"]
  Guard --> BusinessLogicAgent["business-logic-agent"]

  OpenGrepAgent --> OpenGrepTool["opengrep scan --json --quiet TARGET_REPO"]
  OpenGrepTool --> RawOpenGrep["findings/raw/opengrep.json"]
  RawOpenGrep --> OpenGrepNormalized["normalized OpenGrep findings"]

  SemanticAgent --> CogniumDetect["detect Cognium"]
  CogniumDetect --> CogniumScan["cognium scan ./src --category security --exclude-tests --exclude-cwe CWE-20 --format json"]
  CogniumScan --> RawSemantic["findings/raw/semantic-sast.json"]

  SecretsAgent --> RawSecrets["findings/raw/secrets-config.json"]
  InjectionAgent --> RawInjection["findings/raw/injection.json"]
  AuthzAgent --> RawAuthz["findings/raw/authz-authn.json"]
  ParserAgent --> RawParser["findings/raw/deserialization-parser.json"]
  CryptoAgent --> RawCrypto["findings/raw/crypto.json"]
  DependencyRiskAgent --> Dependencies["read kb/dependencies.json"]
  Dependencies --> RawDependency["findings/raw/dependency-risk.json"]
  BusinessLogicAgent --> Entrypoints["read kb/entrypoints.json"]
  Entrypoints --> RawBusiness["findings/raw/business-logic.json"]
  GhostImport --> GhostCode["findings/normalized/ghost-code-findings.json"]
  GhostImport --> GhostDeps["findings/normalized/ghost-deps-findings.json"]
  GhostImport --> GhostSecrets["findings/normalized/ghost-secrets-findings.json"]

  OpenGrepNormalized --> Normalized["findings/normalized/findings.json"]
  RawSemantic --> Normalized
  RawSecrets --> Normalized
  RawInjection --> Normalized
  RawAuthz --> Normalized
  RawParser --> Normalized
  RawCrypto --> Normalized
  RawDependency --> Normalized
  RawBusiness --> Normalized
  GhostCode --> Normalized
  GhostDeps --> Normalized
  GhostSecrets --> Normalized

  Normalized --> DiscoveryReport["workflow/discovery-summary.md"]
```

Discovery skill/agent usage:

- OpenCode agent: `security-agent-lead`
- OpenCode skill: `security-agent-mvp`
- CLI stage: `src/stages/discovery.ts`
- Discovery agents:
  - `opengrep-sast-agent`
  - `semantic-sast-agent`
  - `secrets-config-agent`
  - `injection-agent`
  - `authz-authn-agent`
  - `deserialization-parser-agent`
  - `crypto-agent`
  - `dependency-risk-agent`
  - `business-logic-agent`
  - `ghost-finding-import-agent`

Discovery supporting tools:

- OpenGrep: active SAST tool
- Cognium: active semantic SAST when available; runs security-only scan with tests excluded, writes unavailable artifact if missing
- Ghost: safe scan skills run before native discovery in `/security-agent-run`; discovery imports their normalized evidence by default
- Recon KB: used by dependency and business-logic discovery

Discovery artifacts available to triage:

- `findings/raw/*.json`
- `findings/normalized/findings.json`
- `findings/normalized/ghost-code-findings.json`
- `findings/normalized/ghost-deps-findings.json`
- `findings/normalized/ghost-secrets-findings.json`
- `workflow/discovery-summary.md`

## 6. Triage Phase

```mermaid
flowchart TD
  TriageStart["triage --repo TARGET_REPO"] --> Guard["Fail closed unless findings/normalized/findings.json exists"]
  Guard --> LoadFindings["Load normalized findings"]
  Guard --> LoadEntrypoints["Load kb/entrypoints.json"]
  Guard --> LoadRecon["Recon context available: repo-map, callgraph, dataflows, supporting-tools"]

  LoadFindings --> Dedup["dedup-agent"]
  Dedup --> Deduped["Deduplicated finding set"]

  Deduped --> Reachability["reachability-agent"]
  LoadEntrypoints --> Reachability
  LoadRecon --> Reachability
  Reachability --> ReachabilityScore["reachability: confirmed | likely | possible | unlikely | unknown"]

  Deduped --> Exploitability["exploitability-agent"]
  Exploitability --> ExploitabilityScore["exploitability: high | medium | low | unknown"]

  Deduped --> Impact["impact-agent"]
  Impact --> ImpactScore["impact: critical | high | medium | low | unknown"]

  Deduped --> FP["false-positive-agent"]
  FP --> FPRisk["false_positive_risk: high | medium | low"]

  ReachabilityScore --> Panel["severity-panel-agent"]
  ExploitabilityScore --> Panel
  ImpactScore --> Panel
  FPRisk --> Panel
  Panel --> Votes["attacker / defender / maintainer votes"]

  Votes --> Status["accepted | rejected | needs-human-review"]
  Status --> GhostRecon["ghost-status-reconciliation-agent"]
  Deduped --> GhostRecon

  GhostRecon --> Triaged["findings/triaged/findings.json"]
  Triaged --> TriageReport["security/triage-report.md"]
```

Triage skill/agent usage:

- OpenCode agent: `security-agent-lead`
- OpenCode skill: `security-agent-mvp`
- CLI stage: `src/stages/triage.ts`
- Triage agents:
  - `dedup-agent`
  - `reachability-agent`
  - `exploitability-agent`
  - `impact-agent`
  - `false-positive-agent`
  - `severity-panel-agent`
  - `ghost-status-reconciliation-agent`

Triage supporting tools:

- No live external tool execution in current MVP triage.
- Triage consumes artifacts produced earlier:
  - `kb/entrypoints.json`
  - `kb/callgraph.json`
  - `kb/dataflows.json`
  - `kb/supporting-tools.json`
  - `evidence/graph/gitnexus-query.json`
  - `evidence/graph/semble-searches.json`
  - `findings/normalized/findings.json`

Triage artifacts available to decision/report:

- `findings/triaged/findings.json`
- `security/triage-report.md`

## 7. Report And Decision Phase

```mermaid
flowchart TD
  ReportStart["report --repo TARGET_REPO"] --> Guard["Fail closed unless findings/triaged/findings.json exists"]
  Guard --> LoadTriaged["Load triaged findings"]
  LoadTriaged --> Accepted["Accepted findings"]
  LoadTriaged --> Review["Needs-human-review queue"]
  LoadTriaged --> Rejected["Rejected findings"]
  LoadTriaged --> TopRisks["Top 5 by priority"]

  Accepted --> Summary["security/executive-summary.md"]
  Review --> Summary
  Rejected --> Summary
  TopRisks --> Summary

  LoadTriaged --> DetailedReport["security/detailed-report.md"]
  Accepted --> DetailedReport
  Review --> DetailedReport
  Rejected --> DetailedReport

  LoadTriaged --> GhostSummaryDecision["Ghost summary default"]
  GhostSummaryDecision --> GhostSummary["security/ghost-findings.md"]

  Summary --> OperatorDecision["Operator decision: prove later | manual review | rule improvement | ignore"]
```

Decision inputs:

- `security/executive-summary.md`
- `security/detailed-report.md`
- `security/triage-report.md`
- `findings/triaged/findings.json`
- `workflow/discovery-summary.md`
- `workflow/recon-summary.md`

Decision rules:

- Accepted findings may move to a future prove stage.
- `needs-human-review` findings need targeted source review or policy confirmation.
- Rejected findings should inform rule tuning.
- No PoC, live validation, proxying, patching, or AutoFix happens in the MVP.

## 8. Artifact Availability Matrix

```mermaid
flowchart LR
  Init["Init"] --> A1["config/target.json"]
  Init --> A2["config/tools.json"]
  Init --> A3[".harness/harness.db"]

  Recon["Recon"] --> B1["kb/supporting-tools.json"]
  Recon --> B2["kb/repo-map.json"]
  Recon --> B3["kb/dependencies.json"]
  Recon --> B4["kb/entrypoints.json"]
  Recon --> B5["kb/callgraph.json"]
  Recon --> B6["kb/dataflows.json"]
  Recon --> B7["kb/threat-model.md"]
  Recon --> B8["evidence/graph/gitnexus-query.json"]
  Recon --> B9["evidence/graph/semble-searches.json"]

  Discovery["Discovery"] --> C1["findings/raw/*.json"]
  Discovery --> C2["findings/normalized/findings.json"]
  Discovery --> C3["workflow/discovery-summary.md"]

  Triage["Triage"] --> D1["findings/triaged/findings.json"]
  Triage --> D2["security/triage-report.md"]

  Rescore["Rescore (auto)"] --> R1["review/rescore-report.md"]

  Decision["Report / Decision"] --> E1["security/executive-summary.md"]

  D1 --> Rescore
  Rescore --> Decision
  D2 --> Decision
```

## 9. Tool Usage Matrix

| Phase | Agent / Skill | Tool Called | Artifact Written | Used Later By |
| --- | --- | --- | --- | --- |
| OpenCode startup | `security-agent-lead`, `security-agent-mvp` | OpenCode config loader | resolved config | all commands |
| OpenCode command | `security-agent-lead`, `security-agent-mvp` | `agent-harness-kit` MCP: `tasks.get`, `tasks.claim`, `actions.start/write/complete`, `tasks.update` | AHK SQLite state and `.harness/current.md` | task ownership, audit |
| External tool gate | harness task | codeTree, GitNexus, Semble, Ghost, OpenGrep, Cognium | tool artifact or blocker artifact | prevents skipped intermediary scans |
| Init | `security-agent-mvp` | filesystem, git commit lookup, AHK SQLite | `config/*.json`, `.harness/harness.db`, `evidence/agent-harness-kit.json` | recon, all phases |
| Init | harness adapter | sequential `bins/shims/ahk sync --direction in`, `bins/shims/ahk status --json` | `evidence/agent-harness-kit.json` | operator audit |
| Pre-recon/pre-discovery | safe Ghost skills | `ghost-repo-context`, `ghost-scan-deps`, `ghost-scan-secrets`, `ghost-scan-code`, `ghost-report` | Ghost cache/artifacts, later canonical imports | recon, discovery, report |
| Recon prep | graph/recon tools | `gitnexus analyze` | `evidence/graph/gitnexus-analyze.json` | recon, triage context |
| Recon prep | graph/recon tools | `gitnexus query` | `evidence/graph/gitnexus-query.json` | recon, triage context |
| Recon prep | graph/recon tools | `bins/shims/semble search` | `evidence/graph/semble-searches.json` | recon, discovery, triage context |
| Recon prep | graph/recon tools | codeTree MCP JSON-RPC initialize and repo-map/graph calls | `evidence/graph/codetree-structure.json`, `kb/supporting-tools.json` | recon, discovery, triage context |
| Recon | `repo-cartographer-agent` | filesystem scan | `kb/repo-map.json`, `kb/languages.json` | discovery, triage |
| Recon | `dependency-agent` | manifest parsing | `kb/dependencies.json` | dependency-risk discovery |
| Recon | `entrypoint-agent` | pattern scan | `kb/entrypoints.json` | discovery, reachability triage |
| Recon | `graph-agent` | fallback lexical graph | `kb/callgraph.json`, `kb/dataflows.json` | reachability triage |
| Recon | `threat-model-agent` | KB synthesis | `kb/threat-model.md` | triage/report review |
| Discovery | `opengrep-sast-agent` | `opengrep scan` | `findings/raw/opengrep.json` | normalization, triage |
| Discovery | `semantic-sast-agent` | `cognium scan ./src --category security --exclude-tests --exclude-cwe CWE-20 --format json` | `findings/raw/semantic-sast.json` | normalization, triage |
| Discovery | focused agents | local heuristics | `findings/raw/*.json` | normalization, triage |
| Discovery | `ghost-finding-import-agent` default | Ghost import of previously generated scans | `findings/normalized/ghost-*.json` | dedup, reconciliation |
| Triage | `dedup-agent` | no external tool | deduped in memory | all triage agents |
| Triage | `reachability-agent` | reads KB artifacts | triage fields | severity panel |
| Triage | `exploitability-agent` | reads finding evidence | triage fields | severity panel |
| Triage | `impact-agent` | reads finding class/evidence | triage fields | severity panel |
| Triage | `false-positive-agent` | reads finding paths/evidence | triage fields | severity panel |
| Triage | `severity-panel-agent` | deterministic vote logic | triage votes/status | report |
| Triage | `ghost-status-reconciliation-agent` | reads external status | triage ghost notes | report |
| Rescore (auto) | `rescore-agent` | reads triaged findings + KB artifacts | `review/rescore-report.md`, updated triage scores | report |
| Report | `report-agent` | reads triaged findings | `security/executive-summary.md`, `security/detailed-report.md`, `security/ghost-findings.md` | operator decision |

## 10. Troubleshooting Checkpoints

Use these checkpoints to verify agents are following the workflow:

1. OpenCode should resolve `default_agent: security-agent-lead`.
2. `/security-agent-run` should use AHK MCP before shell execution: `tasks.get`, `tasks.claim`, `actions.start`.
3. `/security-agent-run` should call `init` before `run`.
4. `/security-agent-run` should attempt safe Ghost workflows before native recon/discovery import.
5. Complete `run` prepares recon tools by default; direct `recon` may still use `--prepare-tools`.
6. `scans/<reponame>/config/target.json` should exist after init.
7. `scans/<reponame>/evidence/agent-harness-kit.json` should record AHK sync/status.
8. `scans/<reponame>/kb/supporting-tools.json` should exist after recon.
9. `scans/<reponame>/evidence/graph/gitnexus-query.json` should exist after recon when GitNexus responds.
10. `scans/<reponame>/evidence/graph/semble-searches.json` should exist after recon when Semble responds.
11. Discovery should not run before `kb/repo-map.json` exists.
12. Triage should not run before `findings/normalized/findings.json` exists.
13. Report should not run before `findings/triaged/findings.json` exists unless `--partial` is explicit.
14. Rescore auto-triggers after triage in complete pipelines; `review/rescore-report.md` should exist after triage completes.
