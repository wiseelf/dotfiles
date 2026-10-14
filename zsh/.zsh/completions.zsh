# compinit runs in .zshrc (after plugins extend fpath, before modules)
# This file handles caching and zstyle only.

# --- cached tool completions -------------------------------------------------
# Regenerate only when the tool binary is newer than its cache file.
_cache_dir=${ZDOTDIR:-$HOME}/.zsh/cache
[[ -d $_cache_dir ]] || mkdir -p $_cache_dir

_cache_completion() {
  local tool=$1; shift
  (( $+commands[$tool] )) || return 0
  local cache=$_cache_dir/$tool.zsh
  if [[ ! -f $cache || $commands[$tool] -nt $cache ]]; then
    "$@" > $cache 2>/dev/null || { rm -f $cache; return 0; }
  fi
  source $cache
}

_cache_completion kubectl kubectl completion zsh
_cache_completion helm    helm    completion zsh
_cache_completion docker  docker  completion zsh
_cache_completion podman  podman  completion zsh

unfunction _cache_completion
unset _cache_dir

# aws_completer (bash-style, cheap — no caching needed)
(( $+commands[aws_completer] )) && complete -C aws_completer aws

# kubecolor mirrors kubectl completion
(( $+commands[kubecolor] )) && compdef kubecolor=kubectl

# sops: `sops <file>` is the same as `sops edit <file>`.
# The Homebrew _sops shows only subcommands at the first position. This adds files.
_sops_with_files() {
  local cur=${words[CURRENT]} ret=1
  local -a cmd=(${words[1,CURRENT-1]}) opts
  [[ $cur == -* ]] && cmd+=($cur)
  opts=(${(f)"$(_CLI_ZSH_AUTOCOMPLETE_HACK=1 $cmd --generate-bash-completion 2>/dev/null)"})
  (( $#opts )) && _describe 'values' opts && ret=0
  # Files at the first position, and where sops offers no values
  if [[ $cur != -* ]] && (( CURRENT == 2 || ! $#opts )); then
    _files && ret=0
  fi
  return ret
}
(( $+commands[sops] )) && compdef _sops_with_files sops

# Case-insensitive / partial matching
zstyle ':completion:*' matcher-list 'r:|=*' 'l:|=* r:|=*'
