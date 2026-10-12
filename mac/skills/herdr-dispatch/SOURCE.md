# 来源与维护

- 上游：https://github.com/arronKler/herdr-skills （MIT）
- 取用 commit：`4b730ea`（2026-09-12）· skill 版本 1.8 · 取用日期 2026-10-12
- 只作**拷贝安装**（不用 `npx skills add`；按全局规则 copy 到真源再 symlink 部署）。
- 本机改动（与上游的差异，升级时需重做）：
  1. `bin/herd-dispatch` = **uv shim**（上游无此文件）：`uv run --no-project --python 3.12 python scripts/herd-dispatch`，满足「不用系统 python3」且不落项目依赖；已处理符号链解析（用部署位 `~/.pi/agent/skills/herdr-dispatch/bin/herd-dispatch` 调，不往 `~/.local/bin` 装）。
  2. 未拷贝 `scripts/test_*.py`（49KB 上游沙盒测试，与运行无关）。
  3. 依赖零安装：纯标准库（`fcntl` 为 macOS 自带）；运行期状态落**项目内** `.herd-dispatch/`（+ `--worktree` 的 `.worktrees/`），不写 `$HOME`。
- 升级方式：`git clone --depth 1 https://github.com/arronKler/herdr-skills /tmp/herdr-skills-src` → 重做上面 1-3 步。
