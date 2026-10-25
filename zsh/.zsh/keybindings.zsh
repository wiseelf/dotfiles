autoload -Uz select-word-style edit-command-line
select-word-style bash

# History substring search (widgets provided by the plugin)
# Bind the key code of the current terminal from terminfo. Skip it if the host has no terminfo entry for $TERM.
bind_terminfo_key() {
  [[ -n "${terminfo[$1]}" ]] && bindkey "${terminfo[$1]}" "$2"
}

zmodload zsh/terminfo
bind_terminfo_key kcuu1 history-substring-search-up
bind_terminfo_key kcud1 history-substring-search-down
# ANSI fallback for terminals that don't populate terminfo
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down
# Home / End
bindkey "^[[H" beginning-of-line
bindkey "^[[F" end-of-line
# Home / End codes of the current terminal (inside tmux: ^[[1~ and ^[[4~)
bind_terminfo_key khome beginning-of-line
bind_terminfo_key kend end-of-line
unfunction bind_terminfo_key

# Open buffer line in editor
zle -N edit-command-line
bindkey '^x^e' edit-command-line

# Magic space
bindkey ' ' magic-space
