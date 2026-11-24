import { test, expect, describe } from 'bun:test';
import { dispatch, evaluate, visualOrder, parseArgs, buildCommand, mergeArgs, requestedFlags, classify, parseRexStdout, parseTimeout, DEFAULT_PI_ARGS, MAX_PANES, USAGE, norm } from './rex-dispatch.mjs';

// ---------- fixtures ----------
const leaf = id => ({ block_id: id });
const h = (r, b, a) => ({ split: { direction: 'horizontal', ratio: r, before: b, after: a } });
const v = (r, b, a) => ({ split: { direction: 'vertical', ratio: r, before: b, after: a } });
const win = (id, blocks, layout, label = '🐙sub｜t') => ({
  window_id: id, label, focused_block_id: blocks[0],
  layers: [{ kind: 'tiled', blocks: blocks.map(b => ({ block_id: b })), layout }],
});

const main1 = () => win('w0', ['m'], leaf('m'), 'main');
const main2 = () => win('w0', ['m', 'p1'], h(0.5, leaf('m'), leaf('p1')), 'main');
const main3 = () => win('w0', ['m', 'p1', 'p2'], h(0.5, leaf('m'), v(0.5, leaf('p1'), leaf('p2'))), 'main');
const main4 = () => win('w0', ['m', 'p1', 'p2', 'p3'], h(0.42, leaf('m'), v(1 / 3, leaf('p1'), v(0.5, leaf('p2'), leaf('p3')))), 'main');

const wt1 = (id = 'w1') => win(id, ['a1'], leaf('a1'));
const wt2 = (id = 'w1') => win(id, ['a1', 'a2'], h(0.5, leaf('a1'), leaf('a2')));
const wt3 = (id = 'w1') => win(id, ['a1', 'a2', 'a3'], h(0.5, leaf('a1'), v(0.5, leaf('a2'), leaf('a3'))));
const wt4 = (id = 'w1') => win(id, ['a1', 'a2', 'a3', 'a4'], h(0.42, leaf('a1'), v(1 / 3, leaf('a2'), v(0.5, leaf('a3'), leaf('a4')))));
const wtb = (id = 'w2') => win(id, ['b1', 'b2', 'b3', 'b4'], h(0.42, leaf('b1'), v(1 / 3, leaf('b2'), v(0.5, leaf('b3'), leaf('b4')))));

const resizeApi = {
  name: 'session.resize_pane',
  input_schema: { required: ['session_id', 'direction', 'before_block_id', 'after_block_id', 'ratio'], properties: { ratio: { type: 'number' }, direction: { enum: ['vertical', 'horizontal'] } } },
};

// Mutable fake Rex world. onSplit / onWindow mutate the state after a create.
function world({ windows, active = 'w0', onSplit, onWindow, fail, splitIds = ['n1'] } = {}) {
  const w = { windows, active, calls: [], splits: 0, news: 0, fail };
  w.call = async a => {
    w.calls.push(a);
    if (a[0] === 'session') return { session_id: 'session:s', active_window_id: w.active, windows: w.windows };
    if (a[0] === 'block') {
      const id = a[4];
      for (const x of w.windows) if (x.layers[0].blocks.some(b => b.block_id === id)) return { block: { block_id: id, window_id: x.window_id } };
      const e = Error('block not found'); e.stderr = 'not found'; throw e;
    }
    if (a[0] === 'api' && a[1] === 'describe') return resizeApi;
    if (a[0] === 'api') return { ok: true };
    if (a[0] === 'split') { w.splits++; if (w.fail) { const e = Error(w.fail); e.stderr = w.fail; throw e; } onSplit?.(w, a); return { block_ids: splitIds }; }
    if (a[0] === 'window') { w.news++; if (w.fail) { const e = Error(w.fail); e.stderr = w.fail; throw e; } onWindow?.(w, a); return { window_id: 'wn' }; }
    throw Error('unexpected call ' + a[0]);
  };
  return w;
}

const opts = (extra = {}) => ({ session: 's', main: 'm', taskDir: '/task', label: '🐙sub｜新代理', task: '首任务原文', panes: [], worktabs: new Map(), args: [], command: [], ...extra });
const wt = pairs => new Map(pairs.map(([w, bs]) => [norm(w), new Set(bs.map(norm))]));

// ---------- layout order derivation ----------
describe('布局顺序派生', () => {
  test('按视觉顺序取叶子：主 tab 与工作 tab', () => {
    expect(visualOrder(leaf('a'))).toEqual(['a']);
    expect(visualOrder(h(0.5, leaf('a'), v(0.5, leaf('b'), leaf('c'))))).toEqual(['a', 'b', 'c']);
    expect(visualOrder(main4().layers[0].layout)).toEqual(['m', 'p1', 'p2', 'p3']);
  });
});

// ---------- main tab: 0/1/2/3 registered peers ----------
describe('主 tab 机械布局（0/1/2/3 位代理）', () => {
  test('0 位：主 pane 全屏 → 右侧分割，anchor=主 pane', async () => {
    const w = world({ windows: [main1()], onSplit: s => { s.windows = [win('w0', ['m', 'n1'], h(0.5, leaf('m'), leaf('n1')), 'main')]; s.active = 'w1'; } });
    const out = await dispatch(opts(), w.call);
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('main');
    expect(out.anchor).toBe('m');
    expect(out.block_id).toBe('n1');
    const sp = w.calls.find(a => a[0] === 'split');
    expect(sp).toContain('--ratio');
    expect(sp).toContain('--focus=false');
    expect(w.splits).toBe(1);
  });

  test('1 位：已登记 p1 原样复用，不放宽顺序，分割点改为 p1 下方', async () => {
    const w = world({ windows: [main2()], onSplit: s => { s.windows = [win('w0', ['m', 'p1', 'n1'], h(0.5, leaf('m'), v(0.5, leaf('p1'), leaf('n1'))), 'main')]; } });
    const out = await dispatch(opts({ panes: ['p1'] }), w.call);
    expect(out.ok).toBe(true);
    expect(out.anchor).toBe('p1');
    const sp = w.calls.find(a => a[0] === 'split');
    expect(sp[sp.indexOf('-b') + 1]).toBe('p1');
    expect(sp).toContain('--split=below');
  });

  test('2 位：创建后执行 42/58 与三等分 rebalance', async () => {
    const w2 = world({
      windows: [main3()],
      onSplit: s => { s.windows = [win('w0', ['m', 'p1', 'p2', 'n1'], h(0.42, leaf('m'), v(1 / 3, leaf('p1'), v(0.5, leaf('p2'), leaf('n1')))), 'main')]; },
    });
    const out = await dispatch(opts({ panes: ['p1', 'p2'] }), w2.call);
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('main');
    expect(out.anchor).toBe('p2');
    const calls = w2.calls.filter(a => a[0] === 'api' && a[1] === 'call');
    expect(calls.length).toBe(2);
    expect(JSON.parse(calls[0][5]).ratio).toBeCloseTo(1 / 3);
    expect(JSON.parse(calls[1][5]).ratio).toBeCloseTo(0.42);
  });

  test('3 位（满 4 pane，未登记工作 tab）→ 新建工作 tab', async () => {
    const w = world({
      windows: [main4()],
      onWindow: s => { s.windows = [...s.windows, win('wn', ['n1'], leaf('n1'), '🐙sub｜新代理')]; },
    });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'] }), w.call);
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('worktab-create');
    expect(out.window_id).toBe('wn');
    expect(out.block_id).toBe('n1');
    expect(w.splits).toBe(0);
    expect(w.news).toBe(1);
    const nw = w.calls.find(a => a[0] === 'window');
    expect(nw).toContain('--focus=false');
    expect(nw[nw.indexOf('--') + 1]).toBe('pi');
    expect(nw[nw.length - 1]).toBe('首任务原文');
  });
});

// ---------- work tabs 0(1 pane) → 4 ----------
describe('满额后工作 tab 链（1→2→3→4→新建）', () => {
  test('工作 tab0：1 pane → anchor 为该 pane，peers 空，水平 50/50', async () => {
    const w = world({
      windows: [main4(), wt1()],
      onSplit: s => { s.windows = [main4(), win('w1', ['a1', 'n1'], h(0.5, leaf('a1'), leaf('n1')))]; },
    });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'], worktabs: wt([['w1', ['a1']]]) }), w.call);
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('worktab-add');
    expect(out.anchor).toBe('a1');
    expect(out.panes).toBe(2);
  });

  test('工作 tab1：2 pane → anchor 右、peer 左，右列垂直', async () => {
    const w = world({
      windows: [main4(), wt2()],
      onSplit: s => { s.windows = [main4(), win('w1', ['a1', 'a2', 'n1'], h(0.5, leaf('a1'), v(0.5, leaf('a2'), leaf('n1'))))]; },
    });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'], worktabs: wt([['w1', ['a1', 'a2']]]) }), w.call);
    expect(out.ok).toBe(true);
    expect(out.anchor).toBe('a2');
    expect(out.panes).toBe(3);
  });

  test('工作 tab2：3 pane → anchor 最下，媒体顺序 argv 不依赖登记顺序', async () => {
    const w = world({
      windows: [main4(), wt3()],
      onSplit: s => { s.windows = [main4(), win('w1', ['a1', 'a2', 'a3', 'n1'], h(0.42, leaf('a1'), v(1 / 3, leaf('a2'), v(0.5, leaf('a3'), leaf('n1')))))]; },
    });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'], worktabs: wt([['w1', ['a3', 'a1', 'a2']]]) }), w.call);
    expect(out.ok).toBe(true);
    expect(out.anchor).toBe('a3');
    expect(out.panes).toBe(4);
    expect(out.capacity_left).toBe(0);
    expect(out.next_action).toBe('dispatch-worktab-create');
  });

  test('工作 tab3：4 pane 满 → 顺位到下一个登记工作 tab', async () => {
    const w = world({
      windows: [main4(), wt4('w1'), win('w2', ['b1'], leaf('b1'))],
      onSplit: s => { s.windows = [main4(), wt4('w1'), win('w2', ['b1', 'n1'], h(0.5, leaf('b1'), leaf('n1')))]; },
    });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'], worktabs: wt([['w1', ['a1', 'a2', 'a3', 'a4']], ['w2', ['b1']]]) }), w.call);
    expect(out.ok).toBe(true);
    expect(out.window_id).toBe('w2');
    expect(out.anchor).toBe('b1');
  });

  test('工作 tab4（全部已满）→ 新建工作 tab1', async () => {
    const w = world({
      windows: [main4(), wt4('w1'), wtb('w2')],
      onWindow: s => { s.windows = [...s.windows, win('wn', ['n1'], leaf('n1'), '🐙sub｜新代理')]; },
    });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'], worktabs: wt([['w1', ['a1', 'a2', 'a3', 'a4']], ['w2', ['b1', 'b2', 'b3', 'b4']]]) }), w.call);
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('worktab-create');
    expect(out.window_id).toBe('wn');
  });
});

// ---------- refusals ----------
describe('拒绝路径（不创建资源）', () => {
  test('主 tab 有未登记 pane → unregistered-pane，退出码 1，无创建调用', async () => {
    const w = world({ windows: [win('w0', ['m', 'p1', 'intruder'], h(0.5, leaf('m'), v(0.5, leaf('p1'), leaf('intruder'))), 'main')] });
    const out = await dispatch(opts({ panes: ['p1'] }), w.call);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('unregistered-pane');
    expect(out.unregistered).toEqual(['intruder']);
    expect(w.calls.some(a => a[0] === 'split' || a[0] === 'window')).toBe(false);
  });

  test('登记的 pane 缺失 → registered-pane-missing', async () => {
    const w = world({ windows: [main2()] });
    const out = await dispatch(opts({ panes: ['p1', 'p9'] }), w.call);
    expect(out.code).toBe('registered-pane-missing');
    expect(w.calls.some(a => a[0] === 'split')).toBe(false);
  });

  test('工作 tab 有未登记 pane → 停止', async () => {
    const w = world({ windows: [main4(), win('w1', ['a1', 'x'], h(0.5, leaf('a1'), leaf('x')))] });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'], worktabs: wt([['w1', ['a1']]]) }), w.call);
    expect(out.code).toBe('unregistered-pane');
    expect(out.window_id).toBe('w1');
    expect(w.calls.some(a => a[0] === 'split')).toBe(false);
  });

  test('用户自定义布局（比例 0.6）→ layout-mismatch，不调整', async () => {
    const custom = win('w0', ['m', 'p1'], h(0.6, leaf('m'), leaf('p1')), 'main');
    const w = world({ windows: [custom] });
    const out = await dispatch(opts({ panes: ['p1'] }), w.call);
    expect(out.code).toBe('layout-mismatch');
    expect(w.calls.some(a => a[0] === 'split')).toBe(false);
  });

  test('未知 pane 出现在布局树但不在 pane 清单 → layout-mismatch', async () => {
    const bad = win('w0', ['m', 'p1'], h(0.5, leaf('m'), leaf('ghost')), 'main');
    const w = world({ windows: [bad] });
    const out = await dispatch(opts({ panes: ['p1'] }), w.call);
    expect(out.code).toBe('layout-mismatch');
  });

  test('同 label 不构成归属证明 → label-conflict，不复用', async () => {
    const w = world({ windows: [main4(), win('w9', ['z'], leaf('z'), '🐙sub｜新代理')] });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'] }), w.call);
    expect(out.code).toBe('label-conflict');
    expect(out.candidates).toEqual(['w9']);
    expect(w.news).toBe(0);
  });

  test('重复登记同一 pane → duplicate-registration', async () => {
    const w = world({ windows: [main4(), wt1()] });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'], worktabs: wt([['w1', ['p1']]]) }), w.call);
    expect(out.code).toBe('duplicate-registration');
  });

  test('主 tab 图层不是单一 tiled → layout-mismatch', async () => {
    const m = main1();
    m.layers.push({ kind: 'floating', blocks: [] });
    const w = world({ windows: [m] });
    const out = await dispatch(opts(), w.call);
    expect(out.code).toBe('layout-mismatch');
  });

  test('工作 tab 标签不以 🐙sub 开头 → 拒绝', async () => {
    const w = world({ windows: [main4(), win('w1', ['a1'], leaf('a1'), '用户自己的 tab')] });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'], worktabs: wt([['w1', ['a1']]]) }), w.call);
    expect(out.code).toBe('precheck');
    expect(w.calls.some(a => a[0] === 'split')).toBe(false);
  });

  test('服务不可达（rex 退出码 4）→ server-unreachable，退出码 4，无创建', async () => {
    const w = world({ windows: [main1()] });
    const w2 = { ...w, call: async () => { const e = Error('rex 失败（4）：connection refused'); e.stderr = 'connection refused'; e.code = 4; throw e; } };
    const out = await dispatch(opts(), w2.call);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('server-unreachable');
    expect(out.status).toBe('precheck');
  });

  test('目标 block 不存在 → resource-not-found（退出码 3）', async () => {
    const w = world({ windows: [main1()] });
    const out = await dispatch(opts({ main: 'nope' }), w.call);
    expect(out.code).toBe('resource-not-found');
  });
});

// ---------- focus ----------
describe('焦点保持', () => {
  test('主 tab 分屏后焦点回到原窗口，changed=false', async () => {
    const w = world({ windows: [main1()], active: 'w0', onSplit: s => { s.windows = [win('w0', ['m', 'n1'], h(0.5, leaf('m'), leaf('n1')), 'main')]; } });
    const out = await dispatch(opts(), w.call);
    expect(out.focus).toEqual({ before: 'w0', after: 'w0', changed: false });
  });

  test('新建工作 tab 提升焦点时记录 changed，不判失败', async () => {
    const w = world({
      windows: [main4()],
      onWindow: s => { s.windows = [...s.windows, win('wn', ['n1'], leaf('n1'), '🐙sub｜新代理')]; s.active = 'wn'; },
    });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'] }), w.call);
    expect(out.ok).toBe(true);
    expect(out.focus).toEqual({ before: 'w0', after: 'wn', changed: true });
    expect(w.calls.find(a => a[0] === 'window')).toContain('--focus=false');
  });
});

// ---------- create failures ----------
describe('创建失败与超时（不重试）', () => {
  test('主 tab 分屏超时 → status unknown，已知坐标，只调用一次', async () => {
    const w = world({ windows: [main1()], fail: 'rex 失败（ETIMEDOUT）：timeout' });
    const out = await dispatch(opts(), w.call);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('status-unknown');
    expect(out.stage).toBe('create');
    expect(norm(out.session_id)).toBe('s');
    expect(out.window_id).toBe('w0');
    expect(out.report_block).toBe('m');
    expect(out.created).toEqual([]);
    expect(out.instruction).toContain('禁止重试');
    expect(w.splits).toBe(1);
  });

  test('新建工作 tab 超时 → unknown，带已知坐标，只建一次', async () => {
    const w = world({ windows: [main4()], fail: 'rex 失败（ETIMEDOUT）：timeout' });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'] }), w.call);
    expect(out.code).toBe('status-unknown');
    expect(out.mode).toBe('worktab-create');
    expect(w.news).toBe(1);
  });

  test('工作 tab 追加超时 → unknown 并保留 window/anchor', async () => {
    const w = world({ windows: [main4(), wt1()], fail: 'rex 失败（ETIMEDOUT）：timeout' });
    const out = await dispatch(opts({ panes: ['p1', 'p2', 'p3'], worktabs: wt([['w1', ['a1']]]) }), w.call);
    expect(out.code).toBe('status-unknown');
    expect(out.window_id).toBe('w1');
    expect(out.anchor).toBe('a1');
    expect(w.splits).toBe(1);
  });

  test('创建后核对失败 → unknown，返回已创建 block，不清理', async () => {
    const w = world({ windows: [main1()], onSplit: s => { s.windows = [win('w0', ['m', 'n1'], h(0.6, leaf('m'), leaf('n1')), 'main')]; } });
    const out = await dispatch(opts(), w.call);
    expect(out.code).toBe('status-unknown');
    expect(out.stage).toBe('post_create');
    expect(out.block_id).toBe('n1');
    expect(w.splits).toBe(1);
  });

  test('block inspect 报错中断 → resource-not-found，未创建', async () => {
    const w = world({ windows: [main1()] });
    const call = async a => {
      if (a[0] === 'session') return { session_id: 'session:s', active_window_id: 'w0', windows: [main1()] };
      if (a[0] === 'block') { const e = Error('rex 失败（1）：not found'); e.stderr = 'not found'; throw e; }
      throw Error('不应创建');
    };
    const out = await dispatch(opts(), call);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('resource-not-found');
    expect(w.calls.length).toBe(0);
  });
});

// ---------- CLI/contract ----------
describe('输入契约', () => {
  test('--help 显示用法', () => {
    expect(USAGE).toContain('--task-dir');
    expect(USAGE).toContain('退出码');
    expect(parseArgs(['--help']).help).toBe(true);
  });

  test('解析：显式命令、工作 tab 与工作 tab pane', () => {
    const o = parseArgs(['--session', 's', '--main', 'm', '--task-dir', '/t', '--role', 'A', '--pane', 'p1', '--worktab', 'w1', '--worktab-pane', 'w1=a1', '--worktab-pane', 'w2=b1', '--', 'pi', '--name', 'x', '任务']);
    expect(o.label).toBe('🐙sub｜A');
    expect(o.panes).toEqual(['p1']);
    expect([...o.worktabs.keys()]).toEqual(['w1', 'w2']);
    expect([...o.worktabs.get('w1')]).toEqual(['a1']);
    expect(o.command).toEqual(['pi', '--name', 'x', '任务']);
  });

  test('解析错误：缺值、未知参数、--worktab-pane 无等号、缺 label', () => {
    expect(() => parseArgs(['--session'])).toThrow(/缺少值/);
    expect(() => parseArgs(['--bogus', 'x'])).toThrow(/未知参数/);
    expect(() => parseArgs(['--worktab-pane', 'w1'])).toThrow(/WINDOW=BLOCK/);
    expect(() => parseArgs(['--session', 's'])).toThrow(/--role 或 --label/);
  });

  test('命令构造：模型只给 task，脚本不推断内容', () => {
    expect(buildCommand({ command: ['sh', '-c', 'x'], task: 'y' }, 'L')).toEqual(['sh', '-c', 'x']);
    expect(() => buildCommand({}, 'L')).toThrow(/缺少 --task/);
  });

  test('B1 默认 Pi 旗标：model 与 thinking 显式传入', () => {
    expect(DEFAULT_PI_ARGS).toEqual(['--model', 'magpie/auto/deepseek-flash', '--thinking', 'high']);
    const argv = buildCommand({ task: '首任务' }, '🐙sub｜A');
    expect(argv).toEqual(['pi', '--name', '🐙sub｜A', '--model', 'magpie/auto/deepseek-flash', '--thinking', 'high', '首任务']);
    expect(requestedFlags(argv)).toEqual({ model: 'magpie/auto/deepseek-flash', thinking: 'high' });
    expect(argv[argv.length - 1]).toBe('首任务');
  });

  test('B1 覆盖：--arg 同名旗标替换默认值，其余追加', () => {
    expect(mergeArgs(DEFAULT_PI_ARGS, ['--model', 'x/y'])).toEqual(['--thinking', 'high', '--model', 'x/y']);
    expect(mergeArgs(DEFAULT_PI_ARGS, ['--thinking=low'])).toEqual(['--model', 'magpie/auto/deepseek-flash', '--thinking=low']);
    const o = parseArgs(['--session', 's', '--main', 'm', '--task-dir', '/t', '--role', 'A', '--arg', '--thinking', '--arg', 'max', '--task', 'T']);
    const argv = buildCommand(o, o.label);
    expect(requestedFlags(argv)).toEqual({ model: 'magpie/auto/deepseek-flash', thinking: 'max' });
    expect(argv[argv.length - 1]).toBe('T');
    expect(() => parseArgs(['--role', 'A', '--arg'])).toThrow(/缺少值/);
  });

  test('B1 输出 requested 但要求启动后独立核对', async () => {
    const w = world({ windows: [main1()], onSplit: s => { s.windows = [win('w0', ['m', 'n1'], h(0.5, leaf('m'), leaf('n1')), 'main')]; } });
    const out = await dispatch(opts(), w.call);
    expect(out.requested).toEqual({ model: 'magpie/auto/deepseek-flash', thinking: 'high' });
    expect(out.verify_after_start).toContain('独立核对');
    const sp = w.calls.find(a => a[0] === 'split');
    expect(sp).toContain('--model');
    expect(sp.join(' ')).toContain('magpie/auto/deepseek-flash');
    expect(sp[sp.length - 1]).toBe('首任务原文');
  });

  test('M1 同一 pane 重复登记在解析阶段就拒绝', () => {
    expect(() => parseArgs(['--role', 'A', '--pane', 'p1', '--pane', 'block:p1'])).toThrow(/重复登记/);
    expect(() => parseArgs(['--role', 'A', '--pane', 'p1', '--worktab-pane', 'w1=p1'])).toThrow(/重复登记/);
  });

  test('M3 --main-window 断言不符时停止', async () => {
    const w = world({ windows: [main1()] });
    const out = await dispatch(opts({ mainWindow: 'window:other' }), w.call);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('precheck');
    expect(w.calls.some(a => a[0] === 'split')).toBe(false);
  });

  test('M6 同时返回未登记与登记缺失两份清单', async () => {
    const w = world({ windows: [win('w0', ['m', 'p1', 'intruder'], h(0.5, leaf('m'), v(0.5, leaf('p1'), leaf('intruder'))), 'main')] });
    const out = await dispatch(opts({ panes: ['p1', 'p9'] }), w.call);
    expect(out.code).toBe('unregistered-pane');
    expect(out.unregistered).toEqual(['intruder']);
    expect(out.missing).toEqual(['p9']);
    expect(out.error).toContain('intruder');
    expect(out.error).toContain('p9');
  });

  test('capacity 与 next_action 字段可供技能正文直接使用', async () => {
    const w = world({ windows: [main1()], onSplit: s => { s.windows = [win('w0', ['m', 'n1'], h(0.5, leaf('m'), leaf('n1')), 'main')]; } });
    const out = await dispatch(opts(), w.call);
    expect(MAX_PANES).toBe(4);
    expect(out.panes).toBe(2);
    expect(out.capacity_left).toBe(2);
    expect(out.next_action).toBe('dispatch-main');
  });

  test('evaluate 只读，不创建', async () => {
    const w = world({ windows: [main3()] });
    const st = await evaluate(opts({ panes: ['p1', 'p2'] }), w.call);
    expect(st.mode).toBe('main');
    expect(st.order).toEqual(['m', 'p1', 'p2']);
    expect(w.calls.some(a => a[0] === 'split')).toBe(false);
  });

  test('前缀 ID：登记可用短 ID，创建调用改用实况 raw ID', async () => {
    const p = id => `block:${id}`;
    const pre = win('window:w0', [p('m'), p('p1')], h(0.5, leaf(p('m')), leaf(p('p1'))), 'main');
    const w = world({
      windows: [pre],

      splitIds: ['block:n1'],
      onSplit: s => { s.windows = [win('window:w0', [p('m'), p('p1'), p('n1')], h(0.5, leaf(p('m')), v(0.5, leaf(p('p1')), leaf(p('n1')))), 'main')]; },
    });
    const out = await dispatch(opts({ session: 'session:s', main: 'm', panes: ['p1'] }), w.call);
    expect(out.ok).toBe(true);
    const sp = w.calls.find(a => a[0] === 'split');
    expect(sp[sp.indexOf('-b') + 1]).toBe('block:p1');
    expect(sp[sp.indexOf('-s') + 1]).toBe('session:s');
    expect(out.block_id).toBe('block:n1');
  });
});

// ---------- B2: real exit-code classification ----------
describe('B2 错误码按真实退出码分类', () => {
  test('rex 退出码 3 / 4 / 其它', () => {
    const e = code => Object.assign(Error('x'), { code, stderr: '' });
    expect(classify(e(3))).toBe('resource-not-found');
    expect(classify(e(4))).toBe('server-unreachable');
    expect(classify(e(1))).toBe('rex-error');
    expect(classify(e(2))).toBe('rex-error');
  });

  test('CLI 不存在、超时、自有码分别识别', () => {
    expect(classify(Object.assign(Error('x'), { code: 'ENOENT' }))).toBe('cli-missing');
    expect(classify(Object.assign(Error('x'), { killed: true, signal: 'SIGTERM' }))).toBe('timeout');
    expect(classify(Object.assign(Error('x'), { code: 'ETIMEDOUT' }))).toBe('timeout');
    expect(classify(Object.assign(Error('x'), { code: 'server-unreachable' }))).toBe('server-unreachable');
    expect(classify(Object.assign(Error('x'), { code: 'protocol-error' }))).toBe('protocol-error');
  });

  test('文本只作最后兜底，且不是数字退出码时才算', () => {
    const nf = Object.assign(Error('x'), { stderr: 'block target not found' });
    expect(classify(nf)).toBe('resource-not-found');
    expect(classify(Object.assign(Error('x'), { stderr: 'invalid argument' }))).toBe('unknown-error');
    // 退出码 1 + 文本里出现 not found：仍按退出码 1 处理，不升级为 3。
    expect(classify(Object.assign(Error('x'), { code: 1, stderr: 'not found' }))).toBe('rex-error');
  });

  test('非 JSON 输出是协议错误，不是服务不可达', () => {
    expect(parseRexStdout('')).toEqual({ ok: true });
    expect(parseRexStdout('{"a":1}')).toEqual({ a: 1 });
    let err;
    try { parseRexStdout('not-json'); } catch (e) { err = e; }
    expect(err.code).toBe('protocol-error');
    expect(err.classified_by).toBe('protocol');
  });

  test('dispatch 透传 rex_exit 与分类来源，不重试', async () => {
    const call = async () => { const e = Error('x'); e.code = 1; e.stderr = 'invalid argument'; throw e; };
    const out = await dispatch(opts(), call);
    expect(out.code).toBe('rex-error');
    expect(out.rex_exit).toBe(1);
    expect(out.classified_by).toBe('exit-code');
  });

  test('超时在预检阶段报 timeout；创建已发出后仍是 unknown 且不重试', async () => {
    const call = async () => { const e = Error('x'); e.killed = true; e.signal = 'SIGTERM'; throw e; };
    const out = await dispatch(opts(), call);
    expect(out.code).toBe('timeout');
    expect(out.status).toBe('precheck');

    let splits = 0;
    const w = world({ windows: [main1()], fail: 'x' });
    w.fail = null;
    const hang = world({ windows: [main1()] });
    for (const [k, v] of Object.entries(hang)) if (k !== 'call') w[k] = v;
    const w2 = world({ windows: [main1()] });
    w2.call = async a => {
      if (a[0] === 'session') return { session_id: 'session:s', active_window_id: 'w0', windows: [main1()] };
      if (a[0] === 'block') return { block: { block_id: 'm', window_id: 'w0' } };
      splits++;
      const e = Error('timed out'); e.killed = true; e.signal = 'SIGTERM'; throw e;
    };
    const out2 = await dispatch(opts(), w2.call);
    expect(out2.code).toBe('status-unknown');
    expect(out2.status).toBe('unknown');
    expect(splits).toBe(1);
  });
});

// ---------- N1 / N2 / N4: closeout fixes ----------
describe('N1 pi 绝对路径也注入默认旗标', () => {
  test('basename 为 pi 时保留默认 model/thinking', () => {
    const abs = buildCommand({ proc: '/usr/local/bin/pi', task: 'T' }, 'L');
    expect(abs).toEqual(['/usr/local/bin/pi', '--name', 'L', '--model', 'magpie/auto/deepseek-flash', '--thinking', 'high', 'T']);
    expect(requestedFlags(abs)).toEqual({ model: 'magpie/auto/deepseek-flash', thinking: 'high' });
  });

  test('非 pi 程序不注入', () => {
    const other = buildCommand({ proc: '/opt/bin/pi-agent', task: 'T' }, 'L');
    expect(other).toEqual(['/opt/bin/pi-agent', '--name', 'L', 'T']);
    expect(buildCommand({ proc: 'sh', args: ['-c', 'x'], task: 'T' }, 'L')).toEqual(['sh', '--name', 'L', '-c', 'x', 'T']);
  });

  test('绝对路径 pi 也能被 --arg 覆盖', () => {
    const o = parseArgs(['--role', 'A', '--proc', '/usr/bin/pi', '--arg', '--thinking', '--arg', 'low', '--task', 'T']);
    expect(requestedFlags(buildCommand(o, o.label))).toEqual({ model: 'magpie/auto/deepseek-flash', thinking: 'low' });
  });
});

describe('N2 保留旗标 --name 拒绝', () => {
  test('--arg --name X 与 --name=X 都拒绝', () => {
    expect(() => parseArgs(['--role', 'A', '--arg', '--name', 'X', '--task', 'T'])).toThrow(/保留旗标/);
    expect(() => parseArgs(['--role', 'A', '--arg', '--name=X', '--task', 'T'])).toThrow(/保留旗标/);
  });

  test('buildCommand 直接调用也拒绝，命令数组不含两个 --name', () => {
    expect(() => buildCommand({ args: ['--name', 'X'], task: 'T' }, 'L')).toThrow(/保留旗标/);
    expect(() => buildCommand({ proc: '/usr/bin/pi', args: ['--name=X'], task: 'T' }, 'L')).toThrow(/保留旗标/);
    const ok = buildCommand({ args: ['--model', 'm'], task: 'T' }, 'L');
    expect(ok.filter(x => x === '--name')).toHaveLength(1);
  });

  test('显式 -- COMMAND 不受限（那是调用方自己的命令）', () => {
    expect(buildCommand({ command: ['pi', '--name', 'X', 'T'], args: ['--name', 'X'] }, 'L')).toEqual(['pi', '--name', 'X', 'T']);
  });
});

describe('N4 超时环境变量校验', () => {
  test('合法值取整；空值用默认', () => {
    expect(parseTimeout('300')).toEqual({ ms: 300 });
    expect(parseTimeout('1500.7')).toEqual({ ms: 1500 });
    expect(parseTimeout(undefined)).toEqual({ ms: 10000 });
    expect(parseTimeout('')).toEqual({ ms: 10000 });
  });

  test('非法值回退默认并给出明确说明', () => {
    for (const bad of ['abc', '0', '-5', 'NaN', '1e', ' ']) {
      const r = parseTimeout(bad);
      expect(r.ms).toBe(10000);
      expect(r.error).toContain('REX_DISPATCH_TIMEOUT_MS=');
      expect(r.error).toContain('回退 10000');
    }
    expect(parseTimeout('abc', 500).ms).toBe(500);
    expect(parseTimeout('abc', 500).error).toContain('回退 500');
  });
});
