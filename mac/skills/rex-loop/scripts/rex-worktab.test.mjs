import { test, expect } from 'bun:test';
import * as mod from './rex-worktab.mjs';
import { planWorktab, checkLayout, checkFinalLayout, createWorktab, addAgent, parseArgs, MAX_PANES } from './rex-worktab.mjs';

const leaf = id => ({ block_id: id });
const view = (windows, active) => ({ session_id: 's', active_window_id: active, windows });
const win = (id, blocks, layout, label = '🐙sub｜t') => ({ window_id: id, label, focused_block_id: blocks[0], layers: [{ kind: 'tiled', blocks: blocks.map(b => ({ block_id: b })), layout: layout ?? leaf(blocks[0]) }] });
const two = { split: { direction: 'horizontal', ratio: 0.5, before: leaf('a'), after: leaf('b') } };
const three = { split: { direction: 'horizontal', ratio: 0.5, before: leaf('a'), after: { split: { direction: 'vertical', ratio: 0.5, before: leaf('b'), after: leaf('c') } } } };

test('脚本不再提供关闭能力', () => {
  expect(mod.closeVerifiedWorktab).toBeUndefined();
  expect(MAX_PANES).toBe(4);
});

test('标签必须以 🐙sub 开头', async () => {
  const call = async a => { if (a[0] === 'session') return view([win('w0', ['m'], leaf('m'), 'main')], 'w0'); if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } }; };
  await expect(createWorktab({ session: 's', main: 'm', label: 'work', cwd: '/x', command: ['pi'] }, call)).rejects.toThrow();
  await expect(createWorktab({ session: 's', main: 'm', label: '🐙agent', cwd: '/x', command: ['pi'] }, call)).rejects.toThrow();
});

test('布局校验：比例与形状未知即拒绝', () => {
  expect(() => checkLayout(two, 'a', ['b'])).toThrow();
  expect(() => checkLayout({ split: { direction: 'horizontal', ratio: 0.6, before: leaf('a'), after: leaf('b') } }, 'b', ['a'])).toThrow();
  expect(() => checkLayout(leaf('a'), 'a', [])).not.toThrow();
  expect(() => checkLayout({ block_id: 'a', split: { direction: 'horizontal' } }, 'a', [])).toThrow();
  expect(planWorktab(three, "c", ["a", "b"]).rebalance.length).toBe(2);
  expect(() => checkFinalLayout(three, 'a', ['b'], 'c')).toThrow();
});

test('创建成功：主 tab 非活动也不失败，焦点只观察', async () => {
  const calls = [];
  let n = 0;
  const call = async a => {
    calls.push(a);
    if (a[0] === 'session') { n++; return n === 1 ? view([win('w0', ['m'], leaf('m'), 'main')], 'w0') : view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['n1'])], 'w1'); }
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    if (a[0] === 'window') return { window_id: 'w1' };
  };
  const out = await createWorktab({ session: 's', main: 'm', label: '🐙sub｜t', cwd: '/x', command: ['pi', '--name', '🐙sub｜t', '任务 1'] }, call);
  expect(out.ok).toBe(true);
  expect(out.block_id).toBe('n1');
  expect(out.report_block).toBe('m');
  expect(out.main_window_id).toBe('w0');
  expect(out.focus).toEqual({ before: 'w0', after: 'w1', changed: true });
  const w = calls.find(a => a[0] === 'window');
  expect(w).toContain('--focus=false');
  expect(w.slice(w.indexOf('--') + 1)).toEqual(['pi', '--name', '🐙sub｜t', '任务 1']);
});

test('同名 tab 拒绝且不创建', async () => {
  let created = false;
  const call = async a => {
    if (a[0] === 'session') return view([win('w0', ['m'], leaf('m'), 'main'), win('w9', ['x'], leaf('x'), '🐙sub｜t')], 'w0');
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    created = true;
  };
  const out = await createWorktab({ session: 's', main: 'm', label: '🐙sub｜t', cwd: '/x', command: ['pi'] }, call);
  expect(out.ok).toBe(false);
  expect(created).toBe(false);
});

test('创建超时：状态未知，返回已知坐标，不重试', async () => {
  let creates = 0;
  const call = async a => {
    if (a[0] === 'session') return view([win('w0', ['m'], leaf('m'), 'main')], 'w0');
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    creates++; throw Error('rex 失败（ETIMEDOUT）：timeout');
  };
  const out = await createWorktab({ session: 's', main: 'm', label: '🐙sub｜t', cwd: '/x', command: ['pi'] }, call);
  expect(out.ok).toBe(false);
  expect(out.status).toBe('unknown');
  expect(out.stage).toBe('create');
  expect(out.session_id).toBe('s');
  expect(out.report_block).toBe('m');
  expect(out.window_id).toBeUndefined();
  expect(out.instruction).toContain('禁止重试');
  expect(creates).toBe(1);
});

test('创建后核对不符：状态未知但返回 window_id', async () => {
  let n = 0;
  const call = async a => {
    if (a[0] === 'session') { n++; return n === 1 ? view([win('w0', ['m'], leaf('m'), 'main')], 'w0') : view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['n1', 'n2'], two)], 'w0'); }
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    if (a[0] === 'window') return { window_id: 'w1' };
  };
  const out = await createWorktab({ session: 's', main: 'm', label: '🐙sub｜t', cwd: '/x', command: ['pi'] }, call);
  expect(out.status).toBe('unknown');
  expect(out.stage).toBe('post_create');
  expect(out.window_id).toBe('w1');
  expect(out.instruction).toContain('禁止重试');
});

test('追加 pane：拒绝主 tab、非 🐙sub 标签、未登记 pane', async () => {
  const mk = (wins, active = 'w0') => async a => { if (a[0] === 'session') return view(wins, active); if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } }; throw Error('不应调用'); };
  await expect(addAgent({ session: 's', main: 'm', window: 'w0', anchor: 'm', peers: [], label: 'p2', cwd: '/x', command: ['pi'] }, mk([win('w0', ['m'], leaf('m'), 'main')]))).rejects.toThrow();
  await expect(addAgent({ session: 's', main: 'm', window: 'w1', anchor: 'a', peers: [], label: 'p2', cwd: '/x', command: ['pi'] }, mk([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a'], leaf('a'), 'work')]))).rejects.toThrow();
  await expect(addAgent({ session: 's', main: 'm', window: 'w1', anchor: 'a', peers: [], label: 'p2', cwd: '/x', command: ['pi'] }, mk([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a', 'x'], two)]))).rejects.toThrow();
});

test('追加 pane：比例或图层未知拒绝', async () => {
  const bad = { split: { direction: 'horizontal', ratio: 0.6, before: leaf('a'), after: leaf('b') } };
  const call = async a => {
    if (a[0] === 'session') { const w = win('w1', ['a', 'b'], bad); w.layers.push({ kind: 'floating', blocks: [] }); return view([win('w0', ['m'], leaf('m'), 'main'), w], 'w0'); }
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    throw Error('不应调用');
  };
  await expect(addAgent({ session: 's', main: 'm', window: 'w1', anchor: 'b', peers: ['a'], label: 'p3', cwd: '/x', command: ['pi'] }, call)).rejects.toThrow();
});

test('第四个 pane 前检查 resize schema；不兼容则拒绝且不分割', async () => {
  let split = 0;
  const call = async a => {
    if (a[0] === 'session') return view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a', 'b', 'c'], three)], 'w0');
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    if (a[0] === 'api') return { name: 'session.resize_pane', input_schema: { required: ['session_id'], properties: {} } };
    if (a[0] === 'split') split++;
    throw Error('不应调用');
  };
  await expect(addAgent({ session: 's', main: 'm', window: 'w1', anchor: 'c', peers: ['a', 'b'], label: 'p4', cwd: '/x', command: ['pi'] }, call)).rejects.toThrow();
  expect(split).toBe(0);
});

test('追加成功：焦点变化不判失败，最终布局与比例核对', async () => {
  const child = 'd';
  const done = { split: { direction: 'horizontal', ratio: 0.42, before: leaf('a'), after: { split: { direction: 'vertical', ratio: 1 / 3, before: leaf('b'), after: { split: { direction: 'vertical', ratio: 0.5, before: leaf('c'), after: leaf(child) } } } } } };
  let n = 0;
  const call = async a => {
    if (a[0] === 'session') { n++; return n === 1 ? view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a', 'b', 'c'], three)], 'w0') : view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a', 'b', 'c', child], done)], 'w1'); }
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    if (a[0] === 'api' && a[1] === 'describe') return { name: 'session.resize_pane', input_schema: { required: ['session_id', 'direction', 'before_block_id', 'after_block_id', 'ratio'], properties: { ratio: { type: 'number' }, direction: { enum: ['vertical', 'horizontal'] } } } };
    if (a[0] === 'api') return { ok: true };
    if (a[0] === 'split') return { block_ids: [child] };
  };
  const out = await addAgent({ session: 's', main: 'm', window: 'w1', anchor: 'c', peers: ['a', 'b'], label: 'p4', cwd: '/x', command: ['pi'] }, call);
  expect(out.ok).toBe(true);
  expect(out.panes).toBe(4);
  expect(out.focus.changed).toBe(true);
  expect(out.report_block).toBe('m');
});

test('CLI 首参数必须是 --mode，缺失或未知时给用法错误', () => {
  expect(() => parseArgs(['--session', 's', '--', 'pi'])).toThrow(/缺少 --mode/);
  expect(() => parseArgs(['--mode', 'close', '--', 'pi'])).toThrow(/create 或 add/);
  expect(() => parseArgs(['--mode', 'create', '--bogus', 'x', '--', 'pi'])).toThrow(/未知参数/);
  expect(parseArgs(['--mode', 'add', '--session', 's', '--peer', 'a', '--', 'pi']).peers).toEqual(['a']);
});

test('add 1→2：锚点是现有 pane，不传 peer，水平 50/50', async () => {
  const done = { split: { direction: 'horizontal', ratio: 0.5, before: leaf('a'), after: leaf('b') } };
  let n = 0;
  const calls = [];
  const call = async a => {
    calls.push(a);
    if (a[0] === 'session') { n++; return n === 1 ? view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a'])], 'w0') : view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a', 'b'], done)], 'w0'); }
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    if (a[0] === 'split') return { block_ids: ['b'] };
  };
  const out = await addAgent({ session: 's', main: 'm', window: 'w1', anchor: 'a', peers: [], label: 'p2', cwd: '/x', command: ['sleep', '300'] }, call);
  expect(out.ok).toBe(true);
  expect(out.panes).toBe(2);
  const sp = calls.find(a => a[0] === 'split');
  expect(sp).toContain('a');
  expect(sp).toContain('--focus=false');
});

test('add 2→3：anchor 为右 pane，peer 为左 pane，右列垂直 50/50', async () => {
  const start = { split: { direction: 'horizontal', ratio: 0.5, before: leaf('a'), after: leaf('b') } };
  const done = { split: { direction: 'horizontal', ratio: 0.5, before: leaf('a'), after: { split: { direction: 'vertical', ratio: 0.5, before: leaf('b'), after: leaf('c') } } } };
  let n = 0;
  const call = async a => {
    if (a[0] === 'session') { n++; return n === 1 ? view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a', 'b'], start)], 'w0') : view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a', 'b', 'c'], done)], 'w0'); }
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    if (a[0] === 'split') return { block_ids: ['c'] };
  };
  const out = await addAgent({ session: 's', main: 'm', window: 'w1', anchor: 'b', peers: ['a'], label: 'p3', cwd: '/x', command: ['sleep', '300'] }, call);
  expect(out.ok).toBe(true);
  expect(out.panes).toBe(3);
});

test('四 pane 已满时给出明确上限错误', async () => {
  const four = { split: { direction: 'horizontal', ratio: 0.42, before: leaf('a'), after: { split: { direction: 'vertical', ratio: 1 / 3, before: leaf('b'), after: { split: { direction: 'vertical', ratio: 0.5, before: leaf('c'), after: leaf('d') } } } } } };
  const call = async a => {
    if (a[0] === 'session') return view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a', 'b', 'c', 'd'], four)], 'w0');
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    throw Error('不应调用');
  };
  await expect(addAgent({ session: 's', main: 'm', window: 'w1', anchor: 'd', peers: ['a', 'b', 'c'], label: 'p5', cwd: '/x', command: ['sleep', '300'] }, call)).rejects.toThrow(/4 pane 上限/);
});

test('add 超时：unknown + 已知坐标，只调用一次', async () => {
  let splits = 0;
  const call = async a => {
    if (a[0] === 'session') return view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a'])], 'w0');
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    splits++; throw Error('rex 失败（ETIMEDOUT）：timeout');
  };
  const out = await addAgent({ session: 's', main: 'm', window: 'w1', anchor: 'a', peers: [], label: 'p2', cwd: '/x', command: ['sleep', '300'] }, call);
  expect(out.ok).toBe(false);
  expect(out.status).toBe('unknown');
  expect(out.window_id).toBe('w1');
  expect(out.anchor).toBe('a');
  expect(out.report_block).toBe('m');
  expect(out.instruction).toContain('禁止重试');
  expect(splits).toBe(1);
});

test('add 后核对失败：unknown 并返回已创建 block', async () => {
  const bad = { split: { direction: 'horizontal', ratio: 0.6, before: leaf('a'), after: leaf('d') } };
  let n = 0;
  const call = async a => {
    if (a[0] === 'session') { n++; return n === 1 ? view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a'])], 'w0') : view([win('w0', ['m'], leaf('m'), 'main'), win('w1', ['a', 'd'], bad)], 'w0'); }
    if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
    if (a[0] === 'split') return { block_ids: ['d'] };
  };
  const out = await addAgent({ session: 's', main: 'm', window: 'w1', anchor: 'a', peers: [], label: 'p2', cwd: '/x', command: ['sleep', '300'] }, call);
  expect(out.status).toBe('unknown');
  expect(out.stage).toBe('post_create');
  expect(out.block_id).toBe('d');
  expect(out.window_id).toBe('w1');
});
