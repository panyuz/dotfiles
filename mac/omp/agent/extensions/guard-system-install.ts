/**
 * guard-system-install-kimi.ts
 *
 * pi / omp extension：拦截一切往 macOS 系统或用户全局环境安装依赖的 bash 命令。
 * 项目约束（AGENTS.md）：只允许 uv / bun 等项目级隔离安装；
 * 禁止 pip install / brew install / npm -g / sudo installer / curl|sh 等系统级安装。
 *
 * 相对 naive 黑名单正则的改进：
 * 1. 按 shell 分隔符（&&  ||  ;  |  换行）切分段落逐段分析，拼接命令无法绕过。
 * 2. 每段先剥离包装前缀（VAR=val、env、command、nice、arch、exec 等），
 *    再取命令头的 basename 匹配（/usr/bin/pip3 也能命中）。
 * 3. sudo 一律拦截——提权后可绕过任何包级规则（sudo installer / sudo cp 到 /usr/local）。
 * 4. 全局安装按"工具 + 全局标志"组合判定：-g / --global 出现在任意位置都拦截，
 *    覆盖 npm i -g、npm -g install、pnpm add --global 等词序变体。
 * 5. eval / sh -c / python -c 等"不透明执行"段在保留引号的原文上匹配，
 *    防止把命令藏进引号；普通命令则先剥掉引号内容再匹配，
 *    避免误伤 git commit -m "fix brew install docs" 这类纯文本。
 * 6. 远程脚本安装整体拦截：curl ... | sh、sh -c "$(curl ...)"、sh <(curl ...)、eval "$(curl ...)"。
 * 7. uv 精细放行：uv run / uv add / uvx / uv pip install（进项目 venv）放行；
 *    仅拦截 uv pip install --system 与 uv tool install（装到 ~/.local，非项目级）。
 * 8. 无 UI 时 fail-closed 直接拒绝；有 UI 时提供"放行一次"人工逃生口。
 *
 * 已知残余风险（正则/静态分析守卫的根本局限，需 sandbox 或网络层防护兜底）：
 * - 变量/别名/命令替换拼接：`P=pip; $P install x`、`$(echo pip) install x`
 * - 脚本文件内的间接安装：`bash setup.sh`、`source x.sh`、`make install`
 * - API 级安装：`python -c "import pip; pip.main(['install','x'])"`
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface Verdict {
  blocked: boolean;
  rule?: string;
  reason?: string;
  segment?: string;
}

// ---------- 基础工具 ----------

const QUOTED_SPAN_RE = /'[^']*'|"[^"]*"/g;

/**
 * 引号感知的分段：&& || ; | 换行 只有在引号外才是 shell 分隔符。
 * 必须如此：`python3 -c "import os; os.system('pip install x')"` 里的分号
 * 是 Python 代码，切错了会让系统安装命令逃出"不透明执行"段的检查。
 */
function splitSegments(raw: string): string[] {
  const segments: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      cur += ch;
      if (ch === "\\" && quote === '"') {
        cur += raw[++i] ?? "";
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "\n" || ch === "\r" || ch === ";") {
      segments.push(cur);
      cur = "";
      continue;
    }
    if (ch === "&" && raw[i + 1] === "&") {
      segments.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (ch === "|") {
      if (raw[i + 1] === "|") i++;
      segments.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  segments.push(cur);
  return segments;
}

// 可剥离的执行包装前缀：环境变量赋值、command/builtin/exec、env、nice、time、arch、stdbuf
const WRAPPER_RE =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=\S+|command|builtin|noglob|exec|time|nice(?:\s+-n\s+\d+)?|stdbuf(?:\s+-\S+)+|arch(?:\s+-\S+)?|env(?:\s+(?:-\S+|--\S+|[A-Za-z_][A-Za-z0-9_]*=\S+))*)\s+/;

/** 全局标志 -g / --global，出现在参数串任意位置（含子命令之前）都算 */
const hasGlobalFlag = (rest: string): boolean =>
  /(?:^|\s)(?:-g|--global)(?=[\s=]|$)/.test(rest);

/** rest 中是否出现某个独立词（子命令），前后必须是空白/边界，避免 uninstall 误命中 install */
const hasWord = (rest: string, words: string[]): boolean =>
  new RegExp(`(?:^|\\s)(?:${words.join("|")})(?=\\s|$)`).test(rest);

// ---------- 规则表：命令头 + 剩余参数判定 ----------

interface Rule {
  id: string;
  reason: string;
  head: RegExp;
  test: (rest: string) => boolean;
}

const RULES: Rule[] = [
  {
    id: "sudo",
    head: /^sudo$/,
    reason: "sudo 提权执行：可绕过一切包级拦截（sudo installer / sudo cp 到系统目录等）",
    test: () => true,
  },
  {
    id: "installer",
    head: /^installer$/,
    reason: "macOS installer 直装 .pkg 到系统卷",
    test: () => true,
  },
  {
    id: "pip-install",
    head: /^pip(?:\d+(?:\.\d+)*)?$/,
    reason: "pip install 装入系统/用户 Python（含 pip3.11 等带版本号变体）",
    test: (r) => hasWord(r, ["install"]),
  },
  {
    id: "python-pip",
    head: /^python(?:\d+(?:\.\d+)*)?$/,
    reason: "python -m pip install / ensurepip 装入系统 Python（含 python3.12 等变体）",
    test: (r) => /(?:^|\s)-m\s+(?:pip\b[\s\S]*\binstall\b|ensurepip\b)/.test(r),
  },
  {
    id: "uv-global",
    head: /^uv$/,
    reason: "uv pip install --system / uv tool install 装到系统 Python 或 ~/.local，非项目级隔离",
    test: (r) =>
      (/(?:^|\s)pip\s+install\b/.test(r) && /--system\b/.test(r)) ||
      /(?:^|\s)tool\s+install(?:\s|$)/.test(r),
  },
  {
    id: "brew",
    head: /^brew$/,
    reason: "brew install/reinstall/upgrade 装入 /opt/homebrew（系统级）",
    test: (r) => hasWord(r, ["install", "reinstall", "upgrade"]),
  },
  {
    id: "npm-global",
    head: /^npm$/,
    reason: "npm 全局安装或 link（-g/--global 在任意位置均拦截；npm ls -g 等只读命令放行）",
    test: (r) =>
      hasWord(r, ["link", "ln"]) ||
      (hasGlobalFlag(r) && hasWord(r, ["i", "install", "add", "link", "ln"])),
  },
  {
    id: "pnpm-global",
    head: /^pnpm$/,
    reason: "pnpm 全局安装（-g/--global 在任意位置均拦截）",
    test: (r) => hasGlobalFlag(r) && hasWord(r, ["i", "install", "add", "link"]),
  },
  {
    id: "bun-global",
    head: /^bun$/,
    reason: "bun 全局安装（-g/--global 在任意位置均拦截；项目级 bun add/install 放行）",
    test: (r) => hasGlobalFlag(r) && hasWord(r, ["i", "install", "add", "link"]),
  },
  {
    id: "yarn-global",
    head: /^yarn$/,
    reason: "yarn global 装到全局目录（项目级 yarn add 放行）",
    test: (r) => hasWord(r, ["global"]),
  },
  {
    id: "deno-install",
    head: /^deno$/,
    reason: "deno install 带入口文件或 -g 时装到 ~/.deno/bin（裸 deno install 装项目依赖，放行）",
    test: (r) => {
      if (!hasWord(r, ["install"])) return false;
      if (hasGlobalFlag(r)) return true;
      // install 之后出现非 flag 参数（脚本/URL），即为全局安装可执行文件
      const after = r.replace(/(?:^|\s)install\b/, " ");
      return after.split(/\s+/).some((t) => t.length > 0 && !t.startsWith("-"));
    },
  },
  {
    id: "cargo-install",
    head: /^cargo$/,
    reason: "cargo install 装到 ~/.cargo/bin（用户全局）",
    test: (r) => hasWord(r, ["install"]),
  },
  {
    id: "go-install",
    head: /^go$/,
    reason: "go install 装到 ~/go/bin（用户全局）",
    test: (r) => hasWord(r, ["install"]),
  },
  {
    id: "gem-install",
    head: /^gem$/,
    reason: "gem install 装入系统/用户 Ruby",
    test: (r) => hasWord(r, ["install"]),
  },
  {
    id: "pipx-install",
    head: /^pipx$/,
    reason: "pipx install 装到 ~/.local，非项目级隔离（临时隔离运行请用 uv run --with / uvx）",
    test: (r) => hasWord(r, ["install"]),
  },
  {
    id: "mas-install",
    head: /^mas$/,
    reason: "mas install 从 Mac App Store 装应用（系统级）",
    test: (r) => hasWord(r, ["install"]),
  },
  {
    id: "macports",
    head: /^port$/,
    reason: "MacPorts port install/selfupdate/upgrade（系统级）",
    test: (r) => hasWord(r, ["install", "selfupdate", "upgrade"]),
  },
  {
    id: "nix-env",
    head: /^nix-env$/,
    reason: "nix-env -i 装入用户 profile",
    test: (r) => /(?:^|\s)-iA?(?=\s|$)/.test(r),
  },
];

// ---------- 远程脚本安装（对整个命令原文判定） ----------

const GLOBAL_RULES: Array<{ id: string; reason: string; re: RegExp }> = [
  {
    id: "remote-pipe-shell",
    reason: "远程脚本管道执行（curl/wget ... | sh），等价于未审计的系统安装",
    re: /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+|command\s+|env\s+)*(?:ba|z|fi|da|k)?sh\b/,
  },
  {
    id: "remote-subst-shell",
    reason: 'sh -c "$(curl ...)" / eval "$(curl ...)"：下载并直接执行远程脚本',
    re: /(?:\b(?:ba|z|fi|da|k)?sh\s+-c|\beval)\s+["']?\$\(\s*(?:curl|wget)\b/,
  },
  {
    id: "remote-proc-subst",
    reason: "sh <(curl ...)：进程替换直接执行远程脚本",
    re: /\b(?:ba|z|fi|da|k)?sh\s+<\(\s*(?:curl|wget)\b/,
  },
];

// ---------- 不透明执行段 ----------

const SHELL_HEAD_RE = /^(?:ba|z|fi|da|k)?sh$/;
const SCRIPT_FLAG_HEAD_RE = /^(?:python(?:\d+(?:\.\d+)*)?|node|bun|deno|ruby|perl)$/;

/**
 * "不透明执行"：命令本体藏在参数/引号里，去引号匹配会漏掉，必须按原文匹配。
 * eval、sh -c、osascript -e、python -c、node -e、bun -e 等。
 */
function isOpaqueExec(head: string, rest: string): boolean {
  if (head === "eval") return true;
  if (SHELL_HEAD_RE.test(head)) return /(?:^|\s)-[a-zA-Z]*c(?=\s|$)/.test(rest);
  if (head === "osascript") return /(?:^|\s)-e(?=\s|$)/.test(rest);
  if (SCRIPT_FLAG_HEAD_RE.test(head)) return /(?:^|\s)-[a-zA-Z]*[ce](?=\s|$)/.test(rest);
  return false;
}

// 不透明段原文上用的经典子串黑名单（粗粒度即可，段内已是"要执行的代码"）
const OPAQUE_BLOCK_RES: RegExp[] = [
  /\bpip\d*(?:\.\d+)*\s+install\b/i,
  /\bpython\d*(?:\.\d+)*\s+-m\s+(?:pip\s+install|ensurepip)\b/i,
  /\bbrew\s+(?:install|reinstall|upgrade)\b/i,
  /\bnpm\s+(?:i|install|add)\b[^&|;]*\s(?:-g|--global)\b/i,
  /\b(?:pnpm|bun)\s+(?:i|install|add)\b[^&|;]*\s(?:-g|--global)\b/i,
  /\byarn\s+global\b/i,
  /\b(?:cargo|go|gem|pipx|mas|port)\s+install\b/i,
  /\binstaller\s+-pkg\b/i,
  /\bsudo\b/i,
];

// ---------- 主分析函数 ----------

export function analyzeCommand(command: string): Verdict {
  const raw = command ?? "";

  // 1) 远程脚本安装：整串判定（管道/命令替换跨分段）
  for (const g of GLOBAL_RULES) {
    if (g.re.test(raw)) {
      return { blocked: true, rule: g.id, reason: g.reason };
    }
  }

  // 2) 逐段分析
  for (const segment of splitSegments(raw)) {
    let seg = segment.trim();
    if (!seg) continue;

    // 剥离包装前缀：FOO=bar、env、command、nice、arch -arm64、exec 等
    let prev = "";
    while (prev !== seg) {
      prev = seg;
      seg = seg.replace(WRAPPER_RE, "").trimStart();
    }
    if (!seg) continue;

    const opaque = (() => {
      const m = seg.match(/^(\S+)([\s\S]*)$/);
      if (!m) return false;
      return isOpaqueExec(basename(m[1]), m[2] ?? "");
    })();

    if (opaque) {
      // 不透明执行：在保留引号的原文上匹配，防"藏进引号"
      const hit = OPAQUE_BLOCK_RES.find((re) => re.test(seg));
      if (hit) {
        return {
          blocked: true,
          rule: "opaque-exec",
          reason: `eval/sh -c/-e 等不透明执行内藏系统安装命令（命中: ${hit.source}）`,
          segment: seg,
        };
      }
      continue;
    }

    // 普通命令：剥掉引号内容再匹配，防误伤 git commit -m "..." / echo "..."
    const stripped = seg.replace(QUOTED_SPAN_RE, '""');
    const m = stripped.match(/^(\S+)([\s\S]*)$/);
    if (!m) continue;
    const head = basename(m[1]);
    const rest = m[2] ?? "";

    for (const rule of RULES) {
      if (rule.head.test(head) && rule.test(rest)) {
        return { blocked: true, rule: rule.id, reason: rule.reason, segment: seg };
      }
    }
  }

  return { blocked: false };
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

// ---------- extension 入口 ----------

export default function guardSystemInstall(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = event.input.command as string;
    if (!command || !command.trim()) return undefined;

    const verdict = analyzeCommand(command);
    if (!verdict.blocked) return undefined;

    const detail =
      `命中规则 ${verdict.rule}：${verdict.reason}` +
      (verdict.segment ? `\n命令片段: ${verdict.segment}` : "");

    if (!ctx.hasUI) {
      // 非交互模式 fail-closed：无人工确认入口时一律拒绝
      return { block: true, reason: `系统安装命令被守卫拦截（无 UI，fail-closed）。${detail}` };
    }

    const choice = await ctx.ui.select(
      `⛔ 拦截系统级安装命令\n\n${detail}\n\n项目约束：只允许 uv / bun 等项目级隔离安装。`,
      ["拒绝（推荐）", "放行一次"],
    );
    if (choice === "放行一次") return undefined;

    return { block: true, reason: `系统安装命令被守卫拦截。${detail}` };
  });
}
