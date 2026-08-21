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
link "$DOTFILES/mac/omp/agent/APPEND_SYSTEM.md" "$HOME/.omp/agent/APPEND_SYSTEM.md"
# omp config.yml 真身在 ~/.omp/agent/config.yml（本机自维护，不入库，2026-08-21 起）

# omp 全局 skill：目录级 symlink 自动循环（新增 skill 零配置，下次跑 install.sh 自动纳入）
# 用户级扫描目录 = ~/.omp/agent/skills/（非 ~/.omp/skills/，2026-08-12 源码核实）
for skill_dir in "$DOTFILES"/mac/omp/skills/*/; do
  [ -d "$skill_dir" ] || continue
  link "${skill_dir%/}" "$HOME/.omp/agent/skills/$(basename "$skill_dir")"
done

# herdr plugins.json：不纳管（插件管理器回写的状态文件，本机自维护）

# omp models.yml：含密钥，真身本机自维护，永不入库（模板已移除 2026-08-21）
if [ -L "$HOME/.omp/agent/models.yml" ] && [ ! -e "$HOME/.omp/agent/models.yml" ]; then
  rm "$HOME/.omp/agent/models.yml"
fi

echo "🎉 dotfiles 部署完成"
