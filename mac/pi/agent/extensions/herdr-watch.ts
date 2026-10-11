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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HERDR_ENV = process.env.HERDR_ENV;
const SOCKET_PATH = process.env.HERDR_SOCKET_PATH;
const MY_PANE = process.env.HERDR_PANE_ID;

// 推送这两种状态。done = 干完还没被看过；blocked = 在等人回话。
const PUSH_STATES = new Set(["blocked", "done"]);
// 同一 pane 两次推送之间的最短间隔（毫秒）。
const COOLDOWN_MS = 8000;
// 重连退避上限。
const MAX_BACKOFF_MS = 30000;
// 每隔多久刷新一次 pane 列表，给新开的 pane 补订阅。
const REFRESH_MS = 60000;

function enabled(): boolean {
	return HERDR_ENV === "1" && !!SOCKET_PATH && !!MY_PANE;
}

export default function (pi: ExtensionAPI) {
	if (!enabled()) {
		return;
	}

	let socket: net.Socket | undefined;
	let closed = false;
	let backoff = 500;
	let lineBuf = "";
	let pendingPanes: string[] = [];
	const subscribed = new Set<string>();
	const lastPushAt = new Map<string, number>();
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let reqSeq = 0;

	function request(method: string, params: Record<string, unknown>): void {
		if (!socket || socket.destroyed) {
			return;
		}
		reqSeq += 1;
		const id = `watch:${reqSeq}`;
		socket.write(`${JSON.stringify({ id, method, params })}\n`);
	}

	function subscribeTo(panes: string[]): void {
		const fresh = panes.filter((p) => p && p !== MY_PANE && !subscribed.has(p));
		if (fresh.length === 0) {
			return;
		}
		for (const p of fresh) {
			subscribed.add(p);
		}
		request("events.subscribe", {
			subscriptions: fresh.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id })),
		});
	}

	function handleLine(line: string): void {
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}

		// pane.list 的回复：给其中的 pane 补订阅。
		const panes = msg?.result?.panes;
		if (Array.isArray(panes)) {
			subscribeTo(panes.map((p: any) => p?.pane_id).filter((x: unknown) => typeof x === "string"));
			return;
		}

		// 订阅确认：忽略（只在首次确认时通知一次）。
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

		const label = status === "blocked" ? "在等你回话（blocked）" : "干完了（done）";
		pi.sendMessage(
			{
				customType: "herdr-watch",
				content:
					`[herdr 推送] ${paneId} ${label}。\n` +
					`看现场：herdr agent read ${paneId} --source visible --lines 40\n` +
					`继续推主线：herdr pane send-text ${paneId} "<你的指示>" 然后 herdr pane send-keys ${paneId} enter（pi 要补一次 enter）`,
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
			connect();
		}, backoff);
		backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
	}

	function connect(): void {
		if (closed || socket) {
			return;
		}
		subscribed.clear();
		lineBuf = "";

		const s = net.createConnection(SOCKET_PATH!);
		socket = s;
		s.setEncoding("utf-8");

		s.on("connect", () => {
			backoff = 500;
			// 先拉 pane 列表，回复里会触发补订阅。
			request("pane.list", {});
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
			if (socket === s) {
				socket = undefined;
			}
			s.destroy();
			scheduleReconnect();
		};
		s.on("error", drop);
		s.on("close", drop);
	}

	pi.on("session_start", async (_event, ctx) => {
		// RPC/JSON/print 模式没有 PTY，herdr 显示不了；只服务 TUI。
		if (ctx?.mode !== "tui") {
			return;
		}
		closed = false;
		connect();
		refreshTimer = setInterval(() => {
			// 断线时由重连负责；在线时刷新列表，给新 pane 补订阅。
			if (socket && !socket.destroyed) {
				request("pane.list", {});
			}
		}, REFRESH_MS);
		refreshTimer.unref?.();

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
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = undefined;
		}
		socket?.destroy();
		socket = undefined;
	});
}
