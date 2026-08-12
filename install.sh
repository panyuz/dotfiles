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
link "$DOTFILES/mac/omp/agent/config.yml"    "$HOME/.omp/agent/config.yml"
link "$DOTFILES/mac/omp/agent/APPEND_SYSTEM.md" "$HOME/.omp/agent/APPEND_SYSTEM.md"

# omp 全局 skill：目录级 symlink（新增 reference 文件自动生效，零维护）
# 用户级扫描目录 = ~/.omp/agent/skills/（非 ~/.omp/skills/，2026-08-12 源码核实）
link "$DOTFILES/mac/omp/skills/herdr"        "$HOME/.omp/agent/skills/herdr"

# herdr plugins.json：不纳管（插件管理器回写的状态文件，本机自维护）

# omp models.yml：模板制，密钥手填（真文件永不入库）
if [ -L "$HOME/.omp/agent/models.yml" ] && [ ! -e "$HOME/.omp/agent/models.yml" ]; then
  rm "$HOME/.omp/agent/models.yml"
fi
if [ ! -e "$HOME/.omp/agent/models.yml" ]; then
  mkdir -p "$HOME/.omp/agent"
  cp "$DOTFILES/mac/omp/agent/models.yml.example" "$HOME/.omp/agent/models.yml"
  echo "🔑 models.yml 已从模板生成，请编辑填入真实 apiKey: $HOME/.omp/agent/models.yml"
fi

echo "🎉 dotfiles 部署完成"
