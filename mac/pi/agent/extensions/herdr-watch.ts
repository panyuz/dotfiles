/* herdr-watch —— 盯住同项目的其他 agent，状态变化时唤醒本会话。

   机制（2026-10-11 晚改定）：
   - 每 POLL_MS 毫秒开一条**短连接**问一次 pane.list，拿到快照后关掉。
   - 本地比对上一轮快照。某 pane 的状态「进入」blocked 或 done 时，发一条消息唤醒本会话。
   - 只服务 TUI 模式（RPC/JSON/print 没有 PTY，herdr 显示不了）。
   - 只监控名单文件里的 pane（见 WATCH_LIST）。文件不存在 = 谁都不监控。

   为什么用轮询而不是 events.subscribe：
   herdr 的 socket 是**一问一答**语义。2026-10-11 实测三个对照：
     1 静默长连接 → 活满 25 秒未被关。
     2 在同一长连接上再发一次 events.subscribe → 服务端在收到那一刻立即关闭。
   （第三条：一问一答连接上发 pane.list，服务端答完就关，这是正常语义。）
   旧实现靠长连接订阅，重连后状态不同步时会在同一连接上再订阅 → 被踢 → 重连 → 再被踢。
   当日实测重连 2620 次（约每 13 秒一次），推送随机丢失。改轮询后无此问题。

   排障日志：/tmp/herdr-watch.log（设 HERDR_WATCH_DEBUG=0 关）。 */


import net from "node:net";
import fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 排障日志（失败不影响主流程）。设 HERDR_WATCH_DEBUG=0 可关。
const DEBUG = process.env.HERDR_WATCH_DEBUG !== "0";
const DEBUG_LOG = "/tmp/herdr-watch.log";
function dbg(msg: string): void {
	if (!DEBUG) {
		return;
	}
	try {
		fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
	} catch {
		// 日志写不了就算了，不阻塞订阅
	}
}

const HERDR_ENV = process.env.HERDR_ENV;
const SOCKET_PATH = process.env.HERDR_SOCKET_PATH;
const MY_PANE = process.env.HERDR_PANE_ID;
// 本 pane 的工作目录。只订阅同目录的 agent，避免被别的项目的 pane 唤醒。
const MY_CWD = process.env.HERDR_CWD || process.env.PWD || process.cwd();

// 推送这两种状态。done = 干完还没被看过；blocked = 在等人回话。
const PUSH_STATES = new Set(["blocked", "done"]);
// 同一 pane 两次推送之间的最短间隔（毫秒）。
const COOLDOWN_MS = 8000;
// 心跳：这么久没有任何推送时，主动提一条（让主模型定期回头看主线）。
// 2026-10-11 调整：10 分钟太吵 → 60 分钟 → 用户改定 20 分钟。
// 有推送就不提（静默期才有心跳）。设 0 关闭。
const HEARTBEAT_MS = 20 * 60 * 1000;
// 轮询间隔（用户令 2026-10-11 晚：改用轮询，不用订阅）。
//
// 为什么不订阅：herdr 的 socket 是一问一答语义。2026-10-11 实测三个对照：
//   1 静默长连接 → 活满 25 秒未被关。
//   2 在同一长连接上再发一次 events.subscribe → 服务端在收到那一刻立即关闭。
// 旧实现靠长连接订阅。重连后状态不同步时就可能在同一连接上再订阅一次 → 被踢 →
// 重连 → 再被踢。当日实测重连 2620 次（约每 13 秒一次），推送随机丢失。
// 改法：只做短连接轮询。每轮拿 pane.list 快照，本地比对状态变化后推送。
const POLL_MS = 5000;

// 监控名单文件：只有名单里的 pane 才做监控。
// 本扩展装在全局扩展目录，每个 pi 会话都会加载它。若不做区分，同一项目的每个面板都会
// 收到推送（例如 agent 面板被唤醒去处理别的 agent 的事件），造成互相唤醒。
// 名单一行一个 pane id。文件不存在 = 谁都不监控（安全默认）。
const WATCH_LIST = "/Users/panyu/.config/herdr/watch-panes";

function listedAsWatcher(): boolean {
	try {
		if (!MY_PANE) {
			return false;
		}
		if (!fs.existsSync(WATCH_LIST)) {
			return false;
		}
		const lines = fs.readFileSync(WATCH_LIST, "utf8").split(/\r?\n/);
		return lines.map((l) => l.trim()).filter(Boolean).includes(MY_PANE);
	} catch {
		return false;
	}
}

function enabled(): boolean {
	return HERDR_ENV === "1" && !!SOCKET_PATH && !!MY_PANE && listedAsWatcher();
}

export default function (pi: ExtensionAPI) {
	if (!enabled()) {
		return;
	}

	let closed = false;
	const lastPushAt = new Map<string, number>();
	let lastAnyPushAt = 0;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let reqSeq = 0;

	/** 上一轮各 pane 的状态快照。轮询用它判断「状态进入」——订阅式事件的等价物。 */
	const lastStates = new Map<string, string>();

	/** 比对状态快照，对进入 blocked 或 done 的 pane 发推送。 */
	function pollSnapshot(panes: { pane_id: string; cwd?: string; agent_status?: string }[]): void {
		const seen = new Set<string>();
		for (const p of panes) {
			const paneId = p?.pane_id;
			if (typeof paneId !== "string") {
				continue;
			}
			seen.add(paneId);
			const status = p.agent_status;
			if (!status) {
				continue;
			}
			const prev = lastStates.get(paneId);
			lastStates.set(paneId, status);
			// 本 pane 跳过。状态没变不算事件。不是推送状态不算事件。
			if (paneId === MY_PANE || prev === status || !PUSH_STATES.has(status)) {
				continue;
			}
			// 同项目才算：主仓 INVEST 与 worktree INVEST-slim 前缀互含。别的项目不打扰。
			if (MY_CWD && p.cwd && !p.cwd.startsWith(MY_CWD) && !MY_CWD.startsWith(p.cwd)) {
				continue;
			}
			push(paneId, status);
		}
		for (const k of [...lastStates.keys()]) {
			if (!seen.has(k)) {
				lastStates.delete(k);
			}
		}
	}

	/** 发一条推送。冷却时间内不重复推同一个 pane。 */
	function push(paneId: string, status: string): void {
		const now = Date.now();
		const last = lastPushAt.get(paneId) ?? 0;
		if (now - last < COOLDOWN_MS) {
			return;
		}
		lastPushAt.set(paneId, now);
		lastAnyPushAt = now;
		const label = status === "blocked" ? "在等你回话（blocked）" : "干完了（done）";
		dbg(`推送 pane=${paneId} status=${status}`);
		pi.sendMessage(
			{
				customType: "herdr-watch",
				content:
					`[herdr 推送] ${label}：${paneId}\n` +
					`看现场：herdr agent read ${paneId} --source visible --lines 40\n` +
					`它是本项目的 agent。按需回复：herdr pane send-text ${paneId} "<指示>" 然后 herdr pane send-keys ${paneId} enter（pi 要补一次 enter）`,
				display: true,
				details: { paneId, status, at: new Date(now).toISOString() },
			},
			{ triggerTurn: true },
		);
	}

	/** 短连接查一次 pane.list。herdr 的连接是请求/响应式：拿到回复后服务端会关它。 */
	function listPanesOnce(): void {
		if (closed) {
			return;
		}
		const s = net.createConnection(SOCKET_PATH!);
		s.setEncoding("utf-8");
		let buf = "";
		const done = () => s.destroy();
		s.on("connect", () => {
			dbg("list 短连接已连上，发 pane.list");
			s.write(`${JSON.stringify({ id: `list:${++reqSeq}`, method: "pane.list", params: {} })}\n`);
		});
		s.on("data", (chunk: string) => {
			buf += chunk;
			let idx: number;
			while ((idx = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, idx);
				buf = buf.slice(idx + 1);
				if (!line.trim()) {
					continue;
				}
				try {
					const msg = JSON.parse(line) as any;
					const panes = msg?.result?.panes;
					if (Array.isArray(panes)) {
						const list = panes
							.filter((p: any) => typeof p?.pane_id === "string")
							.map((p: any) => ({
								pane_id: p.pane_id as string,
								cwd: p.cwd as string | undefined,
								agent_status: p.agent_status as string | undefined,
							}));
						pollSnapshot(list);
					}
				} catch (e) {
					dbg(`list 回复解析失败：${String(e)}`);
				}
			}
		});
		s.on("error", (e) => {
			dbg(`list 短连接错误：${String(e)}`);
			done();
		});
		s.on("close", done);
		setTimeout(done, 5000).unref?.();
	}

	pi.on("session_start", async (_event, ctx) => {
		// RPC/JSON/print 模式没有 PTY，herdr 显示不了；只服务 TUI。
		if (ctx?.mode !== "tui") {
			return;
		}
		closed = false;
		lastAnyPushAt = Date.now();
		lastStates.clear();
		listPanesOnce();
		refreshTimer = setInterval(listPanesOnce, POLL_MS);
		refreshTimer.unref?.();

		// 心跳：静默期定期提一条，让主模型回头看主线（用户要求「固定时间提醒」）。
		if (HEARTBEAT_MS > 0) {
			heartbeatTimer = setInterval(() => {
				const now = Date.now();
				if (now - lastAnyPushAt < HEARTBEAT_MS) {
					return; // 刚刚有推送，不吵
				}
				lastAnyPushAt = now;
				const watched = [...lastStates.keys()].sort().join(" ") || "（无）";
				pi.sendMessage(
					{
						customType: "herdr-watch-heartbeat",
						content:
							`[herdr-watch 心跳] 已 ${Math.round(HEARTBEAT_MS / 60000)} 分钟无状态变化。` +
							`当前订阅：${watched}。建议查一次主线：\n` +
							`  herdr agent list\n` +
							`  herdr agent read <pane> --source visible --lines 20`,
						display: true,
						details: { watched: [...lastStates.keys()], at: new Date(now).toISOString() },
					},
					{ triggerTurn: true },
				);
			}, HEARTBEAT_MS);
			heartbeatTimer.unref?.();
		}

		if (ctx.hasUI) {
			ctx.ui.notify(`herdr-watch：订阅 ${SOCKET_PATH}（排除本 pane ${MY_PANE}）`, "info");
		}
	});

	pi.on("session_shutdown", async () => {
		closed = true;
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = undefined;
		}
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = undefined;
		}
	});
}
