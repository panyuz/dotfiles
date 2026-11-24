#!/usr/bin/env bun
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);

// Accept only the precise layout built by this script; never rearrange unknown panes.
export function plan(layout, main, peers) {
  if (!main || new Set([main, ...peers]).size !== peers.length + 1) throw Error('pane ID 缺失或重复');
  if (peers.length > 2) throw Error('本 tab 已达四 pane 上限');
  if (peers.length === 0) {
    if (layout?.block_id !== main) throw Error('主 pane 不是单独布局；拒绝修改');
    return { anchor: main, direction: 'right', ratio: 50 };
  }
  const root = layout?.split;
  if (root?.direction !== 'horizontal' || root.before?.block_id !== main || !Number.isFinite(root.ratio) || Math.abs(root.ratio - 0.5) > 0.02) throw Error('主 pane 不在左侧或比例不符；拒绝修改');
  const right = root.after;
  if (peers.length === 1) {
    if (right?.block_id !== peers[0]) throw Error('右侧 pane 与登记不符');
    return { anchor: peers[0], direction: 'below', ratio: 50 };
  }
  if (right?.split?.direction !== 'vertical' || !Number.isFinite(right.split.ratio) || Math.abs(right.split.ratio - 0.5) > 0.02 || right.split.before?.block_id !== peers[0] || right.split.after?.block_id !== peers[1]) throw Error('右侧布局与登记不符');
  return { anchor: peers[1], direction: 'below', ratio: 50, rebalance: [
    { before_block_id: peers[0], after_block_id: peers[1], direction: 'vertical', ratio: 1 / 3 },
    { before_block_id: main, after_block_id: peers[0], direction: 'horizontal', ratio: 0.42 },
  ] };
}

async function rex(args) {
  try {
    const { stdout } = await exec('rex', args, { timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (e) { throw Error(`rex 失败（${e.code ?? 'unknown'}）：${String(e.stderr || e.message).trim().slice(0, 300)}`); }
}

export async function addPane({ session, main, peers, cwd, label, command }, call = rex) {
  if (!session || !main || !cwd?.startsWith('/') || !label || !command?.length) throw Error('缺少 session、主 pane、绝对 cwd、标签或命令');
  const [view, inspected] = await Promise.all([
    call(['session', 'inspect', session, '--json']),
    call(['block', 'inspect', '-s', session, main, '--json']),
  ]);
  const windowId = inspected.block?.window_id;
  const window = view.windows?.find(w => w.window_id === windowId);
  if (view.session_id !== session || inspected.block?.block_id !== main || !window || window.layers?.length !== 1 || window.layers[0].kind !== 'tiled') throw Error('主 pane、窗口或图层不明确');
  const layer = window.layers[0];
  const ids = layer.blocks?.map(b => b.block_id) ?? [];
  if (ids.length !== peers.length + 1 || ids.some(id => ![main, ...peers].includes(id))) throw Error('存在未登记 pane 或数量不符');
  const p = plan(layer.layout, main, peers);
  // A third peer needs a documented resize API; validate schema before creating.
  if (p.rebalance) {
    const api = await call(['api', 'describe', 'session.resize_pane', '--json']);
    const schema = api.input_schema;
    const fields = ['session_id', 'direction', 'before_block_id', 'after_block_id', 'ratio'];
    if (api.name !== 'session.resize_pane' || !fields.every(k => schema?.required?.includes(k)) || schema.properties?.ratio?.type !== 'number' || !['vertical', 'horizontal'].every(d => schema.properties?.direction?.enum?.includes(d))) throw Error('resize API schema 不兼容');
  }
  const created = await call(['split', '-s', session, '-b', p.anchor, `--split=${p.direction}`, '--ratio', String(p.ratio), '--focus=false', '--label', label, '--json', '-c', cwd, '--', ...command]);
  const child = created.block_ids?.[0];
  if (!child) throw Error('创建结果缺少 block ID；请检查资源，禁止重试');
  try {
    const after = await call(['block', 'inspect', '-s', session, child, '--json']);
    if (after.block?.window_id !== windowId) throw Error('新 pane 不在目标 tab');
    if (p.rebalance) for (const resize of p.rebalance) await call(['api', 'call', '-s', session, 'session.resize_pane', JSON.stringify(resize)]);
    const final = await call(['session', 'inspect', session, '--json']);
    const fw = final.windows?.find(w => w.window_id === windowId);
    const layer = fw?.layers?.find(l => l.kind === 'tiled');
    const blocks = layer?.blocks?.map(b => b.block_id) ?? [];
    if (blocks.length !== peers.length + 2 || ![main, ...peers, child].every(id => blocks.includes(id))) throw Error('最终 pane 清单不符');
    const root = layer.layout?.split;
    const expectedRatio = peers.length === 2 ? 0.42 : 0.5;
    if (root?.direction !== 'horizontal' || root.before?.block_id !== main || !Number.isFinite(root.ratio) || Math.abs(root.ratio - expectedRatio) > 0.02) throw Error('最终主 pane 布局或比例不符');
    if (peers.length === 2 && (root.after?.split?.direction !== 'vertical' || !Number.isFinite(root.after.split.ratio) || Math.abs(root.after.split.ratio - 1 / 3) > 0.02)) throw Error('最终右侧三层布局不符');
    return { ok: true, session_id: session, window_id: windowId, block_id: child, anchor_id: p.anchor, layout: layer.layout };
  } catch (e) {
    return { ok: false, stage: 'post_create', session_id: session, window_id: windowId, block_id: child, error: e.message, instruction: '保留 pane，检查布局；不要重复创建' };
  }
}

async function main(args) {
  const split = args.indexOf('--');
  if (split < 0) throw Error('用法：bun rex-layout.mjs --session ID --main ID --cwd PATH --label NAME [--peer ID ...] -- COMMAND [ARG...]');
  const opts = { peers: [], command: args.slice(split + 1) };
  for (let i = 0; i < split; i += 2) {
    const key = args[i], val = args[i + 1];
    if (!val || val.startsWith('--')) throw Error('参数缺少值');
    if (key === '--peer') opts.peers.push(val);
    else if (key === '--session') opts.session = val;
    else if (key === '--main') opts.main = val;
    else if (key === '--cwd') opts.cwd = val;
    else if (key === '--label') opts.label = val;
    else throw Error(`未知参数：${key}`);
  }
  const out = await addPane(opts);
  console.log(JSON.stringify(out));
  if (!out.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(e => { console.log(JSON.stringify({ ok: false, error: e.message, instruction: '确认实际资源后再决定下一步' })); process.exitCode = 1; });
