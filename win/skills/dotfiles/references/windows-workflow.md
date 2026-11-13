# Windows 全局技能软链接与验证

本文件对应用户在 2026-11-10 指定的两个目录符号链接。真源在 `dotfiles/win/skills/`。创建授权只覆盖下表，不扩展到其他全局配置。

| Pi 全局链接 | 仓库真源 |
|---|---|
| `C:/Users/smart/.pi/agent/skills/dotfiles` | `C:/Users/smart/Documents/github/dotfiles/win/skills/dotfiles` |
| `C:/Users/smart/.pi/agent/skills/herdr-loop` | `C:/Users/smart/Documents/github/dotfiles/win/skills/herdr-loop` |

## 1. 创建前检查

- 确认两个真源的 `SKILL.md` 存在。
- 检查全局目标与 `~/.agents/skills/` 下的同名技能，避免重复发现。
- 正确的 `SymbolicLink` 已存在时只验证，不重复创建。
- 普通目录、junction 或其他目标的链接属于冲突；先识别与备份，再处理。
- 用户已经授权本次两个链接，无需重复确认目标。实际管理员权限由 Windows UAC 确认。

PowerShell 只读检查：

```powershell
$skillNames = @('dotfiles', 'herdr-loop')
foreach ($skillName in $skillNames) {
    $skillPath = Join-Path 'C:\Users\smart\.pi\agent\skills' $skillName
    Get-Item -LiteralPath $skillPath -Force -ErrorAction SilentlyContinue |
        Select-Object FullName, LinkType, Target
}
```

## 2. 创建方式与权限

使用 PowerShell `New-Item -ItemType SymbolicLink -Path <全局路径> -Target <真源路径>`。目标目录先不存在；只创建全局父目录，不预建同名技能目录。

Windows 若返回 `Administrator privilege required for this operation`，先准备仅创建这两个链接的脚本，再通过正常 `Start-Process -Verb RunAs` 请求管理员执行。系统会显示 UAC。拒绝或失败时保留准确错误并停止，不修改系统策略。

不能静默改成 junction、复制安装，也不为了创建链接而修改开发者模式或持久化执行策略。

## 3. 冲突与恢复

备份目录必须在所有 Pi skill 扫描目录之外。可用执行项目的 `tmp/`。

扫描范围包括全局 `.pi/agent/skills/`、`.agents/skills/`、项目 `.pi/skills/` 与 `.agents/skills/`，以及设置或包显式提供的路径。

同级的 `<name>.bak.<时间戳>` 仍可能被扫描，不作为备份位置。操作旧链接时只处理链接本身，不递归删除仓库真源。若新建失败，按已记录的目标类型恢复旧目录或链接，不覆盖新出现的未知内容。

## 4. 验证链接与内容

```powershell
$skillNames = @('dotfiles', 'herdr-loop')
foreach ($skillName in $skillNames) {
    $skillLink = Join-Path 'C:\Users\smart\.pi\agent\skills' $skillName
    $skillSource = Join-Path 'C:\Users\smart\Documents\github\dotfiles\win\skills' $skillName
    Get-Item -LiteralPath $skillLink -Force | Select-Object FullName, LinkType, Target
    Get-FileHash -LiteralPath (Join-Path $skillLink 'SKILL.md'), (Join-Path $skillSource 'SKILL.md') -Algorithm SHA256
}
```

验收要求：`LinkType` 为 `SymbolicLink`，目标路径正确，链接内的 `SKILL.md` 可读，两条内容哈希一致。还要确认 `dotfiles/references/windows-workflow.md` 能通过链接读取。

当前会话执行 `/reload` 后，检查加载诊断和 `/skill:` 自动补全。不执行 `/skill:herdr-loop` 来做验证，以免启动真实任务。只验证了文件系统时，应明确记录“链接已创建，当前会话尚待 reload”。

## 5. 源码修改与提交

链接后的修改直接发生在仓库真源。操作前确认路径属于 `win/`。保持新文件 LF、UTF-8 无 BOM。

提交前检查：

```bash
git -C C:/Users/smart/Documents/github/dotfiles diff --check
git -C C:/Users/smart/Documents/github/dotfiles status --short
```

只暂存本次明确修改的文件，保留其他用户改动。未跟踪文件不参与 `git diff --check`，需要另查编码和链接。

Git 行尾过滤可能使现有检出文件使用 CRLF。核对源不变时使用相同的 `git hash-object` 口径，或与 `git cat-file --filters HEAD:<路径>` 的检出内容比较，不直接比较 Git 对象哈希和原始字节哈希。
