import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { exists, securityAgentHome } from "../core/paths.ts";
import { nowIso } from "../core/provenance.ts";

export type AhkTaskStatus = "pending" | "in_progress" | "done" | "blocked";
export type AhkActionStatus = "in_progress" | "completed" | "blocked";

export interface AhkTaskSpec {
  slug: string;
  title: string;
  description: string;
  acceptance: string[];
}

const dbPath = path.join(securityAgentHome(), ".harness", "harness.db");

const schema = `
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  description  TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','in_progress','done','blocked')),
  assigned_to  TEXT,
  created_at   TEXT    NOT NULL,
  started_at   TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_acceptance (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  criterion TEXT    NOT NULL,
  met       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actions (
  id           TEXT    PRIMARY KEY,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent        TEXT    NOT NULL
               CHECK(agent IN ('lead','explorer','builder','reviewer') OR agent LIKE 'custom:%'),
  status       TEXT    NOT NULL DEFAULT 'in_progress'
               CHECK(status IN ('in_progress','completed','blocked')),
  created_at   TEXT    NOT NULL,
  completed_at TEXT,
  summary      TEXT
);

CREATE TABLE IF NOT EXISTS action_sections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id    TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  section_type TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS action_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id   TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  file_path   TEXT    NOT NULL,
  operation   TEXT    NOT NULL
              CHECK(operation IN ('read','created','modified','deleted')),
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS action_tools (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id      TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  tool_name      TEXT    NOT NULL,
  args_json      TEXT,
  result_summary TEXT,
  called_at      TEXT    NOT NULL
);
`;

export class AhkRuntimeAdapter {
  private db: DatabaseSync;

  constructor() {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(schema);
  }

  close(): void {
    this.db.close();
  }

  resetForNewScan(): void {
    this.db.exec(`
      UPDATE tasks SET status = 'pending', assigned_to = NULL, started_at = NULL, completed_at = NULL
      WHERE status IN ('in_progress', 'done', 'blocked');
    `);
    this.db.exec("UPDATE task_acceptance SET met = 0 WHERE met = 1");
    this.db.exec("DELETE FROM action_sections");
    this.db.exec("DELETE FROM action_files");
    this.db.exec("DELETE FROM action_tools");
    this.db.exec("DELETE FROM actions");
  }

  ensureTask(spec: AhkTaskSpec): number {
    const existing = this.db.prepare("SELECT id FROM tasks WHERE slug = ?").get(spec.slug) as { id: number } | undefined;
    if (!existing) {
      const result = this.db.prepare("INSERT INTO tasks (slug, title, description, status, created_at) VALUES (?, ?, ?, 'pending', ?)").run(spec.slug, spec.title, spec.description, nowIso());
      const taskId = Number(result.lastInsertRowid);
      for (const criterion of spec.acceptance) this.addAcceptance(taskId, criterion);
      return taskId;
    }
    this.db.prepare("UPDATE tasks SET title = ?, description = ? WHERE id = ?").run(spec.title, spec.description, existing.id);
    for (const criterion of spec.acceptance) this.addAcceptance(existing.id, criterion);
    return existing.id;
  }

  claim(taskId: number, owner = "custom:security-agent-cli"): void {
    const current = this.db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: AhkTaskStatus } | undefined;
    if (!current) return;
    this.db.prepare("UPDATE tasks SET status = 'in_progress', assigned_to = ?, started_at = COALESCE(started_at, ?), completed_at = NULL WHERE id = ?").run(owner, nowIso(), taskId);
  }

  startAction(taskId: number, agent = "custom:security-agent-cli"): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO actions (id, task_id, agent, status, created_at) VALUES (?, ?, ?, 'in_progress', ?)").run(id, taskId, agent, nowIso());
    return id;
  }

  writeSection(actionId: string, sectionType: "result" | "tools_used" | "files_modified" | "blockers", content: string): void {
    this.db.prepare("INSERT INTO action_sections (action_id, section_type, content, created_at) VALUES (?, ?, ?, ?)").run(actionId, sectionType, content, nowIso());
  }

  recordTool(actionId: string, toolName: string, args: unknown, resultSummary: string): void {
    this.db.prepare("INSERT INTO action_tools (action_id, tool_name, args_json, result_summary, called_at) VALUES (?, ?, ?, ?, ?)").run(actionId, toolName, JSON.stringify(args), resultSummary, nowIso());
  }

  recordFile(actionId: string, filePath: string, operation: "read" | "created" | "modified" | "deleted", notes: string): void {
    this.db.prepare("INSERT INTO action_files (action_id, file_path, operation, notes) VALUES (?, ?, ?, ?)").run(actionId, filePath, operation, notes);
  }

  completeAction(actionId: string, summary: string, status: AhkActionStatus = "completed"): void {
    this.db.prepare("UPDATE actions SET status = ?, completed_at = ?, summary = ? WHERE id = ?").run(status, nowIso(), summary, actionId);
  }

  async completeTaskWithArtifacts(taskId: number, artifacts: string[], summary: string): Promise<boolean> {
    for (const artifact of artifacts) {
      if (await exists(path.join(securityAgentHome(), artifact)) || await exists(artifact)) this.markAcceptanceContaining(taskId, artifact);
    }
    const unmet = this.unmetAcceptance(taskId);
    if (unmet.length) {
      this.blockTask(taskId, `Unmet acceptance criteria: ${unmet.join("; ")}`);
      return false;
    }
    this.db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?").run(nowIso(), taskId);
    return true;
  }

  markAcceptanceContaining(taskId: number, text: string): void {
    const rows = this.db.prepare("SELECT id, criterion FROM task_acceptance WHERE task_id = ? AND met = 0").all(taskId) as Array<{ id: number; criterion: string }>;
    for (const row of rows) {
      const normalized = text.replace(/^TARGET_REPO\/\.security-agent\//, "").replace(/^\.security-agent\//, "").replace(/^scans\/[^/]+\//, "");
      const artifactRelative = text.includes(`${path.sep}.security-agent${path.sep}`) ? text.split(`${path.sep}.security-agent${path.sep}`).pop() ?? text : normalized;
      if (row.criterion.includes(text) || row.criterion.includes(normalized) || row.criterion.includes(artifactRelative) || text.includes(row.criterion)) {
        this.db.prepare("UPDATE task_acceptance SET met = 1 WHERE id = ?").run(row.id);
      }
    }
  }

  markAllAcceptance(taskId: number): void {
    this.db.prepare("UPDATE task_acceptance SET met = 1 WHERE task_id = ?").run(taskId);
  }

  reconcileDoneAcceptance(): number {
    const rows = this.db.prepare(`
      SELECT t.id
      FROM tasks t
      WHERE t.status = 'done'
        AND EXISTS (
          SELECT 1 FROM task_acceptance a
          WHERE a.task_id = t.id AND a.met = 0
        )
    `).all() as Array<{ id: number }>;
    for (const row of rows) {
      this.db.prepare("UPDATE tasks SET status = 'blocked', completed_at = ? WHERE id = ?").run(nowIso(), row.id);
    }
    return rows.length;
  }

  blockTask(taskId: number, reason: string): void {
    this.db.prepare("UPDATE tasks SET status = 'blocked', completed_at = ? WHERE id = ?").run(nowIso(), taskId);
    const actionId = this.startAction(taskId);
    this.writeSection(actionId, "blockers", reason);
    this.completeAction(actionId, reason, "blocked");
  }

  unmetAcceptance(taskId: number): string[] {
    const rows = this.db.prepare("SELECT criterion FROM task_acceptance WHERE task_id = ? AND met = 0").all(taskId) as Array<{ criterion: string }>;
    return rows.map((row) => row.criterion);
  }

  private addAcceptance(taskId: number, criterion: string): void {
    const existing = this.db.prepare("SELECT id FROM task_acceptance WHERE task_id = ? AND criterion = ?").get(taskId, criterion);
    if (!existing) this.db.prepare("INSERT INTO task_acceptance (task_id, criterion, met) VALUES (?, ?, 0)").run(taskId, criterion);
  }
}
