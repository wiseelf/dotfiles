#!/usr/bin/env bash
# Start `claude` with a first prompt in a new session in <target-dir>. The focus stays on the current window.
# The terminal is the same type as the current session. Set FORK_TASK_TERMINAL to override it:
#   iterm    - a new iTerm window, then the original window is selected again.
#   terminal - a new Terminal.app window, then the original window is put in front again.
#   tmux     - a new window in the current tmux session, or a detached session outside tmux.
#   bg       - a background session with no window (`claude --bg`). See it with `claude agents`.
# Usage: open-session.sh <target-dir> <prompt>
set -euo pipefail

readonly MODES="iterm terminal tmux bg"

usage() {
  echo "Usage: $0 <target-dir> <prompt>" >&2
  exit 2
}

# Quote a value for a POSIX shell: wrap it in single quotes and escape the inner single quotes.
shell_quote() {
  local escaped=${1//\'/\'\\\'\'}
  printf "'%s'" "$escaped"
}

detect_mode() {
  if [[ -n ${FORK_TASK_TERMINAL:-} ]]; then
    echo "$FORK_TASK_TERMINAL"
  elif [[ -n ${TMUX:-} ]]; then
    echo tmux
  elif [[ ${TERM_PROGRAM:-} == iTerm.app ]]; then
    echo iterm
  elif [[ ${TERM_PROGRAM:-} == Apple_Terminal ]]; then
    echo terminal
  elif command -v tmux >/dev/null; then
    echo tmux
  else
    echo bg
  fi
}

open_iterm() {
  local command_line=$1
  osascript - "$command_line" <<'APPLESCRIPT'
on run argv
  set commandLine to item 1 of argv
  tell application "iTerm"
    set originalWindow to current window
    set newWindow to (create window with default profile)
    if originalWindow is not missing value then select originalWindow
    tell current session of newWindow to write text commandLine
  end tell
end run
APPLESCRIPT
  echo "Started claude in a new iTerm window."
}

open_terminal_app() {
  local command_line=$1
  osascript - "$command_line" <<'APPLESCRIPT'
on run argv
  set commandLine to item 1 of argv
  tell application "Terminal"
    set originalWindow to missing value
    if (count of windows) > 0 then set originalWindow to front window
    do script commandLine
    if originalWindow is not missing value then set index of originalWindow to 1
  end tell
end run
APPLESCRIPT
  echo "Started claude in a new Terminal window."
}

open_tmux() {
  local target_dir=$1 claude_command=$2 name=$3
  if [[ -n ${TMUX:-} ]]; then
    tmux new-window -d -n "$name" -c "$target_dir" "$claude_command"
    echo "Started claude in tmux window '$name' of the current session."
    return
  fi
  local session_name=$name
  if tmux has-session -t "=$session_name" 2>/dev/null; then
    session_name="$session_name-$(date +%s)"
  fi
  tmux new-session -d -s "$session_name" -c "$target_dir" "$claude_command"
  echo "Started tmux session '$session_name'. Attach with: tmux attach -t $session_name"
}

open_background() {
  local target_dir=$1 prompt=$2 name=$3
  (cd "$target_dir" && claude --bg --name "$name" -- "$prompt")
  echo "Started background session '$name'. See it with: claude agents"
}

main() {
  [[ $# -eq 2 ]] || usage
  local target_dir=$1 prompt=$2

  if [[ ! -d $target_dir ]]; then
    echo "Error: directory not found: $target_dir" >&2
    exit 1
  fi
  # The new shell starts in the home directory, so a relative path must become absolute.
  target_dir=$(cd "$target_dir" && pwd)

  local mode
  mode=$(detect_mode)
  if [[ " $MODES " != *" $mode "* ]]; then
    echo "Error: FORK_TASK_TERMINAL='$mode' is not valid. Use one of: $MODES." >&2
    exit 1
  fi

  local dir_name name claude_command
  dir_name=$(basename "$target_dir")
  # tmux does not accept '.' or ':' in a session or window name.
  name="fork-${dir_name//[^A-Za-z0-9_-]/-}"
  claude_command="claude $(shell_quote "$prompt")"

  case $mode in
    iterm) open_iterm "cd $(shell_quote "$target_dir") && $claude_command" ;;
    terminal) open_terminal_app "cd $(shell_quote "$target_dir") && $claude_command" ;;
    tmux) open_tmux "$target_dir" "$claude_command" "$name" ;;
    bg) open_background "$target_dir" "$prompt" "$name" ;;
  esac
}

main "$@"
