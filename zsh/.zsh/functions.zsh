function xtitle() {
  builtin print -n -- "\e]0;$@\a"
}

function precmd() {
  xtitle "$(print -P \[%2~\])"
}

# cs: go to the tmux session of the current folder. A new session starts Claude Code.
# In $HOME, cs shows a picker of all sessions.
function cs() {
  if [[ $PWD == $HOME ]]; then
    ~/.config/tmux/pick-session.sh
    return
  fi

  local name
  name=$(~/.config/tmux/session-name.sh "$PWD") || return

  tmux has-session -t "=$name" 2>/dev/null || tmux new-session -d -s "$name" -c "$PWD" "${commands[claude]}"
  if [[ -n $TMUX ]]; then
    tmux switch-client -t "=$name"
  else
    tmux attach-session -t "=$name"
  fi
}
