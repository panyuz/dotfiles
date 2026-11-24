import { test, expect } from 'bun:test';
import { getContext } from './rex-context.mjs';

const identity = { session_id: 'session:1', window_id: 'window:1', block_id: 'block:1' };
const session = { session_id: 'session:1', windows: [{ window_id: 'window:1', focused_block_id: 'block:2', layers: [{ layer_id: 'layer:1', kind: 'tiled', layout: { block_id: 'block:1' }, blocks: [{ block_id: 'block:1', label: 'main' }, { block_id: 'block:2', label: 'peer' }] }] }] };
const block = { block: { block_id: 'block:1', window_id: 'window:1' } };
const result = value => ({ ok: true, value });
const runner = map => async args => map[args[0]];

test('保留自身坐标与完整布局，不替换为用户焦点', async () => {
  const out = await getContext(runner({ whoami: result(identity), session: result(session), block: result(block) }));
  expect(out.ok).toBe(true);
  expect(out.block_id).toBe('block:1');
  expect(out.focused_block_id).toBe('block:2');
  expect(out.layers[0].blocks).toHaveLength(2);
});

test('缺少坐标时停止', async () => {
  const out = await getContext(runner({ whoami: result({ session_id: 'session:1' }) }));
  expect(out.stage).toBe('identity');
});

test.each([[3, 'not_found'], [4, 'server_unreachable'], [1, 'error']])('错误码 %s 显式区分', async (code, reason) => {
  const out = await getContext(runner({ whoami: { ok: false, code, detail: '故障' } }));
  expect(out.reason).toBe(reason);
});

test('窗口不一致返回未知而非目标消失', async () => {
  const out = await getContext(runner({ whoami: result(identity), session: result(session), block: result({ block: { ...block.block, window_id: 'window:2' } }) }));
  expect(out.stage).toBe('consistency');
  expect(out.reason).toBe('error');
});

test('session 查询失败时保留退出码', async () => {
  const out = await getContext(runner({ whoami: result(identity), session: { ok: false, code: 4, detail: 'offline' }, block: result(block) }));
  expect(out.reason).toBe('server_unreachable');
});
