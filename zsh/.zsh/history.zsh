[ -z "$HISTFILE" ] && HISTFILE="$HOME/.zsh_history"
[ "$HISTSIZE" -lt 500000 ] && HISTSIZE=268435456
[ "$SAVEHIST" -lt 100000 ] && SAVEHIST=268435456

setopt extended_history       # record timestamp in HISTFILE
setopt hist_expire_dups_first # trim dups first when over HISTSIZE
setopt hist_ignore_dups       # ignore duplicated commands
setopt hist_ignore_space      # ignore commands starting with space
setopt hist_verify            # confirm history expansion before running
setopt share_history          # share history across sessions
setopt auto_cd                # cd by typing a directory name

HISTORY_SUBSTRING_SEARCH_ENSURE_UNIQUE=1
HISTORY_SUBSTRING_SEARCH_HIGHLIGHT_FOUND=""
HISTORY_SUBSTRING_SEARCH_HIGHLIGHT_NOT_FOUND=""
