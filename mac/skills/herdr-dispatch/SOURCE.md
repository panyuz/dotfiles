# 来源与维护

- 上游：https://github.com/arronKler/herdr-skills （MIT）· 仓库含 2 个 skill：`herdr-dispatch`、`herdr-swarm`（本机两个都已装）
- 取用 commit：`4b730ea`（2026-09-12）· herdr-dispatch 版本 1.8 · 取用日期 2026-10-12
- 只作**拷贝安装**（不用 `npx skills add`；按全局规则 copy 到真源再 symlink 部署）。

## 本机改动（与上游的差异；升级时重做）

1. **`bin/herd-dispatch` = uv 入口**（上游无此文件）：`uv run --no-project --python 3.12 python scripts/herd-dispatch`。已解符号链，可用部署位调用。
2. **shebang 改 uv 形式**：`scripts/herd-dispatch` 与 `scripts/test_*.py` 首行 = `#!/usr/bin/env -S uv run --no-project --python 3.12 python`。直接执行也走 uv，不会命中系统 `python3`。
3. **`SKILL.md` 头部**加 3 行本机说明（入口 / 三条规则 / 落点）；**正文示例入口**由 `python3 …` 改为 `bin/herd-dispatch`。
4. **上游测试保留**：`scripts/test_herd_dispatch.py`、`scripts/test_dispatch_runtime.py`（纯标准库 unittest，68 个测试）。升级时不要删。
5. **不引入 `references/local/`**：本机笔记不入库。
6. **运行期产物不入库**：`.gitignore` 已排除 `__pycache__/`、`*.pyc`。

## 依赖与落点

- 纯标准库（`fcntl` 为 macOS 自带）：零第三方依赖，不需要在 dotfiles 或项目内装库。
- 解释器：uv 托管 CPython 3.12（`~/.local/share/uv/python/`），与项目 `.venv` 共用同一份。
- 运行期状态：写**项目内** `.herd-dispatch/`（+ `--worktree` 的 `.worktrees/`），不写 `$HOME`。

## 升级方式

```bash
git clone --depth 1 https://github.com/arronKler/herdr-skills /tmp/herdr-skills-src
# 覆盖 mac/skills/herdr-dispatch 与 mac/skills/herdr-swarm，然后重做上面第 1–3 条
~/Documents/github/dotfiles/install.sh
uv run --no-project --python 3.12 python -m unittest discover -s mac/skills/herdr-dispatch/scripts -t mac/skills/herdr-dispatch/scripts -p 'test_*.py'
```
