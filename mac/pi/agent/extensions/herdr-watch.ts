/* herdr-watch —— 盯住同项目其他 agent 的状态变化，变化时唤醒本会话。

   设计（2026-10-11 晚改定，依据 comtools 的 herdr 事件等待调研报告）：

   ① 长命订阅做事件源（主通道）
      - 一条 events.subscribe 连接。订阅四个**不需要 pane_id** 的事件：
        pane.agent_detected · pane.exited · pane.updated · workspace.created
      - 不要订阅 pane.agent_status_changed：它必须带具体 pane_id，而任何一个
        pane_id 失效都会让**整个请求**被拒（来源：调研报告 第三部分 · 实测）。
      - 连接建立后**立即写出订阅请求**（服务端 INITIAL_REQUEST_TIMEOUT = 5 秒，
        超时即关）。不得「先连接、再做异步准备、再发请求」。
      - ack（subscription_started）之后**绝不在该连接上写第二个字节**：服务端的
        probe_stream_closed 把任意入站字节判为「对端已关闭」。

   ② 短连接对账（兜底 + 权威状态来源）
      - 收到任何事件 → 防抖 400 毫秒 → 开一条短连接问 pane.list → 与上一轮
        快照比对 → 某 pane 的状态「进入」blocked 或 done 时推送。
      - 事件流健康时，兜底 tick 30 秒一次。事件流断开时，对账间隔降到 5 秒。
      - 这样 agent 状态只从 pane.list 全量结果里拿，天然免疫 pane 增删。

   ③ 断开处理
      - events_lost 或读取失败 → 关连接 → 指数退避 1 秒到 30 秒 → 重开并重新订阅。
      - 重连期间走降级对账（5 秒）。

   社区同型做法（来源：调研报告 第四部分）：
     - 0cv/herdr-mobile-relay：长命订阅 + 独立快照引导，事件流健康时轮询放慢。
     - timvdhoorn/stream-deck-herdr-plugin：订阅 + 全量刷新，退避 1 秒到 30 秒。
     - douglascorrea/herdr-agent-inbox：订阅 + 0.4 秒防抖 + 30 秒兜底 tick。

   只服务 TUI 模式（RPC/JSON/print 没有 PTY，herdr 显示不了）。
   只监控名单文件里的 pane（见 WATCH_LIST）。文件不存在 = 谁都不监控。
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
		// 日志写不了就算了，不阻塞主流程
	}
}

const HERDR_ENV = process.env.HERDR_ENV;
const SOCKET_PATH = process.env.HERDR_SOCKET_PATH;
const MY_PANE = process.env.HERDR_PANE_ID;
// 本 pane 的工作目录。只关心同项目的 agent，避免被别的项目唤醒。
const MY_CWD = process.env.HERDR_CWD || process.env.PWD || process.cwd();

// 推送这两种状态。done = 干完还没被看过；blocked = 在等人回话。
const PUSH_STATES = new Set(["blocked", "done"]);
// 同一个 pane 两次推送之间的最短间隔（毫秒）。
const COOLDOWN_MS = 8000;
// 心跳：这么久没有任何推送时，主动提一条。有推送就不提。设 0 关闭。
const HEARTBEAT_MS = 20 * 60 * 1000;

// 订阅的事件类型。全部不需要 pane_id（调研报告 第三部分）。
const STREAM_EVENTS = [
	{ type: "pane.agent_detected" },
	{ type: "pane.exited" },
	{ type: "pane.updated" },
	{ type: "workspace.created" },
];

// 事件到达后的防抖时长：短时间内多个事件合成一次对账。
const DEBOUNCE_MS = 400;
// 事件流健康时的兜底对账间隔。
const RECONCILE_MS_HEALTHY = 30000;
// 事件流断开时的对账间隔。
const RECONCILE_MS_DEGRADED = 5000;
// 重连退避：1 秒起，上限 30 秒。
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30000;
// 单条短连接的兜底超时。
const SHORT_CALL_TIMEOUT_MS = 4000;

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
	let streamSocket: net.Socket | undefined;
	let streamBuf = "";
	let reqSeq = 0;

	let backoff = BACKOFF_MIN_MS;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let reconcileTimer: ReturnType<typeof setInterval> | undefined;
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

	// 事件流是否健康。决定兜底对账的间隔。
	let streamHealthy = false;
	// 上一轮各 pane 的状态快照。用来判断「状态进入」。
	const lastStates = new Map<string, string>();
	const lastPushAt = new Map<string, number>();
	let lastAnyPushAt = 0;

	/* ───────────── 短连接：对账 ───────────── */

	/** 开一条短连接问 pane.list。herdr 是一问一答：答完服务端就关连接。 */
	function reconcile(): void {
		if (closed) {
			return;
		}
		const s = net.createConnection(SOCKET_PATH!);
		s.setEncoding("utf-8");
		let buf = "";
		let done = false;
		const finish = () => {
			if (done) {
				return;
			}
			done = true;
			s.destroy();
		};
		s.on("connect", () => {
			// 立即写。服务端 5 秒内没收到请求就会关掉这条连接。
			s.write(`${JSON.stringify({ id: `recon:${++reqSeq}`, method: "pane.list", params: {} })}\n`);
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
					const msg = JSON.parse(line) as { result?: { panes?: unknown } };
					const panes = msg?.result?.panes;
					if (Array.isArray(panes)) {
						diffAndPush(panes as PaneInfo[]);
					}
				} catch (e) {
					dbg(`对账回复解析失败：${String(e)}`);
				}
			}
			finish();
		});
		s.on("error", (e) => {
			dbg(`对账连接错误：${String(e)}`);
			finish();
		});
		s.on("close", finish);
		setTimeout(finish, SHORT_CALL_TIMEOUT_MS).unref?.();
	}

	interface PaneInfo {
		pane_id?: string;
		cwd?: string;
		agent_status?: string;
	}

	/** 比对状态快照，对进入 blocked 或 done 的 pane 发推送。 */
	function diffAndPush(panes: PaneInfo[]): void {
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

	/** 事件到达后防抖，再触发一次对账。 */
	function scheduleReconcile(): void {
		if (debounceTimer) {
			return;
		}
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			reconcile();
		}, DEBOUNCE_MS);
		debounceTimer.unref?.();
	}

	/** 按事件流健康度设置兜底对账的间隔。 */
	function refreshTick(): void {
		const want = streamHealthy ? RECONCILE_MS_HEALTHY : RECONCILE_MS_DEGRADED;
		if (reconcileTimer && (reconcileTimer as unknown as { _herdrMs?: number })._herdrMs === want) {
			return;
		}
		if (reconcileTimer) {
			clearInterval(reconcileTimer);
		}
		const t = setInterval(reconcile, want);
		(t as unknown as { _herdrMs?: number })._herdrMs = want;
		t.unref?.();
		reconcileTimer = t;
		dbg(`兜底对账间隔 = ${want} 毫秒（事件流${streamHealthy ? "健康" : "断开"}）`);
	}

	/* ───────────── 长连接：订阅事件 ───────────── */

	function connectStream(): void {
		if (closed || streamSocket) {
			return;
		}
		streamBuf = "";
		const s = net.createConnection(SOCKET_PATH!);
		streamSocket = s;
		s.setEncoding("utf-8");

		s.on("connect", () => {
			// 立即写。服务端 INITIAL_REQUEST_TIMEOUT = 5 秒，超时就关这条连接。
			s.write(
				`${JSON.stringify({ id: `sub:${++reqSeq}`, method: "events.subscribe", params: { subscriptions: STREAM_EVENTS } })}\n`,
			);
		});

		s.on("data", (chunk: string) => {
			streamBuf += chunk;
			let idx: number;
			while ((idx = streamBuf.indexOf("\n")) >= 0) {
				const line = streamBuf.slice(0, idx);
				streamBuf = streamBuf.slice(idx + 1);
				if (line.trim()) {
					handleStreamLine(line);
				}
			}
		});

		const drop = () => {
			if (streamSocket !== s) {
				return;
			}
			streamSocket = undefined;
			streamHealthy = false;
			refreshTick();
			s.destroy();
			if (!closed) {
				dbg("订阅连接断开 → 安排重连");
				scheduleReconnect();
			}
		};
		s.on("error", (e) => {
			dbg(`订阅连接错误：${String(e)}`);
			drop();
		});
		s.on("close", drop);
	}

	function handleStreamLine(line: string): void {
		let msg: { result?: { type?: string }; event?: string };
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		// 订阅确认。
		if (msg?.result?.type === "subscription_started") {
			if (!streamHealthy) {
				streamHealthy = true;
				backoff = BACKOFF_MIN_MS;
				refreshTick();
				dbg("订阅已确认（subscription_started）");
			}
			return;
		}
		// 事件丢失：缓存已失效，必须重订。
		if (msg?.result?.type === "events_lost" || msg?.event === "events_lost") {
			dbg("收到 events_lost → 重开订阅");
			streamSocket?.destroy();
			return;
		}
		// 其他事件：不解析内容，只当作「状态可能变了」的信号，触发对账。
		if (typeof msg?.event === "string") {
			scheduleReconcile();
		}
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
		backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
	}

	/* ───────────── 生命周期 ───────────── */

	pi.on("session_start", async (_event, ctx) => {
		// RPC/JSON/print 模式没有 PTY，herdr 显示不了；只服务 TUI。
		if (ctx?.mode !== "tui") {
			return;
		}
		closed = false;
		lastAnyPushAt = Date.now();
		lastStates.clear();

		// 官方要求的顺序：先订阅，读到 ack，再对账。中间的事件先缓冲（本实现里
		// 事件只触发对账，所以顺序天然安全）。
		connectStream();
		reconcile();
		refreshTick();

		// 心跳：静默期定期提一条，让主模型回头看主线。
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
							`已知 pane：${watched}。建议查一次主线：\n` +
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
			ctx.ui.notify(`herdr-watch：订阅事件 + 对账（本 pane ${MY_PANE}）`, "info");
		}
	});

	pi.on("session_shutdown", async () => {
		closed = true;
		streamSocket?.destroy();
		streamSocket = undefined;
		for (const t of [reconnectTimer, debounceTimer]) {
			if (t) {
				clearTimeout(t);
			}
		}
		for (const t of [reconcileTimer, heartbeatTimer]) {
			if (t) {
				clearInterval(t);
			}
		}
		reconnectTimer = undefined;
		debounceTimer = undefined;
		reconcileTimer = undefined;
		heartbeatTimer = undefined;
	});
}
