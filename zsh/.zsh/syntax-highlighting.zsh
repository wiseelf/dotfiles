# zsh-patina: Rust syntax highlighting daemon
# Mac: brew tap michel-kraemer/zsh-patina && brew install zsh-patina
# Linux: prebuilt binary from GitHub releases or cargo
_patina_bin="$(brew --prefix 2>/dev/null)/bin/zsh-patina"
if [[ -x $_patina_bin ]]; then
  eval "$($_patina_bin activate)"
elif (( $+commands[zsh-patina] )); then
  eval "$(zsh-patina activate)"
fi
unset _patina_bin
