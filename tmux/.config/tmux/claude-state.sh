#!/usr/bin/env bash
# Claude Code hook. Puts the Claude state on the tmux session for the status bar and the picker.
# Usage: claude-state.sh <working|waiting|done>. With no argument, the script removes the state.
[[ -n ${TMUX_PANE:-} ]] || exit 0

if [[ -n ${1:-} ]]; then
  tmux set-option -t "$TMUX_PANE" @claude_state "$1"
else
  tmux set-option -u -t "$TMUX_PANE" @claude_state
fi
