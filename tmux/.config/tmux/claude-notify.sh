#!/usr/bin/env bash
# Sends a macOS notification for a Claude Code session in tmux. A click shows the pane of that session.
# Usage: claude-notify.sh waiting [message]. With no argument, the script removes the notification.
# claude-state.sh calls this script. It exits when Claude does not run in tmux.
set -uo pipefail

readonly TERMINAL_BUNDLE_ID="com.mitchellh.ghostty"
readonly NOTIFIER="/opt/homebrew/bin/terminal-notifier"
# The notification stays this long. It needs the "Alerts" style for terminal-notifier in System Settings.
readonly DISPLAY_SECONDS=10

[[ -n ${TMUX_PANE:-} && -n ${TMUX:-} && -x $NOTIFIER ]] || exit 0

state=${1:-}
message=${2:-}
session=$(tmux display-message -p -t "$TMUX_PANE" '#{session_name}') || exit 0
group="claude-tmux-$session"

if [[ -z $state ]]; then
  "$NOTIFIER" -remove "$group" >/dev/null
  exit 0
fi

# Skip when the pane is on the screen: Ghostty is in front, its selected tab holds a tmux client
# of this session, and the pane is active in its window.
is_terminal_in_front() {
  lsappinfo info -only bundleid "$(lsappinfo front)" | grep -q "\"$TERMINAL_BUNDLE_ID\""
}
front_terminal_tty() {
  osascript -e 'tell application "Ghostty" to get tty of focused terminal of selected tab of front window' 2>/dev/null
}
is_pane_visible() {
  [[ $(tmux display-message -p -t "$TMUX_PANE" '#{&&:#{window_active},#{pane_active}}') == 1 ]] || return 1
  tmux list-clients -t "$TMUX_PANE" -F '#{client_tty}' | grep -qxF "$(front_terminal_tty)"
}
if is_terminal_in_front && is_pane_visible; then
  exit 0
fi

[[ $state == waiting ]] || exit 0
body=${message:-Claude needs your input}

# The click runs outside tmux, so claude-focus.sh gets the server socket.
socket=${TMUX%%,*}
printf -v on_click '%q %q %q' "$HOME/.config/tmux/claude-focus.sh" "$socket" "$TMUX_PANE"

# The ID prevents an old timer from removing a newer notification of the same session.
notification_id="$$-$RANDOM"
tmux set-option -t "$TMUX_PANE" @claude_notification_id "$notification_id"

"$NOTIFIER" -title "Claude · $session" -message "$body" -group "$group" -sound default \
  -execute "$on_click" >/dev/null

sleep "$DISPLAY_SECONDS"
if [[ $(tmux display-message -p -t "$TMUX_PANE" '#{@claude_notification_id}') == "$notification_id" ]]; then
  "$NOTIFIER" -remove "$group" >/dev/null
fi
