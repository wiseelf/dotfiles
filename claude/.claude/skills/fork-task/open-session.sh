#!/usr/bin/env bash
# Start `claude` with a first prompt in the tmux session of <target-dir>. The focus stays on the current window.
# The session name is the one `cs` uses, so `cs` in <target-dir> or the session picker goes to it.
# If the session exists, claude starts in a new window of it. Otherwise a new detached session starts.
# Usage: open-session.sh <target-dir> <prompt>
set -euo pipefail

readonly SESSION_NAME_SCRIPT="$HOME/.config/tmux/session-name.sh"
readonly WINDOW_NAME="fork"

usage() {
  echo "Usage: $0 <target-dir> <prompt>" >&2
  exit 2
}

fail() {
  echo "Error: $1" >&2
  exit 1
}

# Quote a value for a POSIX shell: wrap it in single quotes and escape the inner single quotes.
shell_quote() {
  local escaped=${1//\'/\'\\\'\'}
  printf "'%s'" "$escaped"
}

main() {
  [[ $# -eq 2 ]] || usage
  local target_dir=$1 prompt=$2

  [[ -d $target_dir ]] || fail "directory not found: $target_dir"
  command -v tmux >/dev/null || fail "tmux is not installed"
  [[ -x $SESSION_NAME_SCRIPT ]] || fail "$SESSION_NAME_SCRIPT not found. Stow the tmux package."
  local claude_path
  claude_path=$(command -v claude) || fail "claude is not in PATH"

  # The tmux server can have a different working directory, so a relative path must become absolute.
  target_dir=$(cd "$target_dir" && pwd)

  local name claude_command
  name=$("$SESSION_NAME_SCRIPT" "$target_dir")
  claude_command="$(shell_quote "$claude_path") $(shell_quote "$prompt")"

  if tmux has-session -t "=$name" 2>/dev/null; then
    tmux new-window -d -t "=$name:" -n "$WINDOW_NAME" -c "$target_dir" "$claude_command"
    echo "Started claude in window '$WINDOW_NAME' of the existing tmux session '$name'."
  else
    tmux new-session -d -s "$name" -c "$target_dir" "$claude_command"
    echo "Started tmux session '$name'."
  fi
  echo "Go to it with: cd $(shell_quote "$target_dir") && cs"
}

main "$@"
