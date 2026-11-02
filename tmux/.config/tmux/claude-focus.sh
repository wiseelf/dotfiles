#!/usr/bin/env bash
# Click action of claude-notify.sh. Shows a tmux pane in the tmux client that was used last,
# then focuses the Ghostty window and tab of that client.
# Usage: claude-focus.sh <tmux-socket> <pane-id>. It runs outside tmux, so it gets the socket as an argument.
set -euo pipefail

readonly TMUX_BIN="/opt/homebrew/bin/tmux"
socket=$1
pane=$2

tmux() { "$TMUX_BIN" -S "$socket" "$@"; }

client_tty=$(tmux list-clients -F '#{client_activity} #{client_tty}' | sort -rn | head -1 | cut -d' ' -f2)
[[ -n $client_tty ]] || exit 0

session=$(tmux display-message -p -t "$pane" '#{session_id}')
tmux switch-client -c "$client_tty" -t "$session" \; select-window -t "$pane" \; select-pane -t "$pane"

# The Ghostty terminal of the client has the same tty. "focus" selects its window and tab.
osascript - "$client_tty" <<'APPLESCRIPT'
on run argv
  tell application "Ghostty"
    focus (first terminal whose tty is (item 1 of argv))
    activate
  end tell
end run
APPLESCRIPT
