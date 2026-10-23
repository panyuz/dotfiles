#!/usr/bin/env python3
"""
PreToolUse lifecycle hook for Antigravity CLI (agy).
Enforces project-level isolation policy aligned with pi-permission-system / INVEST constraints.
Hard-blocks any attempts to install packages, libraries, or tools globally on macOS.
"""
import sys
import json
import re
import os

RULES = [
    (r"\bsudo\b", "sudo 提权可绕过一切包级规则，一律禁止（与 omp guard 对齐）"),
    (r"\brm\s+-rf\s+/\s*", "高危删除根目录操作被硬禁止"),
    (r"\bbrew\s+(install|upgrade|reinstall)\b", "Homebrew 全局安装被禁止。只能使用项目级依赖"),
    (r"\b(npm|bun)\s+(install|i|add)\s+.*(-g|--global)\b", "全局 npm 安装被禁止（INVEST 约束）。包写入项目 package.json"),
    (r"\b(npm|bun)\s+(-g|--global)\s+(install|i|add)\b", "全局 npm 安装被禁止（INVEST 约束）。包写入项目 package.json"),
    (r"\bpnpm\s+(add|install)\s+.*(-g|--global)\b", "装到用户/系统全局环境，非项目级隔离"),
    (r"\bpnpm\s+(-g|--global)\s+(add|install)\b", "装到用户/系统全局环境，非项目级隔离"),
    (r"\byarn\s+global\s+add\b", "装到用户/系统全局环境，非项目级隔离"),
    (r"\buv\s+pip\s+install\s+--system\b", "uv --system 装入系统 Python（INVEST 约束）。用 uv run / uv add 项目级隔离"),
    (r"\buv\s+tool\s+install\b", "uv tool install 装到 ~/.local（用户全局，非项目级隔离）。临时运行用 uvx / uv run --with"),
    (r"\b(pipx|gem|go|deno)\s+install\b", "装到用户/系统全局环境，非项目级隔离"),
]

def check_command(cmd: str):
    for pattern, reason in RULES:
        if re.search(pattern, cmd):
            return reason
    
    # Python pip: prohibit bare system pip install unless running in local virtualenv
    if re.search(r"\b(pip|pip3|python3?\s+-m\s+pip)\s+install\b", cmd):
        is_venv = (
            bool(os.environ.get("VIRTUAL_ENV"))
            or bool(re.search(r"(\.venv|venv|env)/bin/(pip|python|activate)", cmd, re.I))
            or bool(re.search(r"source\s+.*(venv|\.venv|env)/bin/activate", cmd, re.I))
            or bool(re.search(r"--target\b", cmd))
        )
        if not is_venv:
            return "系统级 pip 安装被禁止（INVEST 约束）。用 uv run / uv add 或本地 .venv"

    # Rust cargo: prohibit global install unless --root is explicitly passed
    if re.search(r"\bcargo\s+install\b", cmd) and not re.search(r"--root\b", cmd):
        return "装到用户/系统全局环境，非项目级隔离（需指定 --root 本地目录）"

    return None

def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        # Fallback to standard permission handling
        sys.stdout.write(json.dumps({"decision": "ask"}) + "\n")
        return

    tool_call = payload.get("toolCall") or {}
    args = tool_call.get("args") or {}
    cmd = args.get("CommandLine", "").strip()

    if not cmd:
        sys.stdout.write(json.dumps({"decision": "ask"}) + "\n")
        return

    violation_reason = check_command(cmd)
    if violation_reason:
        # Hard block immediately
        sys.stdout.write(json.dumps({
            "decision": "deny",
            "reason": f"【安全策略硬拦截】{violation_reason}"
        }) + "\n")
    else:
        # Normal command: pass through to Antigravity's permission system
        sys.stdout.write(json.dumps({"decision": "ask"}) + "\n")

if __name__ == "__main__":
    main()
