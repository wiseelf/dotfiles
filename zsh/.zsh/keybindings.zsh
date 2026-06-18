autoload -Uz select-word-style
select-word-style bash

# History substring search (widgets provided by the plugin)
zmodload zsh/terminfo
bindkey "${terminfo[kcuu1]}" history-substring-search-up
bindkey "${terminfo[kcud1]}" history-substring-search-down
# ANSI fallback for terminals that don't populate terminfo
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down
# Home / End
bindkey "^[[H" beginning-of-line
bindkey "^[[F" end-of-line
