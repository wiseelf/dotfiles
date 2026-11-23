function xtitle() {
  builtin print -n -- "\e]0;$@\a"
}

function precmd() {
  xtitle "$(print -P \[%2~\])"
}

# cs: go to a Claude Code session of the current folder. A new session starts Claude Code.
#   cs          The main session of the folder. In $HOME, the session is "home".
#   cs -n       A new session: <name>-2, <name>-3, and so on.
#   cs <label>  The session <name>-<label>.
#   cs -p       A picker of all sessions.
function cs() {
  local usage="Usage: cs [-n | -p | <label>]"
  (( $# <= 1 )) || { print -u2 -- "$usage"; return 2; }

  case ${1-} in
    -p) ~/.config/tmux/pick-session.sh; return ;;
    -h|--help) print -- "$usage"; return ;;
  esac

  local base name
  base=$(~/.config/tmux/session-name.sh "$PWD") || return

  case ${1-} in
    "") name=$base ;;
    -n)
      local -i index=2
      while tmux has-session -t "=$base-$index" 2>/dev/null; do (( index++ )); done
      name="$base-$index"
      ;;
    -*) print -u2 -- "$usage"; return 2 ;;
    # tmux does not accept '.' or ':' in a session name.
    *) name="$base-${1//[.:]/_}" ;;
  esac

  tmux has-session -t "=$name" 2>/dev/null || tmux new-session -d -s "$name" -c "$PWD" "${commands[claude]}"
  if [[ -n $TMUX ]]; then
    tmux switch-client -t "=$name"
  else
    tmux attach-session -t "=$name"
  fi
}
