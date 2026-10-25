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

  local name=${${PWD:t}//[.:]/_}
  local existing_path
  existing_path=$(tmux display-message -p -t "=$name:" '#{session_path}' 2>/dev/null)
  # Two folders with the same name: add the parent folder to the session name.
  [[ -n $existing_path && $existing_path != $PWD ]] && name=${${PWD:h:t}//[.:]/_}-$name

  tmux has-session -t "=$name" 2>/dev/null || tmux new-session -d -s "$name" -c "$PWD" "${commands[claude]}"
  if [[ -n $TMUX ]]; then
    tmux switch-client -t "=$name"
  else
    tmux attach-session -t "=$name"
  fi
}
