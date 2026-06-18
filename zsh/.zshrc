# ~/.zshrc — modular loader
# Public:  github.com/wiseelf/dotfiles
# Private: github.com/wiseelf/dotfiles-private (stows into ~/.zsh/private/)

export LANG=en_US.UTF-8

# OMZ aws plugin config (must precede plugin load)
SHOW_AWS_PROMPT=false
AWS_PROFILE_STATE_ENABLED=false

# Silent no-op so plugins that call compdef before compinit don't error
# compinit (called after bundle) replaces this with the real implementation
function compdef() { : }

# --- antidote plugin manager (static bundle, zero runtime cost) ---------------
_antidote_brew="$(brew --prefix 2>/dev/null)/share/antidote/antidote.zsh"
if [[ -f $_antidote_brew ]]; then
  source $_antidote_brew
elif (( $+commands[antidote] )); then
  source "$(antidote home)/antidote.zsh"
elif [[ -d ${ZDOTDIR:-$HOME}/.antidote ]]; then
  source "${ZDOTDIR:-$HOME}/.antidote/antidote.zsh"
fi
unset _antidote_brew

if (( $+functions[antidote] )); then
  zsh_plugins=${ZDOTDIR:-$HOME}/.zsh_plugins.zsh
  if [[ ! -f $zsh_plugins || ${ZDOTDIR:-$HOME}/.zsh/plugins.txt -nt $zsh_plugins ]]; then
    antidote bundle < ${ZDOTDIR:-$HOME}/.zsh/plugins.txt > $zsh_plugins
  fi
  source $zsh_plugins
fi

# Init completion system after plugins (so plugin fpath additions are picked up)
autoload -Uz compinit bashcompinit
_zcompdump=${ZDOTDIR:-$HOME}/.zcompdump
[[ -n $_zcompdump(#qN.mh+24) ]] && compinit -d $_zcompdump || compinit -C -d $_zcompdump
bashcompinit
unset _zcompdump

# --- modular config -----------------------------------------------------------
ZSH_CONF_DIR=${ZDOTDIR:-$HOME}/.zsh
for _f in exports history keybindings completions aliases functions prompt syntax-highlighting; do
  [[ -r $ZSH_CONF_DIR/$_f.zsh ]] && source $ZSH_CONF_DIR/$_f.zsh
done
unset _f ZSH_CONF_DIR

# --- private overrides (provided by dotfiles-private, optional) ---------------
for _f in ${ZDOTDIR:-$HOME}/.zsh/private/*.zsh(N); do
  source $_f
done
unset _f
