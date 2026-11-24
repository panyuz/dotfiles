#!/usr/bin/env bun
// rex-worktab.mjs — create a separate agent work tab, or add one more agent pane
// inside it. Creates/appends only; never closes anything.
// Never touches existing user tabs; never reuses panes of unknown state.
// All rex CLI arguments are passed itemized (no shell string).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);

export const MAX_PANES = 4;
export const LABEL_PREFIX = '🐙sub';

const near = (a, b, tol = 0.02) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// Validate the exact layout this script builds. Unknown shapes are refused.
export function checkLayout(layout, anchor, peers) {
  if (!anchor) throw Error('缺少锚点 pane');
  if (new Set([anchor, ...peers]).size !== peers.length + 1) throw Error('pane ID 缺失或重复');
  if (peers.length + 2 > MAX_PANES) throw Error(`本 tab 已达 ${MAX_PANES} pane 上限`);
  if (peers.length === 0) {
    if (layout?.block_id !== anchor || layout?.split) throw Error('工作 tab 不是单 pane 全屏布局；拒绝修改');
    return;
  }
  const root = layout?.split;
  if (peers.length === 1) {
    if (root?.direction !== 'horizontal' || !near(root.ratio, 0.5)) throw Error('两 pane 布局不是水平 50/50；拒绝修改');
    if (root.before?.block_id !== peers[0] || root.before?.split || root.after?.block_id !== anchor || root.after?.split) throw Error('两 pane 的 pane 清单或形状不符');
    return;
  }
  if (peers.length === 2) {
    if (root?.direction !== 'horizontal' || !near(root.ratio, 0.5)) throw Error('三 pane 布局根分割不是水平 50/50；拒绝修改');
    if (root.before?.block_id !== peers[0] || root.before?.split) throw Error('三 pane 左列不是单个 pane');
    const right = root.after?.split;
    if (right?.direction !== 'vertical' || !near(right.ratio, 0.5)) throw Error('三 pane 右列不是垂直 50/50；拒绝修改');
    if (root.after?.block_id || right.before?.block_id !== peers[1] || right.before?.split || right.after?.block_id !== anchor || right.after?.split) throw Error('三 pane 的 pane 清单或形状不符');
    return;
  }
  throw Error('超过本脚本支持的三 pane 基础布局');
}

// Plan the next split inside an agent work tab.
export function planWorktab(layout, anchor, peers) {
  checkLayout(layout, anchor, peers);
  if (peers.length === 0) return { anchor, direction: 'right', ratio: 50 };
  if (peers.length === 1) return { anchor, direction: 'below', ratio: 50 };
  return { anchor, direction: 'below', ratio: 50, rebalance: [
    { before_block_id: peers[1], after_block_id: anchor, direction: 'vertical', ratio: 1 / 3 },
    { before_block_id: peers[0], after_block_id: peers[1], direction: 'horizontal', ratio: 0.42 },
  ] };
}

export function checkFinalLayout(layout, anchor, peers, child) {
  if (peers.length === 0) {
    if (!near(layout?.split?.ratio, 0.5) || layout.split.direction !== 'horizontal' || layout.split.before?.block_id !== anchor || layout.split.after?.block_id !== child) throw Error('两 pane 最终布局不符');
    return;
  }
  if (peers.length === 1) {
    const r = layout?.split;
    if (!r || r.direction !== 'horizontal' || !near(r.ratio, 0.5) || r.before?.block_id !== peers[0] || r.after?.split?.direction !== 'vertical' || !near(r.after.split.ratio, 0.5) || r.after.split.before?.block_id !== anchor || r.after.split.after?.block_id !== child) throw Error('三 pane 最终布局不符');
    return;
  }
  const r = layout?.split;
  const right = r?.after?.split;
  if (!r || r.direction !== 'horizontal' || !near(r.ratio, 0.42) || r.before?.block_id !== peers[0]) throw Error('四 pane 根分割不符');
  if (!right || right.direction !== 'vertical' || !near(right.ratio, 1 / 3) || right.before?.block_id !== peers[1]) throw Error('四 pane 右列比例不符');
  const inner = right.after?.split;
  if (!inner || inner.direction !== 'vertical' || !near(inner.ratio, 0.5) || inner.before?.block_id !== anchor || inner.after?.block_id !== child) throw Error('四 pane 末层不符');
}

async function rex(args) {
  try {
    const { stdout } = await exec('rex', args, { timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    return stdout.trim() === '' ? { ok: true } : JSON.parse(stdout);
  } catch (e) {
    const err = Error(`rex 失败（${e.code ?? 'unknown'}）：${String(e.stderr || e.message).trim().slice(0, 300)}`);
    err.unknown = true;
    throw err;
  }
}

async function inspectSession(session, call) {
  const view = await call(['session', 'inspect', session, '--json']);
  if (view.session_id !== session) throw Error('session 不一致');
  return view;
}

function tiledLayer(window) {
  const layers = window?.layers ?? [];
  if (layers.length !== 1 || layers[0].kind !== 'tiled') throw Error('目标 tab 图层未知（非单一 tiled）；拒绝修改');
  return layers[0];
}

function findWindow(view, windowId) {
  const w = view.windows?.find(x => x.window_id === windowId);
  if (!w) throw Error('找不到目标 tab；状态未知');
  return w;
}

function unknown(stage, msg, extra) {
  return { ok: false, status: 'unknown', stage, ...extra, error: msg, instruction: '状态未知：按已知坐标核对实际资源，禁止重试或自动清理' };
}

// Create a new work tab whose first pane runs the first agent task.
export async function createWorktab({ session, main, label, cwd, command }, call = rex) {
  if (!session || !main || !label || !cwd?.startsWith('/') || !command?.length) throw Error('缺少 session、回报 block、标签、绝对 cwd 或命令');
  if (!label.startsWith(LABEL_PREFIX)) throw Error(`工作 tab 标签必须以 ${LABEL_PREFIX} 开头`);
  const view = await inspectSession(session, call);
  const mainBlock = (await call(['block', 'inspect', '-s', session, main, '--json']))?.block;
  if (mainBlock?.block_id !== main) throw Error('回报 block 不存在');
  const mainWindow = mainBlock.window_id;
  findWindow(view, mainWindow);
  if (view.windows?.some(w => w.label === label)) return { ok: false, status: 'precheck', stage: 'precheck', error: `已存在同名 tab：${label}；不自动复用未知 tab`, report_block: main };
  const focusBefore = view.active_window_id;
  let created;
  try {
    created = await call(['window', 'new', label, '-s', session, '-c', cwd, '--focus=false', '--json', '--', ...command]);
  } catch (e) {
    return unknown('create', e.message, { session_id: session, report_block: main, label, cwd, focus_before: focusBefore });
  }
  const windowId = created?.window_id;
  if (!windowId) return unknown('create', '创建结果缺少 window_id', { session_id: session, report_block: main, label, focus_before: focusBefore });
  // From here the tab exists. Any doubt means "unknown", never retry.
  try {
    const after = await inspectSession(session, call);
    const w = findWindow(after, windowId);
    const layer = tiledLayer(w);
    const blockId = layer.blocks?.[0]?.block_id;
    if (!blockId || (layer.blocks?.length ?? 0) !== 1) throw Error('新 tab 的 pane 数不是 1');
    if (w.label !== label) throw Error('新 tab 标签与请求不符');
    if (windowId === mainWindow) throw Error('新 tab 与主 tab 相同');
    checkLayout(layer.layout, blockId, []);
    const focusAfter = after.active_window_id;
    return { ok: true, session_id: session, window_id: windowId, block_id: blockId, report_block: main, main_window_id: mainWindow, panes: 1, layout: layer.layout, focus: { before: focusBefore, after: focusAfter, changed: focusBefore !== focusAfter } };
  } catch (e) {
    return unknown('post_create', e.message, { session_id: session, window_id: windowId, report_block: main, main_window_id: mainWindow, focus_before: focusBefore });
  }
}

// Add one more agent pane to an existing work tab. peers must list every other pane.
export async function addAgent({ session, main, window, anchor, peers, label, cwd, command }, call = rex) {
  if (!session || !main || !window || !anchor || !label || !cwd?.startsWith('/') || !command?.length) throw Error('缺少 session、回报 block、window、锚点、标签、绝对 cwd 或命令');
  const view = await inspectSession(session, call);
  const mainBlock = (await call(['block', 'inspect', '-s', session, main, '--json']))?.block;
  if (mainBlock?.block_id !== main) throw Error('回报 block 不存在');
  const mainWindow = mainBlock.window_id;
  const w = findWindow(view, window);
  if (window === mainWindow) throw Error('拒绝修改主代理 tab；工作 tab 必须与主 tab 不同');
  if (!w.label.startsWith(LABEL_PREFIX)) throw Error(`目标 tab 标签不以 ${LABEL_PREFIX} 开头；拒绝修改`);
  const layer = tiledLayer(w);
  const ids = layer.blocks?.map(b => b.block_id) ?? [];
  if (ids.length !== peers.length + 1 || ids.some(id => ![anchor, ...peers].includes(id))) throw Error('存在未登记 pane 或数量不符；拒绝修改');
  const p = planWorktab(layer.layout, anchor, peers);
  if (p.rebalance) {
    const api = await call(['api', 'describe', 'session.resize_pane', '--json']);
    const schema = api.input_schema;
    const fields = ['session_id', 'direction', 'before_block_id', 'after_block_id', 'ratio'];
    if (api.name !== 'session.resize_pane' || !fields.every(k => schema?.required?.includes(k)) || schema.properties?.ratio?.type !== 'number' || !['vertical', 'horizontal'].every(d => schema.properties?.direction?.enum?.includes(d))) throw Error('resize API schema 不兼容；拒绝调整');
  }
  const focusBefore = view.active_window_id;
  let created;
  try {
    created = await call(['split', '-s', session, '-b', p.anchor, `--split=${p.direction}`, '--ratio', String(p.ratio), '--focus=false', '--label', label, '--json', '-c', cwd, '--', ...command]);
  } catch (e) {
    return unknown('create', e.message, { session_id: session, window_id: window, anchor: p.anchor, report_block: main, peers, focus_before: focusBefore });
  }
  const child = created.block_ids?.[0];
  try {
    if (!child) throw Error('创建结果缺少 block ID');
    if (p.rebalance) for (const resize of p.rebalance) await call(['api', 'call', '-s', session, 'session.resize_pane', JSON.stringify(resize)]);
    const finalView = await inspectSession(session, call);
    const finalWindow = findWindow(finalView, window);
    const done = tiledLayer(finalWindow);
    const blocks = done.blocks?.map(b => b.block_id) ?? [];
    if (blocks.length !== peers.length + 2 || ![anchor, ...peers, child].every(id => blocks.includes(id))) throw Error('最终 pane 清单不符');
    checkFinalLayout(done.layout, anchor, peers, child);
    const focusAfter = finalView.active_window_id;
    return { ok: true, session_id: session, window_id: window, block_id: child, anchor_id: p.anchor, report_block: main, panes: blocks.length, layout: done.layout, focus: { before: focusBefore, after: focusAfter, changed: focusBefore !== focusAfter } };
  } catch (e) {
    return unknown('post_create', e.message, { session_id: session, window_id: window, anchor: p.anchor, block_id: child ?? null, report_block: main, peers, focus_before: focusBefore });
  }
}

export function parseArgs(args) {
  const usage = '用法：rex-worktab.mjs --mode create|add ... -- COMMAND...';
  if (args[0] !== '--mode') throw Error(`缺少 --mode 首参数。${usage}`);
  if (!['create', 'add'].includes(args[1])) throw Error(`--mode 必须是 create 或 add。${usage}`);
  const sep = args.indexOf('--');
  if (sep < 0) throw Error(usage);
  const o = { mode: args[1], peers: [], command: args.slice(sep + 1) };
  for (let i = 2; i < sep; i += 2) {
    const k = args[i], v = args[i + 1];
    if (!v || v.startsWith('--')) throw Error(`参数缺少值：${k}`);
    if (k === '--peer') o.peers.push(v);
    else if (k === '--session') o.session = v;
    else if (k === '--main') o.main = v;
    else if (k === '--window') o.window = v;
    else if (k === '--anchor') o.anchor = v;
    else if (k === '--label') o.label = v;
    else if (k === '--cwd') o.cwd = v;
    else throw Error(`未知参数：${k}`);
  }
  return o;
}

async function main(args) {
  const o = parseArgs(args);
  let out;
  if (o.mode === 'create') out = await createWorktab(o);
  else if (o.mode === 'add') out = await addAgent(o);
  else throw Error(`未知模式：${o.mode}；本脚本不关闭资源`);
  console.log(JSON.stringify(out));
  if (!out.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(e => { console.log(JSON.stringify({ ok: false, status: e.unknown ? 'unknown' : 'precheck', error: e.message, instruction: e.unknown ? '按已知坐标核对实际资源，禁止重试' : '修正参数后重试;未创建资源' })); process.exitCode = 1; });
