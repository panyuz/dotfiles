/**
 * 单轮耗时（turn timer）→ 供电给 pi-powerline-footer 的状态段
 *
 * 口径：一次用户提问 = 一轮。
 *  - agent_start：开始计时，每秒刷新（实时显示本轮已用时）
 *  - agent_settled：本轮彻底结束（pi 确认不会再自动重试/压缩/续跑）→ 冻结为最终耗时并落盘
 *  - 同一轮内部的自动重试/续跑（agent_end → 新的 agent_start）不重置计时
 *  - 会话开始就显示占位（上一轮耗时，或 `—`），保证 /reload 后立刻能在 footer 看到它
 *
 * 在 settings.json 的 powerline.customItems 里读取：
 *   { "id": "turn_time", "statusKey": "turn_time", "position": "right", "prefix": "⏱" }
 *
 * ⚠️ 除了 customItems，还必须把 `custom:turn_time` 写进 powerline.layout.right：
 *     footer 的 buildRow() 只在「没有显式配置 layout」时才会自动追加 customItems；
 *     一旦 layout.right 是显式数组，自定义项就必须自己列进去（漏了就永远不显示）。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY = "turn_time";
const STATE_FILE = join(homedir(), ".pi", "agent", "cache", "turn-timer.state");

type UICtx = { ui: { setStatus(key: string, text: string | undefined): void } };

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return s ? `${m}m${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function loadLast(): string | null {
  try {
    const v = readFileSync(STATE_FILE, "utf8").trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveLast(text: string): void {
  try {
    writeFileSync(STATE_FILE, text, "utf8");
  } catch {
    /* 落盘失败不影响显示 */
  }
}

export default function (pi: ExtensionAPI) {
  let turnStart: number | null = null;
  let settled = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stopTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const startTicking = (ctx: UICtx) => {
    stopTimer();
    timer = setInterval(() => {
      if (turnStart === null) return;
      try {
        ctx.ui.setStatus(KEY, fmt(Date.now() - turnStart));
      } catch {
        stopTimer();
      }
    }, 1000);
  };

  pi.on("session_start", async (_event, ctx) => {
    turnStart = null;
    settled = true;
    stopTimer();
    // 立刻显示：上一轮的耗时，没有就显示占位符
    ctx.ui.setStatus(KEY, loadLast() ?? "—");
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (settled || turnStart === null) turnStart = Date.now(); // 新一轮才开始计时
    settled = false;
    ctx.ui.setStatus(KEY, fmt(Date.now() - turnStart));
    startTicking(ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    settled = true;
    stopTimer();
    if (turnStart !== null) {
      const text = fmt(Date.now() - turnStart);
      ctx.ui.setStatus(KEY, text);
      saveLast(text);
    }
  });

  pi.on("session_shutdown", async () => {
    stopTimer();
  });
}
