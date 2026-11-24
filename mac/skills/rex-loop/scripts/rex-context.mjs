#!/usr/bin/env bun
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);

async function runRex(args) {
  try {
    const { stdout } = await exec('rex', args, { timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, value: JSON.parse(stdout) };
  } catch (error) {
    return { ok: false, code: typeof error.code === 'number' ? error.code : null, detail: String(error.stderr || error.message).trim().slice(0, 500) };
  }
}

function fail(stage, code, detail) {
  return { ok: false, stage, reason: code === 3 ? 'not_found' : code === 4 ? 'server_unreachable' : 'error', exit_code: code, detail };
}

export async function getContext(run = runRex) {
  const identity = await run(['whoami', '--json']);
  if (!identity.ok) return fail('whoami', identity.code, identity.detail);
  const { session_id, window_id, block_id } = identity.value ?? {};
  if (![session_id, window_id, block_id].every(v => typeof v === 'string' && v.length > 0)) {
    return fail('identity', null, '当前进程缺少完整 session、window 或 block 坐标');
  }
  const [session, block] = await Promise.all([
    run(['session', 'inspect', session_id, '--json']),
    run(['block', 'inspect', '-s', session_id, block_id, '--json']),
  ]);
  if (!session.ok) return fail('session', session.code, session.detail);
  if (!block.ok) return fail('block', block.code, block.detail);
  const target = session.value?.windows?.find(w => w.window_id === window_id);
  if (!target || block.value?.block?.block_id !== block_id || block.value?.block?.window_id !== window_id || session.value?.session_id !== session_id) {
    return fail('consistency', null, '坐标不一致或布局缺失，状态未知');
  }
  if (!Array.isArray(target.layers)) return fail('consistency', null, '布局格式未知');
  return {
    ok: true, session_id, window_id, block_id,
    session_label: session.value.label ?? null,
    window_label: target.label ?? null,
    focused_block_id: target.focused_block_id ?? null,
    layers: target.layers.map(layer => ({
      layer_id: layer.layer_id, kind: layer.kind, layout: layer.layout,
      blocks: (layer.blocks ?? []).map(({ block_id, label }) => ({ block_id, label })),
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await getContext();
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = result.exit_code === 3 || result.exit_code === 4 ? result.exit_code : 1;
}
