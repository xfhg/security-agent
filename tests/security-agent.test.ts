import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveRepo } from "../src/core/paths.ts";

const cli = path.resolve("src/cli.ts");

test("init -> recon -> discovery -> triage -> report produces MVP artifacts", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "security-agent-fixture-"));
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ dependencies: { express: "^4.18.0" }, scripts: { postinstall: "node install.js" } }, null, 2));
  await mkdir(path.join(repo, "src"));
  await writeFile(path.join(repo, "src", "app.js"), `
const express = require('express');
const { exec } = require('child_process');
const app = express();
app.get('/user/:id', (req, res) => {
  exec('ls ' + req.query.path);
  res.send(req.params.id);
});
const api_key = "supersecretvalue12345";
logger.info({ token: api_key }, 'debug auth config');
`);

  await run(["init", "--repo", repo]);
  await run(["run", "--repo", repo, "--stages", "recon,discovery,triage", "--allow-degraded"]);

  const summary = await readFile(path.join(repo, ".security-agent", "reports", "mvp-summary.md"), "utf8");
  const triaged = JSON.parse(await readFile(path.join(repo, ".security-agent", "findings", "triaged", "findings.json"), "utf8"));
  const doctor = JSON.parse(await readFile(path.join(repo, ".security-agent", "evidence", "containment-doctor.json"), "utf8"));
  const coverage = JSON.parse(await readFile(path.join(repo, ".security-agent", "evidence", "coverage-status.json"), "utf8"));
  const codeTree = JSON.parse(await readFile(path.join(repo, ".security-agent", "evidence", "graph", "codetree-structure.json"), "utf8"));
  assert.match(summary, /MVP Security-Agent Summary/);
  assert.match(summary, /scan_status:/);
  assert.ok(triaged.length > 0);
  assert.ok(triaged.some((finding: any) => finding.source_agent === "sensitive-exposure-agent"));
  assert.equal(coverage.scan_status, "coverage_incomplete");
  assert.ok(codeTree.status === "success" || codeTree.status === "blocked");
  assert.equal(doctor.status, "passed");
  await assert.rejects(readFile(path.join(repo, ".security-agent", "evidence", "harness-tasks.json"), "utf8"));
});

test("default run fails closed when required coverage gates are blocked", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "security-agent-strict-gates-"));
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ dependencies: {} }, null, 2));
  await run(["init", "--repo", repo]);
  const result = await run(["run", "--repo", repo, "--stages", "recon,discovery,triage"], false);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /coverage_incomplete/);
  const summary = await readFile(path.join(repo, ".security-agent", "reports", "mvp-summary.md"), "utf8");
  assert.match(summary, /^scan_status: coverage_incomplete/);
});

test("discovery fails closed when recon has not run", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "security-agent-no-recon-"));
  await run(["init", "--repo", repo]);
  const result = await run(["discovery", "--repo", repo], false);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /requires recon/);
});

test("path guard rejects user-space Ghost and allows tmp fixtures", async () => {
  assert.throws(() => resolveRepo(path.join(os.homedir(), ".ghost")), /outside allowed workspace roots/);
  assert.equal(resolveRepo(os.tmpdir()), path.resolve(os.tmpdir()));
});

test("AHK status has no done tasks with unmet acceptance after init", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "security-agent-ahk-"));
  await run(["init", "--repo", repo]);
  const status = await runAhkStatus();
  const tasks = JSON.parse(status.stdout).tasks ?? [];
  const invalid = tasks.filter((task: any) => task.status === "done" && task.acceptance?.some((criterion: any) => !criterion.met));
  assert.deepEqual(invalid, []);
});

test("active OpenCode config is shim-backed and path-portable", async () => {
  const config = await readFile(path.resolve("opencode.jsonc"), "utf8");
  assert.doesNotMatch(config, /\/Users\/glitch/);
  assert.match(config, /bins\/shims\/codetree/);
  assert.match(config, /bins\/shims\/gitnexus/);
  assert.match(config, /bins\/shims\/filesystem-server/);
});

function run(args: string[], expectSuccess = true): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", cli, ...args], { cwd: path.resolve("."), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (expectSuccess && result.code !== 0) reject(new Error(stderr || stdout));
      else resolve(result);
    });
  });
}

function runAhkStatus(): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.resolve("bins/shims/ahk"), ["status", "--json"], { cwd: path.resolve("."), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0) reject(new Error(stderr || stdout));
      else resolve(result);
    });
  });
}
