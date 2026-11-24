// Probe: run the real CLI with a fake `rex` on PATH and check the real exit
// status, transport classification and timeout handling. No network, no Rex.
//
// Fixtures stay outside this skill directory: DISPATCH_TEST_TMP must be an
// existing absolute directory (a task tmp dir in the caller's project). Each
// run creates its own unique subdirectory there, so two concurrent runs never
// share a fake `rex`. Cleanup removes only that subdirectory.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';

const here = import.meta.dir;
const dispatchPath = `${here}/rex-dispatch.mjs`;

const TMP = process.env.DISPATCH_TEST_TMP;
if (!TMP || !isAbsolute(TMP)) throw new Error('DISPATCH_TEST_TMP 必须是绝对路径');
if (!statSync(TMP).isDirectory()) throw new Error('DISPATCH_TEST_TMP 必须是已存在的目录');

// Budgets: only the timeout case may use a tight budget. A cold first spawn of
// the fake CLI can take ~300 ms, so every other case needs headroom.
const BUDGET_MS = 2000;
const HANG_BUDGET_MS = 300;

const runRoot = mkdtempSync(join(TMP, 'rex-probe-'));
const binDir = join(runRoot, 'bin');
const taskDir = join(runRoot, 'task');
const fakeRex = join(binDir, 'rex');

beforeAll(() => {
  mkdirSync(binDir, { recursive: true });
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(fakeRex, `#!/bin/sh
case "$FAKE_REX_MODE" in
  exit3) echo 'Error: block target "x" not found' >&2; exit 3 ;;
  exit4) echo 'Error: connect failed' >&2; exit 4 ;;
  exit1) echo 'Error: invalid argument' >&2; exit 1 ;;
  notjson) echo 'not-json'; exit 0 ;;
  hang) sleep 5; echo '{}' ;;
  empty) exit 0 ;;
  *) echo '{}'; exit 0 ;;
esac
`, 'utf8');
  chmodSync(fakeRex, 0o755);
});

afterAll(() => {
  // Only this process's subdirectory. The caller's directory stays untouched.
  rmSync(runRoot, { recursive: true, force: true });
  expect(existsSync(runRoot)).toBe(false);
  expect(existsSync(TMP)).toBe(true);
});

function run(mode, extraEnv = {}) {
  const r = spawnSync(process.execPath, [
    dispatchPath,
    '--session', 'session:s', '--main', 'block:m',
    '--task-dir', taskDir, '--role', 'probe', '--task', '任务原文',
  ], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, FAKE_REX_MODE: mode, REX_DISPATCH_TIMEOUT_MS: String(BUDGET_MS), ...extraEnv },
  });
  let json;
  try { json = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { json = { parse_error: r.stdout, stderr: r.stderr }; }
  return { code: r.status, out: json, stderr: r.stderr };
}

test('fixture 用唯一子目录，不动调用方目录', () => {
  expect(runRoot.startsWith(TMP)).toBe(true);
  expect(runRoot.includes('rex-probe-')).toBe(true);
  expect(existsSync(binDir)).toBe(true);
  expect(existsSync(taskDir)).toBe(true);
  expect(existsSync(TMP)).toBe(true);
});

test('假 rex 退出码 3 → resource-not-found，退出码 3', () => {
  const r = run('exit3');
  expect(r.out.code).toBe('resource-not-found');
  expect(r.out.rex_exit).toBe(3);
  expect(r.out.classified_by).toBe('exit-code');
  expect(r.code).toBe(3);
  expect(r.out.instruction).toContain('不新建补偿资源');
});

test('假 rex 退出码 4 → server-unreachable，退出码 4', () => {
  const r = run('exit4');
  expect(r.out.code).toBe('server-unreachable');
  expect(r.out.rex_exit).toBe(4);
  expect(r.code).toBe(4);
});

test('假 rex 退出码 1 → rex-error，退出码 1，不冒充服务不可达', () => {
  const r = run('exit1');
  expect(r.out.code).toBe('rex-error');
  expect(r.out.rex_exit).toBe(1);
  expect(r.out.error).toContain('invalid argument');
  expect(r.code).toBe(1);
});

test('非 JSON 输出 → protocol-error', () => {
  const r = run('notjson');
  expect(r.out.code).toBe('protocol-error');
  expect(r.out.classified_by).toBe('protocol');
  expect(r.code).toBe(1);
});

test('超时 → timeout（预检阶段未创建），不报服务不可达', () => {
  const started = Date.now();
  const r = run('hang', { REX_DISPATCH_TIMEOUT_MS: String(HANG_BUDGET_MS) });
  const elapsed = Date.now() - started;
  expect(r.out.code).toBe('timeout');
  expect(r.out.classified_by).toBe('timeout');
  expect(r.out.status).toBe('precheck');
  expect(r.out.created).toEqual([]);
  expect(r.code).toBe(1);
  expect(elapsed).toBeLessThan(4000);
});

test('找不到 rex → cli-missing', () => {
  const r = run('empty', { PATH: '/nonexistent-path-for-probe' });
  expect(r.out.code).toBe('cli-missing');
  expect(r.out.classified_by).toBe('spawn');
  expect(r.code).toBe(1);
});

test('N4 非法超时环境变量：回退默认并输出 warnings，不崩溃', () => {
  const r = run('exit3', { REX_DISPATCH_TIMEOUT_MS: 'abc' });
  expect(r.out.code).toBe('resource-not-found');
  expect(Array.isArray(r.out.warnings)).toBe(true);
  expect(r.out.warnings[0]).toContain('REX_DISPATCH_TIMEOUT_MS=abc');
  expect(r.out.warnings[0]).toContain('回退 10000');
  expect(r.code).toBe(3);
});

test('N4 合法超时环境变量不产生 warnings', () => {
  const r = run('exit3', { REX_DISPATCH_TIMEOUT_MS: String(BUDGET_MS) });
  expect(r.out.code).toBe('resource-not-found');
  expect(r.out.warnings).toBeUndefined();
});
