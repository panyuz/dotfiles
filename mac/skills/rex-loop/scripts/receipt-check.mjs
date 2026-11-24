#!/usr/bin/env bun
// Read-only batch receipt checker. Never acceptance, never sends messages.
import { watch } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { inspectReceipt, inspectReport } from "./receipt-protocol.mjs";

const USAGE = "用法：bun receipt-check.mjs --expect <taskId> <attemptId> <绝对回执路径> [--expect ...] [--wait-ms N] [--report-root DIR] [--require-status reported]";

export function parseArgs(argv) {
  const expects = [];
  let waitMs = 0;
  let reportRoot;
  let requireStatus = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--expect") {
      const taskId = argv[++i], attemptId = argv[++i], file = argv[++i];
      if (!taskId || !attemptId || !file) throw Error(`--expect 需要 3 个值。${USAGE}`);
      if (!isAbsolute(file)) throw Error(`回执路径必须是绝对路径：${file}`);
      expects.push({ taskId, attemptId, file: resolve(file) });
    } else if (arg === "--wait-ms") {
      waitMs = Number(argv[++i]);
      if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 60000) throw Error("--wait-ms 必须是 1..60000 的整数");
    } else if (arg === "--report-root") {
      reportRoot = argv[++i];
      if (!reportRoot || !isAbsolute(reportRoot)) throw Error("--report-root 必须是绝对目录");
    } else if (arg === "--require-status") {
      const v = argv[++i];
      if (v !== "reported") throw Error("--require-status 目前只接受 reported");
      requireStatus = true;
    } else {
      throw Error(`未知参数：${arg}。${USAGE}`);
    }
  }
  if (!expects.length) throw Error(USAGE);
  return { expects, waitMs, reportRoot, requireStatus };
}

export function classifyOne(expect, { reportRoot } = {}) {
  const r = inspectReceipt(expect.file);
  if (r.kind !== "ok") return { ...expect, state: r.kind, detail: r.detail ?? null };
  if (r.taskId !== expect.taskId || r.attemptId !== expect.attemptId) {
    return { ...expect, state: "id-mismatch", detail: { got: { taskId: r.taskId, attemptId: r.attemptId } } };
  }
  const rep = inspectReport(r.reportPath);
  const out = { ...expect, status: r.status, reportPath: r.reportPath };
  if (rep.kind !== "ok") return { ...out, state: rep.kind, detail: rep.detail ?? null };
  if (reportRoot) {
    const rel = relative(resolve(reportRoot), resolve(r.reportPath));
    if (rel.startsWith("..") || isAbsolute(rel)) out.warnings = ["report-outside-root"];
  }
  return { ...out, state: "match" };
}

export function findDuplicates(expects) {
  const byPath = new Map(), byAttempt = new Map();
  for (const e of expects) {
    byPath.set(e.file, (byPath.get(e.file) ?? 0) + 1);
    const key = `${e.taskId}\u0000${e.attemptId}`;
    byAttempt.set(key, (byAttempt.get(key) ?? 0) + 1);
  }
  return expects.map(e => {
    const dupPath = byPath.get(e.file) > 1;
    const dupAttempt = byAttempt.get(`${e.taskId}\u0000${e.attemptId}`) > 1;
    return dupPath || dupAttempt ? { ...e, state: "duplicate", detail: { duplicatePath: dupPath, duplicateAttempt: dupAttempt } } : null;
  }).filter(Boolean);
}

export async function checkBatch(expects, { waitMs = 0, watchImpl = watch, reportRoot, requireStatus = false } = {}) {
  const duplicates = findDuplicates(expects);
  const dupKeys = new Set(duplicates.map(d => d.file + "\u0000" + d.taskId + "\u0000" + d.attemptId));
  let results = expects.map(e => dupKeys.has(e.file + "\u0000" + e.taskId + "\u0000" + e.attemptId) ? duplicates.find(d => d.file === e.file && d.taskId === e.taskId && d.attemptId === e.attemptId) : classifyOne(e, { reportRoot }));
  const waiting = results.filter(r => r.state === "missing" && !dupKeys.has(r.file + "\u0000" + r.taskId + "\u0000" + r.attemptId));
  let watchError = null;
  if (waitMs > 0 && waiting.length) {
    await new Promise(resolveDone => {
      const watchers = [];
      let done = false;
      let timer;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); for (const w of watchers) w.close(); resolveDone(); };
      const fail = (error) => { watchError = String(error?.message ?? error); finish(); };
      const inspect = () => {
        if (done) return;
        for (const r of waiting) {
          const again = classifyOne(r, { reportRoot });
          if (again.state !== "missing") Object.assign(r, again, { late: true });
        }
        if (waiting.every(r => r.state !== "missing")) finish();
      };
      try {
        for (const d of new Set(waiting.map(r => dirname(r.file)))) {
          const w = watchImpl(d, inspect);
          watchers.push(w);
          w.on("error", fail);
        }
        timer = setTimeout(finish, waitMs);
        inspect();
      } catch (error) { fail(error); }
    });
    if (watchError) {
      for (const r of waiting) if (r.state === "missing") { r.state = "watch-error"; r.detail = watchError; }
    } else {
      for (const r of waiting) if (r.state === "missing") r.waited = true;
    }
  }
  const summary = {};
  for (const r of results) summary[r.state] = (summary[r.state] ?? 0) + 1;
  const protocolComplete = results.every(r => r.state === "match");
  const attention = results.filter(r => r.state === "match" && r.status !== "reported").map(r => ({ taskId: r.taskId, attemptId: r.attemptId, status: r.status }));
  const statusOk = requireStatus ? results.every(r => r.state === "match" && r.status === "reported") : true;
  return {
    ok: protocolComplete && statusOk,
    protocolComplete,
    taskCompletion: "not-evaluated",
    attention,
    summary,
    results,
  };
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.log(JSON.stringify({ ok: false, error: e.message })); process.exitCode = 2; return; }
  const out = await checkBatch(opts.expects, { waitMs: opts.waitMs, reportRoot: opts.reportRoot, requireStatus: opts.requireStatus });
  console.log(JSON.stringify(out));
  if (!out.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main().catch(e => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exitCode = 2; });
