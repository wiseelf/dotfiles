if (( $+commands[starship] )); then
  eval "$(starship init zsh)"
else
  autoload -U colors && colors
  setopt prompt_subst
  PS1='%F{blue}%2~%f %(?.%F{green}.%F{red})❯%f '
fi
