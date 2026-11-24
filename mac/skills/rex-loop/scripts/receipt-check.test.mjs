import { test, expect, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkBatch, parseArgs } from './receipt-check.mjs';
import { inspectReceipt } from './receipt-protocol.mjs';

// Fixtures must live under a caller-provided, existing absolute directory.
// No fallback to the system temp dir. Only this run's subdirectory is removed.
const ENV_ROOT = process.env.RECEIPT_TEST_TMP;
if (!ENV_ROOT || !isAbsolute(ENV_ROOT)) throw new Error('RECEIPT_TEST_TMP 必须是绝对路径');
const BASE = resolve(ENV_ROOT);
if (!statSync(BASE).isDirectory()) throw new Error('RECEIPT_TEST_TMP 必须是已存在的目录');
const RUN_DIR = mkdtempSync(join(BASE, 'run-'));
let dir;
beforeEach(() => { dir = mkdtempSync(join(RUN_DIR, 'case-')); });
afterAll(() => {
  if (RUN_DIR === BASE) throw new Error('拒绝删除调用方目录');
  rmSync(RUN_DIR, { recursive: true, force: true });
});

// Protocol parity: the module must be named explicitly. A missing or unreadable
// module fails the parity test; it is never treated as a pass.
const WAIT_MODULE = process.env.WAIT_REPORT_MODULE;

function receipt(name, obj) {
  const p = join(dir, name);
  writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return p;
}
function report(name = 'report.md') {
  const p = join(dir, name);
  writeFileSync(p, '# report body is never read\n');
  return p;
}
function valid(name, extra = {}) {
  const rep = report(name + '.md');
  const p = receipt(name + '.json', { taskId: 'T1', attemptId: 'A1', status: 'reported', reportPath: rep, ...extra });
  return { p, rep };
}
const one = async (taskId, attemptId, file, opts) => checkBatch([{ taskId, attemptId, file }], opts);

test('只删除本次 run 子目录，调用方目录与 sentinel 保留', () => {
  const sentinel = join(BASE, '.sentinel-r1');
  writeFileSync(sentinel, 'keep\n');
  expect(RUN_DIR === BASE).toBe(false);
  expect(RUN_DIR.startsWith(BASE + '/')).toBe(true);
  expect(statSync(sentinel).isFile()).toBe(true);
});

test('有效回执：match，输出不读报告正文', async () => {
  const { p } = valid('ok');
  const out = await one('T1', 'A1', p);
  expect(out.ok).toBe(true);
  expect(out.protocolComplete).toBe(true);
  expect(out.taskCompletion).toBe('not-evaluated');
  expect(out.results[0].state).toBe('match');
  expect(JSON.stringify(out)).not.toContain('report body');
});

test('缺失、无效 JSON、缺字段、坏状态、相对路径、超大、非常规文件', async () => {
  expect((await one('T1', 'A1', join(dir, 'nope.json'))).results[0].state).toBe('missing');
  expect((await one('T1', 'A1', receipt('bad.json', '{oops'))).results[0].state).toBe('invalid-json');
  expect((await one('T1', 'A1', receipt('miss.json', { taskId: 'T1', attemptId: 'A1', status: 'reported' }))).results[0].state).toBe('invalid-field');
  expect((await one('T1', 'A1', receipt('status.json', { taskId: 'T1', attemptId: 'A1', status: 'done', reportPath: report() }))).results[0].state).toBe('invalid-status');
  expect((await one('T1', 'A1', receipt('rel.json', { taskId: 'T1', attemptId: 'A1', status: 'reported', reportPath: 'x.md' }))).results[0].state).toBe('invalid-field');
  const big = join(dir, 'big.json');
  writeFileSync(big, JSON.stringify({ taskId: 'T1', attemptId: 'A1', status: 'reported', reportPath: report(), pad: 'x'.repeat(70000) }));
  expect((await one('T1', 'A1', big)).results[0].state).toBe('too-large');
  expect((await one('T1', 'A1', dir)).results[0].state).toBe('invalid');
});

test('ID 不符与重复', async () => {
  const { p } = valid('id');
  expect((await one('T2', 'A1', p)).results[0].state).toBe('id-mismatch');
  const dup = await checkBatch([{ taskId: 'T1', attemptId: 'A1', file: p }, { taskId: 'T1', attemptId: 'A1', file: p }]);
  expect(dup.summary.duplicate).toBe(2);
  const { p: p2 } = valid('id2');
  const dupAttempt = await checkBatch([{ taskId: 'T1', attemptId: 'A1', file: p }, { taskId: 'T1', attemptId: 'A1', file: p2 }]);
  expect(dupAttempt.summary.duplicate).toBe(2);
});

test('报告不存在或不可读，权限不当缺失', async () => {
  const miss = receipt('rep-miss.json', { taskId: 'T1', attemptId: 'A1', status: 'reported', reportPath: join(dir, 'gone.md') });
  expect((await one('T1', 'A1', miss)).results[0].state).toBe('report-missing');
  const rep = report('secret.md');
  chmodSync(rep, 0o000);
  const unread = receipt('rep-perm.json', { taskId: 'T1', attemptId: 'A1', status: 'reported', reportPath: rep });
  expect((await one('T1', 'A1', unread)).results[0].state).toBe('report-unreadable');
  chmodSync(rep, 0o644);
  const locked = receipt('locked.json', { taskId: 'T1', attemptId: 'A1', status: 'reported', reportPath: rep });
  chmodSync(locked, 0o000);
  const out = await one('T1', 'A1', locked);
  chmodSync(locked, 0o644);
  expect(out.results[0].state).toBe('permission');
  expect(inspectReceipt(locked).kind).not.toBe('missing');
});

test('迟到与超时', async () => {
  const target = join(dir, 'late.json');
  const run = one('T1', 'A1', target, { waitMs: 3000 });
  setTimeout(() => {
    writeFileSync(target, JSON.stringify({ taskId: 'T1', attemptId: 'A1', status: 'reported', reportPath: report() }));
  }, 120);
  const late = await run;
  expect(late.results[0].state).toBe('match');
  expect(late.results[0].late).toBe(true);
  const timeout = await one('T1', 'A1', join(dir, 'never.json'), { waitMs: 150 });
  expect(timeout.results[0].state).toBe('missing');
  expect(timeout.results[0].waited).toBe(true);
  expect(timeout.protocolComplete).toBe(false);
});

test('监听目录不存在：watch-error，不标 waited，不误报 missing', async () => {
  const gone = join(dir, 'no-such-dir', 'r.json');
  const out = await one('T1', 'A1', gone, { waitMs: 300 });
  expect(out.results[0].state).toBe('watch-error');
  expect(out.results[0].waited).toBeUndefined();
  expect(out.summary['watch-error']).toBe(1);
  expect(out.summary.missing).toBeUndefined();
});

test('监听运行错误：watch-error；正常超时才 waited', async () => {
  const target = join(dir, 'late-error.json');
  const fakeWatch = (d, cb) => ({ on: (ev, fn) => { if (ev === 'error') setTimeout(() => fn(new Error('EMFILE: too many open files')), 30); }, close() {} });
  const out = await one('T1', 'A1', target, { waitMs: 200, watchImpl: fakeWatch });
  expect(out.results[0].state).toBe('watch-error');
  expect(out.results[0].detail).toContain('EMFILE');
  expect(out.results[0].waited).toBeUndefined();
});

test('ok 仅表示协议完整；blocked/failed 不等于完成', async () => {
  const { p } = valid('blocked', { status: 'blocked' });
  const out = await one('T1', 'A1', p);
  expect(out.ok).toBe(true);
  expect(out.protocolComplete).toBe(true);
  expect(out.taskCompletion).toBe('not-evaluated');
  expect(out.attention).toEqual([{ taskId: 'T1', attemptId: 'A1', status: 'blocked' }]);
  const strict = await checkBatch([{ taskId: 'T1', attemptId: 'A1', file: p }], { requireStatus: true });
  expect(strict.ok).toBe(false);
  expect(strict.results[0].state).toBe('match');
});

test('报告根检查只提示，不扩大权限', async () => {
  const { p } = valid('inside');
  const outside = await checkBatch([{ taskId: 'T1', attemptId: 'A1', file: p }], { reportRoot: join(dir, 'sub') });
  expect(outside.results[0].state).toBe('match');
  expect(outside.results[0].warnings).toEqual(['report-outside-root']);
  const inside = await checkBatch([{ taskId: 'T1', attemptId: 'A1', file: p }], { reportRoot: dir });
  expect(inside.results[0].warnings).toBeUndefined();
});

test('参数解析拒绝相对路径、未知参数与坏状态选项', () => {
  expect(() => parseArgs(['--expect', 'T', 'A', 'rel.json'])).toThrow(/绝对路径/);
  expect(() => parseArgs(['--expect', 'T', 'A'])).toThrow(/3 个值/);
  expect(() => parseArgs(['--bogus'])).toThrow(/未知参数/);
  expect(() => parseArgs(['--expect', '/a', 'A', '/a/x', '--wait-ms', '0'])).toThrow(/1..60000/);
  expect(() => parseArgs(['--expect', '/a', 'A', '/a/x', '--require-status', 'blocked'])).toThrow(/reported/);
  expect(() => parseArgs(['--expect', '/a', 'A', '/a/x', '--report-root', 'rel'])).toThrow(/绝对目录/);
});

test('CLI：文件级软链入口不静默，退出码语义正确', async () => {
  const { p } = valid('cli');
  const link = join(dir, 'cli-link.mjs');
  symlinkSync(resolve(import.meta.dir, 'receipt-check.mjs'), link);
  const run = args => spawnSync(process.execPath, [link, ...args], { encoding: 'utf8' });
  const okRun = run(['--expect', 'T1', 'A1', p]);
  expect(okRun.status).toBe(0);
  expect(JSON.parse(okRun.stdout).ok).toBe(true);
  const badRun = run(['--expect', 'T1', 'A1', join(dir, 'none.json')]);
  expect(badRun.status).toBe(1);
  const usage = run([]);
  expect(usage.status).toBe(2);
  expect(JSON.parse(usage.stdout).error).toContain('用法');
});

test('协议与 wait-report 行为一致（有效/无效/缺失）', async () => {
  if (!WAIT_MODULE) throw new Error('WAIT_REPORT_MODULE 未设置；对照测试不得静默通过');
  let waitForReports;
  try { ({ waitForReports } = await import(WAIT_MODULE)); }
  catch (error) { throw new Error(`WAIT_REPORT_MODULE 不可读：${error.message}`); }
  const { p } = valid('parity');
  const live = await waitForReports([p], { timeoutMs: 500 });
  expect(live.reason).toBe('report');
  expect(live.taskId).toBe('T1');
  const bad = receipt('parity-bad.json', '{oops');
  const liveBad = await waitForReports([bad], { timeoutMs: 500 });
  expect(liveBad.reason).toBe('invalid-report');
  const liveMiss = await waitForReports([join(dir, 'absent.json')], { timeoutMs: 150 });
  expect(liveMiss.reason).toBe('timeout');
  expect((await one('T1', 'A1', p)).results[0].state).toBe('match');
  expect((await one('T1', 'A1', bad)).results[0].state).toBe('invalid-json');
  expect((await one('T1', 'A1', join(dir, 'absent.json'))).results[0].state).toBe('missing');
});
