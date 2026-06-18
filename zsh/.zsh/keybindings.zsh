autoload -Uz select-word-style
select-word-style bash

# History substring search (widgets provided by the plugin)
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down
# Home / End
bindkey "^[[H" beginning-of-line
bindkey "^[[F" end-of-line

HISTORY_SUBSTRING_SEARCH_ENSURE_UNIQUE=1
HISTORY_SUBSTRING_SEARCH_HIGHLIGHT_FOUND=""
HISTORY_SUBSTRING_SEARCH_HIGHLIGHT_NOT_FOUND=""
