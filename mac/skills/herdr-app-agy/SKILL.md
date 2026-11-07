---
name: herdr-app-agy
description: >-
  Drive the Herdr desktop application (`herdr-app`) and its persistent terminal daemon (`hc` / herdr-core).
  Use when managing Herdr windows, spaces, tabs, panes, splits, layout, UI mods, window screenshots
  (`herdr-app shot`), or when spawning, messaging, waiting on, and supervising interactive coding agents
  (pi, claude, codex, antigravity) in persistent terminals via `hc`.
---

# Herdr & Herdr-Core (hc) Operation Guide

Herdr consists of two distinct components:
1. **`herdr-app`**: The GUI presentation layer (GPUI macOS window). Controls what the user sees (spaces, tabs, panes, layout, UI mods, window screenshots).
2. **`hc` (`herdr-core`)**: The headless process & terminal daemon. Runs persistent terminals and interactive coding agents independently of whether the GUI window is open.

Your terminal identifier in Herdr is `$HC_TERMINAL_ID` (e.g. `t1g`, not a pane ID).

---

## 1. Quick Tool Routing

| Objective | Tool | Key Command |
|---|---|---|
| Open visible Tab/Split for user inspection | `herdr-app` | `herdr-app do tab.new --name "🔍 中文名" ...` / `pane.split ...` |
| Rename visible Tab for long-running task | `herdr-app` | `herdr-app do tab.rename --name "🔍 任务中文名"` |
| Inspect window layout, spaces, tabs, pane IDs | `herdr-app` | `herdr-app ls` / `herdr-app status` |
| Take full-resolution window screenshot (verify UI) | `herdr-app` | `herdr-app shot [file.png]` |
| Test or validate a mod | `herdr-app` | `herdr-app check ~/.config/herdr-app/mods/<name>` |
| Run silent background agent (no GUI Tab created) | `hc` | `hc run --bg --name <name> --cwd <dir> agy --dangerously-skip-permissions -i "<task>"` |
| Inspect running terminals and agent status | `hc` | `hc ls` / `hc get <t>` |
| Wait reactively for an agent or command to finish turn | `hc` | `hc wait <t>` / `hc wait --children all` |
| Read terminal screen and scrollback history | `hc` | `hc read --lines 100 <t>` |
| Send input / follow-up message to a terminal | `hc` | `hc send <t> "<text>"` / `hc send --wait <t> "<text>"` |
| Press keys (trust prompt, interactive menu) | `hc` | `hc keys <t> down enter` |
| Clean up finished terminal | `hc` | `hc kill <t> && hc rm <t>` |

---

## 2. Window & Layout Management (`herdr-app`)

### Inspect Before Acting
```sh
herdr-app ls          # List spaces > tabs > terminals + pane IDs
herdr-app status      # Current layout, focus, overlays, and errors
herdr-app commands    # Full list of available app commands and arguments
```

### Create Spaces, Tabs, and Splits
- **New Tab with Agent**:
  ```sh
  herdr-app do tab.new \
    --name "🔍 综述初筛" \
    --space "<space_id>" \
    --folder "/path/to/repo" \
    --argv '["pi", "--provider", "deepseek", "--model", "deepseek-flash"]' \
    --task "Task description. Report findings directly in conversation."
  ```
- **New Space**:
  ```sh
  herdr-app do space.new --name "project" --folder "/path/to/project"
  ```
- **Split Pane**:
  ```sh
  herdr-app do pane.split --direction right --pane "<pane_id>"
  ```
- **Focus Terminal**:
  ```sh
  herdr-app do agent.focus --terminal "<terminal_id>"
  ```

### Tab & Session Naming (Long-Running Tasks)
When launching or executing long-running tasks (e.g., deep research, data modeling, multi-round review, batch coding):
- **Mandatory Chinese Naming**: Explicitly name the Herdr Tab / session in Chinese.
- **Emoji Support**: Prefix Tab names with an Emoji to visually represent the task category (e.g. `🔍 综述初稿`, `📊 统计建模`, `✍️ 论文引言`, `🧪 回归测试`).
- **Rename Current / Active Tab**:
  ```sh
  herdr-app do tab.rename --name "🔍 检索分析"
  # Or target specific tab:
  herdr-app do tab.rename --id "<tab_id>" --name "📊 统计建模"
  ```

### Visual Verification with Screenshots
Always capture a screenshot to visually verify layout or mod adjustments:
```sh
herdr-app shot /tmp/herdr-view.png
```
This renders the app's last frame at native resolution without desktop permissions.

---

## 3. Terminal & Agent Orchestration (`hc`)

### Starting Interactive Agents
Always run worker agents in `--bg` and in interactive mode (never `-p` or one-shot print mode), so they remain steerable for subsequent turns.

#### 1. Running agy as a Silent Background Worker (Standard Pattern)
When Antigravity (agy) delegates an autonomous background task to another agy instance:
```sh
# Launch in background with auto-permissions and interactive mode:
hc run --bg --name agy-worker --cwd /path/to/repo agy --dangerously-skip-permissions -i "Task prompt. Report findings with hc send $HC_TERMINAL_ID when done."

# Reactively wait for turn completion:
hc wait agy-worker

# Read results from screen / history:
hc read --lines 100 agy-worker

# Send multi-turn follow-up instruction:
hc send agy-worker "Proceed with the next step."

# Clean up terminal once task is completed:
hc kill agy-worker && hc rm agy-worker
```

**Key Parameters for agy Workers:**
- `--dangerously-skip-permissions`: **Crucial**. Auto-approves tool execution requests, preventing background workers from hanging on interactive permission prompts.
- `-i` (`--prompt-interactive`): Launches with initial task while keeping the session open for steerability and subsequent turns.
- `--bg`: Runs headless in `herdr-core` without opening or cluttering user-facing GUI tabs.

**Understanding Transient `blocked (auth)` Handshake Notices:**
- `agy` natively implements OSC 7501 terminal status reporting (`]7501;`).
- During the first ~0.5s of cold startup (while validating Google account credentials), `agy` briefly emits a `blocked (auth)` status before instantly transitioning to `working` and `done`.
- `herdr-core` queues an asynchronous notification to the parent terminal: `<hc><id> ... is blocked (auth)...</hc>`.
- **Handling**: This is a harmless cold-start handshake echo. **Do not terminate or interrupt the process**. Verify status via `hc get <t>` (it will show `working` or `done`), and proceed with standard `hc wait <t>`.

#### 2. Running Other Agents (pi, claude)
```sh
# Using pi
hc run --bg --name helper --cwd /path/to/repo pi --provider deepseek --model deepseek-flash
hc wait helper
hc send helper "Inspect src/x.py only. Report findings with hc send $HC_TERMINAL_ID when done."

# Using claude with direct task
hc run --bg --name review --cwd /path/to/repo claude "Review changes. Report with hc send $HC_TERMINAL_ID."
```

### Reactive Waiting (Never Poll or Sleep)
- Wait for a specific terminal to finish working:
  ```sh
  hc wait <terminal_id>
  ```
- Wait for all children to complete:
  ```sh
  hc wait --children all
  ```
- Wait until a specific string is output (e.g. server readiness):
  ```sh
  hc wait web --output "ready"
  ```

### Reading Screen & Sending Messages
- Read output:
  ```sh
  hc read --lines 100 <terminal_id>
  ```
- Send message:
  ```sh
  hc send <terminal_id> "Focus on fixing the first error."
  ```
- Handle approval dialogs or keys:
  ```sh
  hc keys <terminal_id> down enter
  ```

### Cleanup
Only terminate and remove terminals you spawned:
```sh
hc kill <terminal_id>
hc rm <terminal_id>
```

---

## 4. Hard Rules & Guardrails

1. **Never run bare `herdr` or bare `herdr-app`**: Running without subcommands attaches TUI or raises the desktop window unexpectedly.
2. **Never sleep or poll**: Use `hc wait` for reactive event-driven synchronization.
3. **Never run agents in `-p` print mode**: Coding agents in Herdr must run interactively so they remain available for multi-turn inspection and steering.
4. **Distinguish pane ID from terminal ID**:
   - `herdr-app` commands like `pane.split` operate on pane IDs (`p...`).
   - `hc` commands operate on terminal IDs (`t...`, e.g., `$HC_TERMINAL_ID`).
5. **UI & Mod Changes**:
   - Always run `herdr-app check <mod_dir>` before considering mod work complete.
   - Emergency reset shortcut: `ctrl-alt-shift-escape` restores default layout and keybindings.
6. **Mandatory Chinese Naming for Long-Running Tasks**:
   - When executing long-running tasks, you MUST name the Herdr Tab and session in **Chinese**.
   - Tab names can and should include an **Emoji** prefix (e.g. `🔍 综述初稿`, `📊 统计建模`, `✍️ 论文引言`).
   - Use `--name "..."` during `tab.new` / `hc run`, or run `herdr-app do tab.rename --name "..."` on the active tab before running long operations.
7. **Background agy Delegation & Autonomy**:
   - For autonomous background sub-tasks, prioritize silent background workers via `hc run --bg` instead of `tab.new` to prevent GUI clutter.
   - Background `agy` workers MUST be started with `--dangerously-skip-permissions -i` to ensure unattended execution.
   - Treat transient `<hc>... is blocked (auth)...</hc>` notices as benign cold-start handshake echoes; verify state with `hc get <t>` before taking any corrective action.
   - Always cleanly dispose of child terminals via `hc kill <t> && hc rm <t>` once results are retrieved.
