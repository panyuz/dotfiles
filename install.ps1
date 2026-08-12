# dotfiles Windows 部署骨架（win/ 配置启用后补全）
# 用法：powershell -ExecutionPolicy Bypass -File install.ps1
# 注意：symlink 需开发者模式或管理员权限；无权限时自动降级 Copy-Item（接受漂移，改配置后需手动回拷）

$ErrorActionPreference = "Stop"
$DOTFILES = Split-Path -Parent $MyInvocation.MyCommand.Path

function Link-Config {
    param([string]$Src, [string]$Dst)
    $dstDir = Split-Path -Parent $Dst
    New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
    if (Test-Path $Dst) {
        $item = Get-Item $Dst
        if ($item.LinkType -eq "SymbolicLink") {
            Remove-Item $Dst -Force
        } else {
            Move-Item $Dst "$Dst.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Write-Host "📦 已备份 $Dst"
        }
    }
    try {
        New-Item -ItemType SymbolicLink -Path $Dst -Value $Src -ErrorAction Stop | Out-Null
        Write-Host "✅ $Dst -> $Src"
    } catch {
        Copy-Item $Src $Dst -Force
        Write-Host "⚠️  symlink 失败（需开发者模式/管理员），已降级复制：$Dst"
    }
}

# ── Windows 侧配置（首次启用时补全）──
# Link-Config "$DOTFILES\win\example" "$HOME\...\example"

Write-Host "🎉 dotfiles(win) 部署完成"
