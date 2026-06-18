function xtitle() {
  builtin print -n -- "\e]0;$@\a"
}

function precmd() {
  xtitle "$(print -P \[%2~\])"
}
