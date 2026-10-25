#!/usr/bin/env bash
# Pick a tmux session with fzf and go to it. The preview shows the active pane of the session.
set -euo pipefail

if ! sessions=$(tmux list-sessions -O name -F '#{session_name}	#{@claude_state}	#{session_path}' 2>/dev/null); then
  echo "No tmux sessions. To start one, cd to a project folder and run cs." >&2
  exit 1
fi

session=$(fzf --reverse --delimiter='\t' --with-nth=1,2 --prompt='session> ' \
  --preview='tmux capture-pane -ep -t ={1}:' --preview-window=right,70% <<<"$sessions" | cut -f1) || exit 0

if [[ -n ${TMUX:-} ]]; then
  tmux switch-client -t "=$session"
else
  exec tmux attach-session -t "=$session"
fi
