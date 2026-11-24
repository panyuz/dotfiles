#!/usr/bin/env bun
// rex-dispatch.mjs — one entry for Rex same-screen agent dispatch.
//
// The caller registers resources (panes / work tabs of THIS task) and gives
// task/label/cwd. The script inspects the live layout, then mechanically picks
// rex-layout.mjs or rex-worktab.mjs and derives anchor/peer order, ratios and
// the full-tab decision. It never guesses a free pane, never moves or closes a
// resource, never reuses a tab by label, and never retries a creation.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { basename } from 'node:path';
import { addPane, plan } from './rex-layout.mjs';
import { addAgent, checkLayout, createWorktab, planWorktab, LABEL_PREFIX, MAX_PANES } from './rex-worktab.mjs';

const exec = promisify(execFile);

export { MAX_PANES, LABEL_PREFIX };

export const EXIT = {
  ok: 0,
  usage: 1,
  precheck: 1,
  'layout-mismatch': 1,
  'unregistered-pane': 1,
  'registered-pane-missing': 1,
  'label-conflict': 1,
  'duplicate-registration': 1,
  'cli-missing': 1,
  timeout: 1,
  'rex-error': 1,
  'protocol-error': 1,
  'unknown-error': 1,
  'resource-not-found': 3,
  'server-unreachable': 4,
  'status-unknown': 5,
  'needs-input': 6,
};

export const INSTRUCTION = {
  'server-unreachable': 'Rex 服务不可达（rex 退出码 4）：保留记录，报告状态未知，禁止重试',
  'resource-not-found': '目标不存在（rex 退出码 3）：停止，不新建补偿资源',
  'cli-missing': '找不到 rex 命令：检查 PATH 与安装，不自动安装',
  timeout: 'rex 调用超时：预检阶段未创建资源；核对实况后再决定，禁止盲重试',
  'rex-error': 'rex 返回非预期退出码：保留 stderr 与 rex_exit，按实况核对后再决定，禁止重试',
  'protocol-error': 'rex 输出不是 JSON：检查 rex 版本与参数，禁止按猜测继续',
  'unknown-error': '未知错误：按实况核对待决，禁止重试',
  usage: '补齐参数后重试；未创建资源',
  precheck: '实况与登记不符或布局未知：停止。未创建资源。核对实际资源后再决定',
  'layout-mismatch': '实况与登记不符或布局未知：停止。未创建资源。核对实际资源后再决定',
  'unregistered-pane': '实况与登记不符或布局未知：停止。未创建资源。核对实际资源后再决定',
  'registered-pane-missing': '实况与登记不符或布局未知：停止。未创建资源。核对实际资源后再决定',
  'label-conflict': '同名 tab 存在：标签不构成归属证明，不复用。核对后决定',
  'duplicate-registration': '同一资源被重复登记：修正登记后再试',
  'status-unknown': '创建已发出但结果不明：按已知坐标核对实际资源，禁止重试，禁止自动清理',
};

// Validate the Rex timeout once. Illegal values fall back to 10000 ms and are
// reported, never silently turned into NaN.
export function parseTimeout(raw, def = 10000) {
  if (raw === undefined || raw === null || raw === '') return { ms: def };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { ms: def, error: `REX_DISPATCH_TIMEOUT_MS=${String(raw)} 非法（需要正数毫秒）；已回退 ${def} ms` };
  }
  return { ms: Math.floor(n) };
}

const TIMEOUT = parseTimeout(process.env.REX_DISPATCH_TIMEOUT_MS);
const RE_TIMEOUT_MS = TIMEOUT.ms;
export const ENV_WARNINGS = TIMEOUT.error ? [TIMEOUT.error] : [];

const norm = id => String(id ?? '').replace(/^(session|window|block|layer|split|client):/, '');
export { norm };

function fail(code, message, extra = {}) {
  const e = new Error(message);
  e.code = code;
  e.exit = EXIT[code] ?? 1;
  Object.assign(e, extra);
  return e;
}

// Visual order of leaves: horizontal/vertical split renders before, then after.
export function visualOrder(layout) {
  if (!layout) return [];
  if (layout.split) return [...visualOrder(layout.split.before), ...visualOrder(layout.split.after)];
  return layout.block_id ? [layout.block_id] : [];
}

export function singleTiled(window) {
  const layers = window?.layers ?? [];
  if (layers.length !== 1 || layers[0].kind !== 'tiled') {
    throw fail('layout-mismatch', '目标 tab 图层未知（非单一 tiled）；停止，不改布局', { window_id: window?.window_id });
  }
  return layers[0];
}

// Map a Rex failure to a code using the real numeric exit status first.
// Text matching is only a last resort and is marked as such.
export function classify(e) {
  if (!e) return 'unknown-error';
  if (typeof e.code === 'string' && EXIT[e.code] !== undefined) return e.code;
  if (e.code === 'ENOENT') return 'cli-missing';
  if (e.code === 'ETIMEDOUT' || e.killed || e.signal === 'SIGTERM' || e.timedOut) return 'timeout';
  const n = typeof e.code === 'number' ? e.code : Number.NaN;
  if (Number.isInteger(n)) {
    if (n === 3) return 'resource-not-found';
    if (n === 4) return 'server-unreachable';
    return 'rex-error';
  }
  const text = String(e.stderr || e.message || '');
  if (/not found|no such|\u4e0d\u5b58\u5728|unknown (block|window)/i.test(text)) return 'resource-not-found';
  if (/timeout|timed out|ETIMEDOUT/i.test(text)) return 'timeout';
  return 'unknown-error';
}

function transportError(e, args) {
  const code = classify(e);
  const text = String(e.stderr || e.message || '').trim().slice(0, 300);
  const byText = typeof e.code !== 'number' && e.code !== 'ENOENT' && !e.killed && !e.signal && code !== 'protocol-error';
  return fail(code, `rex ${args[0]} 失败（${code}${typeof e.code === 'number' ? `, rex_exit=${e.code}` : ''}）：${text}`, {
    rex_exit: typeof e.code === 'number' ? e.code : undefined,
    classified_by: byText ? 'text' : 'exit-code',
    rex_args: args.slice(0, 2).join(' '),
  });
}

// Exported for tests: non-JSON output is a protocol error, not a network error.
export function parseRexStdout(stdout) {
  const s = String(stdout ?? '').trim();
  if (s === '') return { ok: true };
  try {
    return JSON.parse(s);
  } catch {
    throw fail('protocol-error', `rex 输出不是 JSON：${s.slice(0, 200)}`, { classified_by: 'protocol' });
  }
}

async function rexCall(args) {
  try {
    const { stdout } = await exec('rex', args, { timeout: RE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    return parseRexStdout(stdout);
  } catch (e) {
    if (e.code === 'protocol-error') throw e;
    throw transportError(e, args);
  }
}

function shapeOf(layer, ids, order) {
  if (order.length !== ids.length) throw fail('layout-mismatch', '布局树叶子数与 pane 清单不符；停止', { panes: ids, order });
  const extra = order.filter(k => !ids.includes(k));
  if (extra.length) throw fail('layout-mismatch', '布局树含清单外的 pane；停止', { extra });
  return true;
}

// Read live layout and decide the next mechanical step. No creation here.
export async function evaluate(o, call = rexCall) {
  if (!o.session) throw fail('usage', '缺少 --session');
  if (!o.main) throw fail('usage', '缺少 --main（主代理回报 block）');
  if (!o.taskDir || !String(o.taskDir).startsWith('/')) throw fail('usage', '缺少绝对 --task-dir');

  const view = await call(['session', 'inspect', o.session, '--json']);
  const sessionId = norm(view.session_id);
  if (sessionId !== norm(o.session)) throw fail('precheck', 'session 不一致；停止', { session_id: view.session_id });

  // Resolve the main block. Short IDs are accepted as registration input and
  // mapped to the live full ID; the live ID is what the Rex API receives.
  let mainBlock = null;
  try {
    mainBlock = (await call(['block', 'inspect', '-s', o.session, o.main, '--json']))?.block ?? null;
  } catch (e) {
    if (classify(e) !== 'resource-not-found') throw e;
  }
  if (!mainBlock) {
    for (const w of view.windows ?? []) {
      for (const b of (w.layers ?? []).flatMap(l => l.blocks ?? [])) {
        if (norm(b.block_id) === norm(o.main)) mainBlock = { block_id: b.block_id, window_id: w.window_id };
      }
    }
  }
  if (!mainBlock || norm(mainBlock.block_id) !== norm(o.main)) throw fail('resource-not-found', '回报 block 不存在；停止，不新建补偿资源', { main: o.main });
  // Raw IDs come from the live view: they are what the Rex API expects.
  const mainRaw = mainBlock.block_id;

  const mainWinKey = mainBlock.window_id;
  if (o.mainWindow && norm(o.mainWindow) !== norm(mainWinKey)) {
    throw fail('precheck', '--main 所在 tab 与 --main-window 不符；停止', { window_id: mainWinKey, main_window: o.mainWindow });
  }
  const mainWin = (view.windows ?? []).find(w => norm(w.window_id) === norm(mainWinKey));
  if (!mainWin) throw fail('resource-not-found', '主 tab 不存在；停止', { window_id: mainBlock.window_id });

  const layer = singleTiled(mainWin);
  const idsRaw = (layer.blocks ?? []).map(b => b.block_id);
  const orderRaw = visualOrder(layer.layout);
  const ids = idsRaw.map(norm);
  const order = orderRaw.map(norm);
  shapeOf(layer, ids, order);

  const registeredMain = new Set([norm(mainRaw), ...(o.panes ?? []).map(norm)]);
  const unregistered = ids.filter(k => !registeredMain.has(k));
  const missing = [...registeredMain].filter(k => !ids.includes(k));
  if (unregistered.length || missing.length) {
    const parts = [];
    if (unregistered.length) parts.push(`主 tab 存在未登记 pane：${unregistered.join(', ')}`);
    if (missing.length) parts.push(`登记的 pane 不在主 tab：${missing.join(', ')}`);
    throw fail(unregistered.length ? 'unregistered-pane' : 'registered-pane-missing', `${parts.join('；')}；停止，不移动、不关闭`, { window_id: mainWinKey, unregistered, missing });
  }

  const seen = new Set(ids);
  for (const [wk, paneKeys] of o.worktabs ?? new Map()) {
    for (const k of paneKeys) {
      if (seen.has(norm(k))) throw fail('duplicate-registration', `pane ${k} 重复登记；停止`, { pane: k });
      seen.add(norm(k));
    }
    if (norm(wk) === norm(mainWinKey)) throw fail('precheck', '登记的工作 tab 与主 tab 相同；停止', { window_id: wk });
  }

  const base = { sessionKey: view.session_id, mainKey: mainRaw, mainWindowKey: mainWinKey, focusBefore: view.active_window_id };

  if (ids.length < MAX_PANES) {
    if (!ids.includes(norm(mainRaw))) throw fail('registered-pane-missing', '主 pane 不在主 tab；停止', { window_id: mainWinKey });
    let p;
    try {
      p = plan(layer.layout, mainRaw, orderRaw.filter(k => norm(k) !== norm(mainRaw)));
    } catch (e) {
      throw fail('layout-mismatch', `主 tab 布局不是本脚本固定形态（${e.message}）；停止，不调整用户布局`, { window_id: mainWinKey, panes: ids, order });
    }
    return { ...base, mode: 'main', windowKey: mainWinKey, label: o.label, panes: ids, order, orderRaw, capacity: MAX_PANES - ids.length, plan: p };
  }
  if (ids.length > MAX_PANES) throw fail('layout-mismatch', `主 tab 有 ${ids.length} 个 pane，超出固定形态；停止`, { window_id: mainWinKey, panes: ids });

  for (const [wk, paneKeys] of o.worktabs ?? new Map()) {
    const w = (view.windows ?? []).find(x => norm(x.window_id) === norm(wk));
    if (!w) throw fail('resource-not-found', `登记的工作 tab 不存在：${wk}；停止`, { window_id: wk });
    if (!String(w.label ?? '').startsWith(LABEL_PREFIX)) throw fail('precheck', `工作 tab 标签不以 ${LABEL_PREFIX} 开头；拒绝修改`, { window_id: wk, label: w.label });
    const l = singleTiled(w);
    const widsRaw = (l.blocks ?? []).map(b => b.block_id);
    const worderRaw = visualOrder(l.layout);
    const wids = widsRaw.map(norm);
    const worder = worderRaw.map(norm);
    shapeOf(l, wids, worder);
    const wun = wids.filter(k => !paneKeys.has(norm(k)));
    const wmiss = [...paneKeys].filter(k => !wids.includes(norm(k)));
    if (wun.length || wmiss.length) {
      const wparts = [];
      if (wun.length) wparts.push(`工作 tab ${wk} 存在未登记 pane：${wun.join(', ')}`);
      if (wmiss.length) wparts.push(`登记的 pane 不在工作 tab ${wk}：${wmiss.join(', ')}`);
      throw fail(wun.length ? 'unregistered-pane' : 'registered-pane-missing', `${wparts.join('；')}；停止，不改布局`, { window_id: wk, unregistered: wun, missing: wmiss });
    }
    if (wids.length >= MAX_PANES) continue;
    const derived = wids.length === 1
      ? { anchor: worderRaw[0], peers: [] }
      : wids.length === 2
        ? { anchor: worderRaw[1], peers: [worderRaw[0]] }
        : { anchor: worderRaw[2], peers: [worderRaw[0], worderRaw[1]] };
    try {
      planWorktab(l.layout, derived.anchor, derived.peers);
      checkLayout(l.layout, derived.anchor, derived.peers);
    } catch (e) {
      throw fail('layout-mismatch', `工作 tab ${wk} 不是固定形态（${e.message}）；停止，不改布局`, { window_id: wk, panes: wids, order: worder });
    }
    return { ...base, mode: 'worktab-add', windowKey: w.window_id, windowLabel: w.label, label: o.label, panes: wids, order: worder, capacity: MAX_PANES - wids.length, plan: { ...derived, direction: wids.length === 1 ? 'right' : 'below', ratio: 50 } };
  }

  const label = o.label;
  const sameLabel = (view.windows ?? []).filter(w => w.label === label && norm(w.window_id) !== norm(mainWinKey));
  if (sameLabel.length) {
    throw fail('label-conflict', `已存在同名 tab：${label}；标签不构成归属证明，不自动复用`, { label, candidates: sameLabel.map(w => w.window_id) });
  }
  return { ...base, mode: 'worktab-create', windowKey: null, label, panes: [], order: [], capacity: MAX_PANES - 1, plan: { label } };
}

export const DEFAULT_PI_ARGS = ['--model', 'magpie/auto/deepseek-flash', '--thinking', 'high'];

export const RESERVED_PI_FLAGS = ['--name'];

const flagName = a => String(a).split('=')[0];

// --name 由 --label 决定；调用方不能通过 --arg 再指定一次。
export function rejectReservedArgs(args = []) {
  for (const a of args) {
    if (RESERVED_PI_FLAGS.includes(flagName(a))) {
      throw fail('usage', `--arg 不可指定保留旗标 ${flagName(a)}：名称由 --label 决定`, { reserved_flag: flagName(a) });
    }
  }
}

// Default Pi flags stay unless the caller passes the same flag name.
export function mergeArgs(defaults, extra = []) {
  const overridden = new Set(extra.filter(a => String(a).startsWith('--')).map(flagName));
  const out = [];
  for (let i = 0; i < defaults.length; i += 2) {
    if (!overridden.has(defaults[i])) out.push(defaults[i], defaults[i + 1]);
  }
  return [...out, ...extra];
}

export function requestedFlags(argv) {
  const r = {};
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--model' && argv[i + 1] !== undefined) r.model = String(argv[i + 1]);
    else if (a.startsWith('--model=')) r.model = a.slice(8);
    else if (a === '--thinking' && argv[i + 1] !== undefined) r.thinking = String(argv[i + 1]);
    else if (a.startsWith('--thinking=')) r.thinking = a.slice(11);
  }
  return r;
}

export function buildCommand(o, label) {
  if (o.command?.length) return o.command;
  if (!o.task) throw fail('usage', '缺少 --task 或 -- COMMAND...（首任务内容原样传给新进程）');
  const proc = o.proc ?? 'pi';
  rejectReservedArgs(o.args ?? []);
  const base = [proc, '--name', label];
  // Judge by basename: an absolute path to the same Pi binary keeps defaults.
  if (basename(proc) === 'pi') base.push(...mergeArgs(DEFAULT_PI_ARGS, o.args ?? []));
  else base.push(...(o.args ?? []));
  return [...base, o.task];
}

function nextAction(mode, capacityLeft) {
  if (capacityLeft > 0) return mode === 'main' ? 'dispatch-main' : 'dispatch-worktab-add';
  return 'dispatch-worktab-create';
}

// Create one agent pane / tab. Never retries. Returns known IDs on doubt.
export async function dispatch(o, call = rexCall) {
  let st;
  try {
    st = await evaluate(o, call);
  } catch (e) {
    const code = classify(e);
    return {
      ok: false,
      status: 'precheck',
      code,
      stage: 'precheck',
      error: e.message,
      ...pick(e, ['session_id', 'window_id', 'main', 'panes', 'order', 'unregistered', 'missing', 'pane', 'label', 'candidates', 'extra']),
      ...failureMeta(e),
      created: [],
      ...(ENV_WARNINGS.length ? { warnings: ENV_WARNINGS } : {}),
      instruction: INSTRUCTION[code] ?? INSTRUCTION.precheck,
    };
  }

  const command = (() => { try { return buildCommand(o, st.label); } catch (e) { return e; } })();
  if (command instanceof Error) return { ok: false, status: 'precheck', code: 'usage', stage: 'usage', error: command.message, created: [], ...(ENV_WARNINGS.length ? { warnings: ENV_WARNINGS } : {}), instruction: INSTRUCTION.usage };

  // Track whether a creation call started: after that point any doubt is
  // "status unknown", never a retry, and never an automatic cleanup.
  let createStarted = false;
  const guarded = async a => {
    if (a[0] === 'split' || a[0] === 'window') createStarted = true;
    return call(a);
  };

  let out;
  try {
    if (st.mode === 'main') {
      out = await addPane({ session: st.sessionKey, main: st.mainKey, peers: (st.orderRaw ?? []).filter(k => norm(k) !== norm(st.mainKey)), cwd: o.taskDir, label: st.label, command }, guarded);
    } else if (st.mode === 'worktab-add') {
      out = await addAgent({ session: st.sessionKey, main: st.mainKey, window: st.windowKey, anchor: st.plan.anchor, peers: st.plan.peers, label: st.label, cwd: o.taskDir, command }, guarded);
    } else {
      out = await createWorktab({ session: st.sessionKey, main: st.mainKey, label: st.label, cwd: o.taskDir, command }, guarded);
    }
  } catch (e) {
    const code = createStarted ? 'status-unknown' : classify(e);
    return {
      ok: false,
      status: createStarted ? 'unknown' : 'precheck',
      code,
      stage: createStarted ? 'create' : 'precheck',
      mode: st.mode,
      error: e.message,
      ...failureMeta(e),
      session_id: st.sessionKey,
      window_id: st.windowKey ?? undefined,
      report_block: st.mainKey,
      task_dir: o.taskDir,
      label: st.label,
      focus_before: st.focusBefore,
      created: [],
      ...(ENV_WARNINGS.length ? { warnings: ENV_WARNINGS } : {}),
      instruction: createStarted
        ? INSTRUCTION['status-unknown']
        : (INSTRUCTION[code] ?? INSTRUCTION.precheck),
    };
  }

  if (!out || out.ok !== true) {
    const unknown = out?.status === 'unknown' || out?.stage === 'post_create';
    const code = unknown ? 'status-unknown' : (EXIT[out?.code] !== undefined ? out.code : 'precheck');
    return {
      ok: false,
      status: unknown ? 'unknown' : 'precheck',
      code,
      stage: out?.stage ?? 'create',
      mode: st.mode,
      error: out?.error ?? '未知失败',
      ...pick(out, ['rex_exit', 'classified_by', 'rex_args']),
      session_id: out?.session_id ?? st.sessionKey,
      window_id: out?.window_id ?? st.windowKey ?? undefined,
      block_id: out?.block_id,
      anchor: out?.anchor ?? out?.anchor_id ?? st.plan?.anchor,
      report_block: st.mainKey,
      task_dir: o.taskDir,
      label: st.label,
      focus_before: out?.focus_before ?? st.focusBefore,
      created: out?.block_id ? [{ block_id: out.block_id, window_id: out.window_id ?? null, state: 'unknown' }] : [],
      ...(ENV_WARNINGS.length ? { warnings: ENV_WARNINGS } : {}),
      instruction: out?.instruction ?? INSTRUCTION[code] ?? INSTRUCTION.precheck,
    };
  }

  // Success: confirm focus and final pane count from a fresh inspect.
  let focus = out.focus;
  let panes = out.panes;
  try {
    const after = await call(['session', 'inspect', st.sessionKey, '--json']);
    const winKey = out.window_id ?? st.windowKey;
    const w = (after.windows ?? []).find(x => norm(x.window_id) === norm(winKey));
    panes = w ? (w.layers?.[0]?.blocks ?? []).length : panes;
    focus = { before: st.focusBefore, after: after.active_window_id, changed: norm(after.active_window_id) !== norm(st.focusBefore) };
  } catch { focus = { ...(focus ?? {}), observed: false }; }

  const capacityLeft = Math.max(0, MAX_PANES - (panes ?? 1));
  return {
    ok: true,
    status: 'created',
    code: 'ok',
    mode: st.mode,
    session_id: st.sessionKey,
    window_id: out.window_id ?? st.windowKey,
    block_id: out.block_id,
    anchor: out.anchor_id ?? st.plan?.anchor,
    report_block: st.mainKey,
    task_dir: o.taskDir,
    label: st.label,
    panes: panes ?? null,
    capacity_left: capacityLeft,
    next_action: nextAction(st.mode, capacityLeft),
    focus: focus ?? null,
    created: [{ block_id: out.block_id, window_id: out.window_id ?? st.windowKey, state: 'verified' }],
    requested: requestedFlags(command),
    verify_after_start: requestedFlags(command).model ? '按输出 requested 核对实际 provider/model 与 thinking；启动后仍需独立核对进程内状态' : undefined,
    ...(ENV_WARNINGS.length ? { warnings: ENV_WARNINGS } : {}),
    layout: out.layout ?? null,
  };
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o?.[k] !== undefined) r[k] = o[k];
  return r;
}

// Report how a failure was classified: real exit code first, text last.
function failureMeta(e) {
  const code = classify(e);
  if (typeof e?.code === 'number') return { rex_exit: e.code, classified_by: 'exit-code' };
  if (code === 'timeout') return { classified_by: 'timeout' };
  if (code === 'cli-missing') return { classified_by: 'spawn' };
  if (code === 'protocol-error') return { classified_by: 'protocol' };
  if (e?.classified_by) return { classified_by: e.classified_by, rex_exit: e.rex_exit };
  if (code === 'resource-not-found' || code === 'unknown-error') return { classified_by: 'text' };
  return { classified_by: 'own' };
}

export const USAGE = `rex-dispatch.mjs — Rex 同屏派发（机械布局）

用法：
  bun rex-dispatch.mjs --session ID --main BLOCK --task-dir PATH --role TEXT \\
       [--task TEXT] [--pane BLOCK ...] [--worktab WINDOW ...] \\
       [--worktab-pane WINDOW=BLOCK ...] [--label TEXT] [--proc EXE] \\
       [--arg VALUE ...] [-- COMMAND ARG...]

必填：
  --session ID         Rex session ID（可用 $REX_SESSION）
  --main BLOCK         主代理回报 block ID（可用 $REX_BLOCK）
  --task-dir PATH      新代理的绝对 cwd（一般为任务目录）
  --role TEXT          职责摘要。默认标签为 "🐙sub｜<职责>"

首任务二选一：
  --task TEXT          原样作为最后一个参数传给新进程（不推断内容）
  -- COMMAND ARG...    显式完整命令；给出后忽略 --task/--proc/--arg

本任务资源登记（只登记，不猜测）：
  --pane BLOCK         主 tab 内已登记的代理 pane，可重复
  --worktab WINDOW     已登记的工作 tab，可重复；顺序即优先顺序
  --worktab-pane W=B   该工作 tab 内已登记的 pane，可重复

可选：
  --label TEXT         显式标签（默认 "🐙sub｜<职责>"）
  --proc EXE           新进程可执行文件（默认 pi）
  --arg VALUE          附加给新进程的参数，可重复；值可以以 -- 开头
                       例：--arg --model --arg X 覆盖默认模型
  --main-window W      断言 --main 所在 tab 为该 window，可省略
  --help               显示本说明

默认模型（仅 proc=pi）：--model magpie/auto/deepseek-flash --thinking high
  同名旗标由 --arg 覆盖。输出 requested{model,thinking} 是请求值，
  启动后实际 provider/model 仍需独立核对。

行为：
  读实况布局 → 校验登记 → 选路径 → 创建 1 个 pane。脚本自己推导
  anchor/peer 顺序与固定比例（50/50、右侧三等分、主 42%/右 58%）。
  主 tab 未满用 rex-layout；满 4 pane 后改用已登记且有空位的工作 tab；
  已登记工作 tab 全满才新建工作 tab。绝不按标签认领 tab。

退出码（按 rex 真实退出码分类）：
  0 成功
  1 usage / precheck / 布局或登记不符 / rex 退出码非 3、4 / 找不到 rex（cli-missing）
    / 超时（timeout）/ 非 JSON 输出（protocol-error）
  3 目标不存在        4 Rex 服务不可达（rex 退出码 4）
  5 创建后状态未知（返回已知 ID，禁止重试）    6 需要人工输入
`;

export function parseArgs(args) {
  const o = { panes: [], worktabs: new Map(), args: [], command: [] };
  const sep = args.indexOf('--');
  const head = sep < 0 ? args : args.slice(0, sep);
  if (sep >= 0) o.command = args.slice(sep + 1);
  for (let i = 0; i < head.length; i += 2) {
    const k = head[i];
    if (k === '--help' || k === '-h') { o.help = true; i -= 1; continue; }
    const v = head[i + 1];
    const valueMayStartWithDash = k === '--arg';
    if (v === undefined || (v.startsWith('--') && !valueMayStartWithDash)) throw fail('usage', `参数缺少值：${k}`);
    if (k === '--session') o.session = v;
    else if (k === '--main') o.main = v;
    else if (k === '--main-window') o.mainWindow = v;
    else if (k === '--task-dir') o.taskDir = v;
    else if (k === '--role') o.role = v;
    else if (k === '--task') o.task = v;
    else if (k === '--label') o.label = v;
    else if (k === '--proc') o.proc = v;
    else if (k === '--arg') { rejectReservedArgs([v]); o.args.push(v); }
    else if (k === '--pane') {
      if (o.panes.some(p => norm(p) === norm(v))) throw fail('duplicate-registration', `同一 pane 重复登记：${v}；修正登记后再试`, { pane: v });
      if (o.worktabs.size && [...o.worktabs.values()].some(s => s.has(norm(v)))) throw fail('duplicate-registration', `pane ${v} 重复登记：同时属于主 tab 与工作 tab`);
      o.panes.push(v);
    }
    else if (k === '--worktab') { if (!o.worktabs.has(norm(v))) o.worktabs.set(norm(v), new Set()); }
    else if (k === '--worktab-pane') {
      const [w, b] = String(v).split('=');
      if (!w || !b) throw fail('usage', '--worktab-pane 需要 WINDOW=BLOCK');
      if (o.panes.some(p => norm(p) === norm(b))) throw fail('duplicate-registration', `pane ${b} 重复登记：同时属于主 tab 与工作 tab`);
      const wk = norm(w);
      if (!o.worktabs.has(wk)) o.worktabs.set(wk, new Set());
      if (o.worktabs.get(wk).has(norm(b))) throw fail('duplicate-registration', `同一工作 tab pane 重复登记：${b}`);
      o.worktabs.get(wk).add(norm(b));
    } else throw fail('usage', `未知参数：${k}`);
  }
  if (o.help) return o;
  o.label = o.label ?? (o.role ? `${LABEL_PREFIX}｜${o.role}` : undefined);
  if (!o.label) throw fail('usage', '缺少 --role 或 --label');
  return o;
}

async function main(args) {
  let o;
  try { o = parseArgs(args); } catch (e) {
    console.log(JSON.stringify({ ok: false, code: e.code, error: e.message, usage: 'bun rex-dispatch.mjs --help' }));
    process.exitCode = e.exit ?? 1; return;
  }
  if (o.help) { process.stdout.write(USAGE); process.exitCode = 0; return; }
  const out = await dispatch(o);
  console.log(JSON.stringify(out));
  process.exitCode = out.ok ? 0 : (EXIT[out.code] ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => {
    console.log(JSON.stringify({ ok: false, code: e.code ?? 'precheck', error: e.message, instruction: '核对实际资源后再决定下一步；禁止重试' }));
    process.exitCode = e.exit ?? 1;
  });
}
