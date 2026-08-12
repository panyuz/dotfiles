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
link "$DOTFILES/mac/omp/skills/herdr"        "$HOME/.omp/skills/herdr"

# herdr plugins.json：快照恢复（不 symlink——herdr 插件管理器会回写此文件，避免仓库噪声 diff）
# 仅当本机不存在时恢复，并把写死的路径改写为本机 $HOME
# 先清悬空 symlink（-e 对悬空链接为 false，直接重定向会跟随链接写错位置）
if [ -L "$HOME/.config/herdr/plugins.json" ] && [ ! -e "$HOME/.config/herdr/plugins.json" ]; then
  rm "$HOME/.config/herdr/plugins.json"
fi
if [ ! -e "$HOME/.config/herdr/plugins.json" ]; then
  mkdir -p "$HOME/.config/herdr"
  sed "s|/Users/panyu|$HOME|g" "$DOTFILES/mac/herdr/plugins.json" \
    > "$HOME/.config/herdr/plugins.json"
  echo "📋 plugins.json 已从快照恢复（插件本体需 herdr 重装，恢复仅作种子）"
fi

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
