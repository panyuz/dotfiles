/**
 * herdr-watch —— 把 herdr 其他 pane 的 agent 状态变化推进当前会话。
 *
 * 解决什么问题：
 *   主模型在 bash 里跑「轮询监视」时，一次调用要等到结束才返回，期间看不到任何变化。
 *   而 herdr 的 socket API 有 events.subscribe（服务端主动推送），本扩展把它接进 pi：
 *   别的 pane 一进入 blocked 或 done，就往本会话推一条消息并触发一轮（triggerTurn），
 *   于是监视从「定时问」变成「有事才喊」。
 *
 * 事实依据（本机实测 2026-10-11）：
 *   - socket 路径 = 环境变量 HERDR_SOCKET_PATH（本机 = ~/.config/herdr/herdr.sock）
 *   - events.subscribe 返回 {"result":{"type":"subscription_started"}}，之后按行推事件
 *   - 订阅 pane.agent_status_changed 必填 pane_id，agent_status 可选（本扩展不限定状态，
 *     收到后自行筛 blocked/done）
 *   - CAUTION herdr 的连接是请求/响应式的：pane.list 拿到回复后服务端会关连接。
 *     所以 pane.list 走短连接；events.subscribe 必须另开一条专用的长连接。
 *     两者放在同一条连接上会拿 BrokenPipeError（实测）。
 *   - 官方文档：herdr docs/socket-api —— 「Use the raw socket API ... for long-lived event subscriptions」
 *
 * 安全边界（重要）：
 *   - 不订阅自己的 pane（HERDR_PANE_ID）——否则自己的状态变化会把自己唤醒，形成回路。
 *   - 只在 TUI 模式启用（RPC/JSON/print 无 PTY，herdr 也看不到）。
 *   - 只推送 blocked 与 done 两种状态。working 与 idle 不推（idle 太频繁，会把会话吵死）。
 *   - 同一 pane 有冷却时间，避免状态抖动导致连续唤醒。
 *
 * 与同目录 herdr-agent-state.ts 的分工：
 *   那支是 herdr 官方集成的副本（pi → herdr：报告本 pane 状态），由 herdr 管理，更新会覆盖。
 *   本支是反方向（herdr → pi：订阅别的 pane），自定义文件，放在它旁边，互不影响。
 */

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
// 重连退避上限。
const MAX_BACKOFF_MS = 30000;
// 每隔多久刷新一次 pane 列表，给新开的 pane 补订阅。
const REFRESH_MS = 60000;

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

	let streamSocket: net.Socket | undefined;
	let closed = false;
	let backoff = 500;
	let lineBuf = "";
	let pendingPanes: string[] = [];
	const subscribed = new Set<string>();
	const lastPushAt = new Map<string, number>();
	let lastAnyPushAt = 0;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let reqSeq = 0;

	function request(method: string, params: Record<string, unknown>): void {
		if (!streamSocket || streamSocket.destroyed) {
			return;
		}
		reqSeq += 1;
		const id = `watch:${reqSeq}`;
		streamSocket.write(`${JSON.stringify({ id, method, params })}\n`);
	}

	function subscribeTo(panes: { pane_id: string; cwd?: string }[]): void {
		// 只订阅「与本 pane 同一个 cwd」的 agent：避免被别的项目（例如 comtools）唤醒。
		// MY_CWD 由 pi 进程的 cwd 给出；无 cwd 信息的 pane 跳过。
		const fresh = panes
			.filter((p) => p?.pane_id && p.pane_id !== MY_PANE && !subscribed.has(p.pane_id))
			// 同项目即可：主仓 INVEST 与它的 worktree INVEST-slim 视为同一项目（前缀互含）。
			.filter((p) => !MY_CWD || !p.cwd || p.cwd.startsWith(MY_CWD) || MY_CWD.startsWith(p.cwd))
			.map((p) => p.pane_id);
		if (fresh.length === 0) {
			return;
		}
		for (const p of fresh) {
			subscribed.add(p);
		}
		// 订阅必须在长连接上发（streamSocket）。
		writeToStream({
			id: `sub:${++reqSeq}`,
			method: "events.subscribe",
			params: {
				subscriptions: fresh.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id })),
			},
		});
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
							.map((p: any) => ({ pane_id: p.pane_id as string, cwd: p.cwd as string | undefined }));
						dbg(`pane.list 返回 ${list.length} 个：${list.map((p) => `${p.pane_id}@${(p.cwd || "?").split("/").pop()}`).join(",")}`);
						subscribeTo(list);
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

	function writeToStream(obj: Record<string, unknown>): void {
		if (!streamSocket || streamSocket.destroyed) {
			dbg(`writeToStream 跳过（无流或已销毁）：${JSON.stringify(obj).slice(0, 80)}`);
			return;
		}
		streamSocket.write(`${JSON.stringify(obj)}\n`);
		dbg(`writeToStream 已写：${JSON.stringify(obj).slice(0, 120)}`);
	}

	function handleLine(line: string): void {
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}

		// 订阅确认：忽略。
		if (msg?.result?.type === "subscription_started") {
			return;
		}

		// 事件推送。
		if (typeof msg?.event !== "string" || msg.event !== "pane.agent_status_changed") {
			return;
		}
		const paneId: string | undefined = msg?.data?.pane_id ?? msg?.pane_id;
		const status: string | undefined = msg?.data?.agent_status ?? msg?.data?.status;
		if (!paneId || paneId === MY_PANE || !status || !PUSH_STATES.has(status)) {
			return;
		}

		const now = Date.now();
		const last = lastPushAt.get(paneId) ?? 0;
		if (now - last < COOLDOWN_MS) {
			return;
		}
		lastPushAt.set(paneId, now);
		lastAnyPushAt = now;

		const label = status === "blocked" ? "在等你回话（blocked）" : "干完了（done）";
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

	function scheduleReconnect(): void {
		if (closed) {
			return;
		}
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
		}
		reconnectTimer = setTimeout(() => {
			reconnectTimer = undefined;
			connectStream();
		}, backoff);
		backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
	}

	/** 长连接：订阅事件并收推送。断线后重连，重连时重新拉列表补订阅。 */
	function connectStream(): void {
		if (closed || streamSocket) {
			return;
		}
		subscribed.clear();
		lineBuf = "";

		const s = net.createConnection(SOCKET_PATH!);
		streamSocket = s;
		s.setEncoding("utf-8");

		s.on("connect", () => {
			backoff = 500;
			dbg("stream 长连接已建立");
			// 先在短连接上取列表，拿到列表后会在长连接上补订阅。
			listPanesOnce();
		});

		s.on("data", (chunk: string) => {
			lineBuf += chunk;
			let idx: number;
			while ((idx = lineBuf.indexOf("\n")) >= 0) {
				const line = lineBuf.slice(0, idx);
				lineBuf = lineBuf.slice(idx + 1);
				if (line.trim()) {
					handleLine(line);
				}
			}
		});

		const drop = () => {
			dbg("stream 连接关闭/出错 → 安排重连");
			if (streamSocket === s) {
				streamSocket = undefined;
			}
			s.destroy();
			scheduleReconnect();
		};
		s.on("error", (e) => dbg(`stream 错误：${String(e)}`));
		s.on("error", drop);
		s.on("close", drop);
	}

	pi.on("session_start", async (_event, ctx) => {
		// RPC/JSON/print 模式没有 PTY，herdr 显示不了；只服务 TUI。
		if (ctx?.mode !== "tui") {
			return;
		}
		closed = false;
		lastAnyPushAt = Date.now();
		connectStream();
		refreshTimer = setInterval(() => {
			// 断线时由重连负责；在线时刷新列表，给新 pane 补订阅。
			if (streamSocket && !streamSocket.destroyed) {
				listPanesOnce();
			}
		}, REFRESH_MS);
		refreshTimer.unref?.();

		// 心跳：静默期定期提一条，让主模型回头看主线（用户要求「固定时间提醒」）。
		if (HEARTBEAT_MS > 0) {
			heartbeatTimer = setInterval(() => {
				const now = Date.now();
				if (now - lastAnyPushAt < HEARTBEAT_MS) {
					return; // 刚刚有推送，不吵
				}
				lastAnyPushAt = now;
				const watched = [...subscribed].sort().join(" ") || "（无）";
				pi.sendMessage(
					{
						customType: "herdr-watch-heartbeat",
						content:
							`[herdr-watch 心跳] 已 ${Math.round(HEARTBEAT_MS / 60000)} 分钟无状态变化。` +
							`当前订阅：${watched}。建议查一次主线：\n` +
							`  herdr agent list\n` +
							`  herdr agent read <pane> --source visible --lines 20`,
						display: true,
						details: { watched: [...subscribed], at: new Date(now).toISOString() },
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
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = undefined;
		}
		streamSocket?.destroy();
		streamSocket = undefined;
	});
}
