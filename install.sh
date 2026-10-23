#!/usr/bin/env bash
# dotfiles 部署：幂等 symlink + 备份冲突文件。换机/重装后运行一次即可。
set -euo pipefail
DOTFILES="$(cd "$(dirname "$0")" && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"

link() { # link <repo内真源> <目标路径>
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    mv "$dst" "$dst.bak.$TS"
    echo "📦 已备份 $dst -> $dst.bak.$TS"
  fi
  ln -sfn "$src" "$dst"
  echo "✅ $dst -> $src"
}

# ghostty / herdr / omp agent 配置（文件级 symlink）
link "$DOTFILES/mac/ghostty/config"          "$HOME/.config/ghostty/config"
link "$DOTFILES/mac/herdr/config.toml"       "$HOME/.config/herdr/config.toml"

# zsh + starship（2026-10-16 纳入，shell 侧配置也进仓库，换机可恢复）：
#   ~/.zshrc = 交互式 shell 全部配置（别名、eza 颜色 EZA_COLORS、starship init、herdr 标题钩子）
#   ~/.config/starship.toml = starship 官方 gruvbox-rainbow 预设
link "$DOTFILES/mac/zsh/zshrc"               "$HOME/.zshrc"
link "$DOTFILES/mac/starship/starship.toml"  "$HOME/.config/starship.toml"

# pi 用户级 extension（2026-10-11 起）：只 link 本仓库里的扩展，不做整目录循环。
# ⚠️ ~/.pi/agent/extensions/herdr-agent-state.ts 是 herdr 官方集成的副本
#    （herdr 自己安装并管理，重装/升级会覆盖）—— 不纳管，也不要被本循环覆盖。
# herdr-watch 保留为 *.retired 历史文件，不参与部署。
# Pi 子任务由 pi-subagents 管理，Herdr 命令用 herdr --skill 现取。
for ext_file in "$DOTFILES"/mac/pi/agent/extensions/*.ts; do
  [ -e "$ext_file" ] || continue
  link "$ext_file" "$HOME/.pi/agent/extensions/$(basename "$ext_file")"
done

# ⚠️ omp 已弃用（2026-09-18 确认）：以下两条 ~/.omp 链接保留仅为历史兼容，不再新增/维护
link "$DOTFILES/mac/omp/agent/APPEND_SYSTEM.md" "$HOME/.omp/agent/APPEND_SYSTEM.md"
# omp 用户级 extension：循环 link（guard-system-install 等全局拦截扩展）
for ext_file in "$DOTFILES"/mac/omp/agent/extensions/*.ts; do
  [ -e "$ext_file" ] || continue
  link "$ext_file" "$HOME/.omp/agent/extensions/$(basename "$ext_file")"
done
# omp config.yml 真身在 ~/.omp/agent/config.yml（本机自维护，不入库，2026-08-21 起）

# 全局 skill（mac/skills/ 共享真源）：目录级 symlink 自动循环，新增 skill 零配置
# 目标 1：pi 用户级 ~/.pi/agent/skills/（settings.json 未声明 skills，纯自动扫描）
# 目标 2：agy 用户级 ~/.gemini/antigravity-cli/skills/（Antigravity CLI 官方全局位，symlink 被跟随；
#         agy 2.0/IDE 的位不同 = ~/.gemini/config/skills/，只认绝对路径，需要时另加）
# omp 的 ~/.omp/agent/skills/ 已不再纳管（2026-09-18；omp 弃用）
for skill_dir in "$DOTFILES"/mac/skills/*/; do
  [ -d "$skill_dir" ] || continue
  name="$(basename "$skill_dir")"
  # 2026-10-23：只停用部署，保留旧 skill 源码和未提交改动。
  case "$name" in
    herdr-dispatch|herdr-swarm) continue ;;
  esac
  link "${skill_dir%/}" "$HOME/.pi/agent/skills/$name"
  if [ -d "$HOME/.gemini/antigravity-cli" ]; then
    link "${skill_dir%/}" "$HOME/.gemini/antigravity-cli/skills/$name"
  fi
done

# herdr plugins.json：不纳管（插件管理器回写的状态文件，本机自维护）

# omp models.yml：含密钥，真身本机自维护，永不入库（模板已移除 2026-08-21）
if [ -L "$HOME/.omp/agent/models.yml" ] && [ ! -e "$HOME/.omp/agent/models.yml" ]; then
  rm "$HOME/.omp/agent/models.yml"
fi

echo "🎉 dotfiles 部署完成"
