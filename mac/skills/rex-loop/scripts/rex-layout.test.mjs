import { test, expect } from 'bun:test';
import { plan, addPane } from './rex-layout.mjs';
const leaf = block_id => ({ block_id });
const root = right => ({ split: { direction: 'horizontal', ratio: 0.5, before: leaf('m'), after: right } });
const two = root({ split: { direction: 'vertical', ratio: 0.5, before: leaf('a'), after: leaf('b') } });
test('从零到两位代理的分屏位置', () => {
  expect(plan(leaf('m'), 'm', [])).toMatchObject({ anchor: 'm', direction: 'right', ratio: 50 });
  expect(plan(root(leaf('a')), 'm', ['a'])).toMatchObject({ anchor: 'a', direction: 'below', ratio: 50 });
  expect(plan(two, 'm', ['a', 'b']).rebalance[0].ratio).toBeCloseTo(1 / 3);
  expect(plan(two, 'm', ['a', 'b']).rebalance[1].ratio).toBeCloseTo(0.42);
});
test('达到上限、未登记或非标准布局时拒绝', () => {
  expect(() => plan(two, 'm', ['a', 'b', 'c'])).toThrow();
  expect(() => plan(root(leaf('other')), 'm', ['a'])).toThrow();
  expect(() => plan(root(leaf('a')), 'm', ['a', 'a'])).toThrow();
});
test('创建后出错返回新 ID，避免重复创建', async () => {
  let split = 0;
  const call = async args => {
    if (args[0] === 'session') return { session_id: 's', windows: [{ window_id: 'w', layers: [{ kind: 'tiled', layout: leaf('m'), blocks: [{ block_id: 'm' }] }] }] };
    if (args[0] === 'block' && args[args.length - 2] === 'm') return { block: { block_id: 'm', window_id: 'w' } };
    if (args[0] === 'split') { split++; return { block_ids: ['new'] }; }
    throw Error('模拟服务中断');
  };
  const out = await addPane({ session: 's', main: 'm', peers: [], cwd: '/x', label: 'a', command: ['pi', 'task'] }, call);
  expect(out.ok).toBe(false); expect(out.block_id).toBe('new'); expect(split).toBe(1);
});
test('已有未知 pane 时不创建', async () => {
  let called = false;
  const call = async args => {
    if (args[0] === 'session') return { session_id: 's', windows: [{ window_id: 'w', layers: [{ kind: 'tiled', layout: leaf('m'), blocks: [{ block_id: 'm' }, { block_id: 'unknown' }] }] }] };
    if (args[0] === 'block') return { block: { block_id: 'm', window_id: 'w' } };
    called = true;
  };
  await expect(addPane({ session: 's', main: 'm', peers: [], cwd: '/x', label: 'a', command: ['pi'] }, call)).rejects.toThrow();
  expect(called).toBe(false);
});
