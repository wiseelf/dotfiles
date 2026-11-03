#!/usr/bin/env bash
# Claude Code hook. Puts the Claude state on the tmux session for the status bar and the picker.
# It also sends a macOS notification for "waiting" (see claude-notify.sh).
# Usage: claude-state.sh <working|waiting|done>. With no argument, the script removes the state.
[[ -n ${TMUX_PANE:-} ]] || exit 0

state=${1:-}
previous=$(tmux display-message -p -t "$TMUX_PANE" '#{@claude_state}')
if [[ -n $state ]]; then
  tmux set-option -t "$TMUX_PANE" @claude_state "$state"
else
  tmux set-option -u -t "$TMUX_PANE" @claude_state
fi

case $state in
  waiting)
    # The Notification hook sends JSON with a "message" field on stdin. Other callers can send nothing.
    message=""
    if [[ ! -t 0 ]]; then
      read -r -t 1 -d '' input || true
      message=$(jq -r '.message // empty' <<<"${input:-}" 2>/dev/null)
    fi
    notify_args=("$state" "$message")
    ;;
  *)
    # Claude continues, finished, or the session ended. Remove an open notification, if there is one.
    [[ $previous == waiting ]] || exit 0
    notify_args=()
    ;;
esac

# In the background, so the hook does not wait for the notification.
"$HOME/.config/tmux/claude-notify.sh" "${notify_args[@]}" </dev/null >/dev/null 2>&1 &
disown
