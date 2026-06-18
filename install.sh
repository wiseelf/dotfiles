#!/usr/bin/env bash
set -euo pipefail

PLATFORM="$(uname -s)"
DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIVATE_DIR="${PRIVATE_DIR:-$(dirname "$DOTFILES_DIR")/private}"

PUBLIC_PACKAGES=(zsh starship btop claude mc)
PRIVATE_PACKAGES=(zsh claude)

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

install_zsh() {
  have zsh && { log "zsh present ($(zsh --version))"; return; }
  log "Installing zsh"
  case "$PLATFORM" in
    Linux)
      if   have apt-get; then sudo apt-get update -q && sudo apt-get install -y zsh
      elif have dnf;     then sudo dnf install -y zsh
      elif have pacman;  then sudo pacman -S --noconfirm zsh
      elif have zypper;  then sudo zypper install -y zsh
      else warn "Unknown package manager — install zsh manually"; fi
      ;;
    Darwin) log "zsh ships with macOS" ;;
  esac
}

install_homebrew() {
  [[ "$PLATFORM" == Darwin ]] || return 0
  have brew && return 0
  log "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
}

install_mac_deps() {
  [[ "$PLATFORM" == Darwin ]] || return 0
  log "brew bundle"
  brew trust michel-kraemer/zsh-patina 2>/dev/null || true
  brew bundle --file="$DOTFILES_DIR/Brewfile"
}

install_antidote() {
  have antidote && { log "antidote present"; return; }
  if [[ "$PLATFORM" == Darwin ]] && have brew; then
    brew install antidote
    return
  fi
  log "Cloning antidote to ~/.antidote"
  [[ -d "$HOME/.antidote" ]] || \
    git clone --depth=1 https://github.com/mattmc3/antidote.git "$HOME/.antidote"
}

install_patina_linux() {
  [[ "$PLATFORM" == Linux ]] || return 0
  have zsh-patina && { log "zsh-patina present"; return; }
  local arch; arch=$(uname -m)
  local bin_dir="$HOME/.local/bin"
  mkdir -p "$bin_dir"
  local url="https://github.com/michel-kraemer/zsh-patina/releases/latest/download/zsh-patina-${arch}-unknown-linux-musl"
  log "Downloading zsh-patina binary for $arch"
  if curl -fsSL "$url" -o "$bin_dir/zsh-patina" 2>/dev/null; then
    chmod +x "$bin_dir/zsh-patina"
    log "zsh-patina installed to $bin_dir"
  elif have cargo; then
    log "Binary download failed — falling back to cargo install"
    cargo install --locked zsh-patina
  else
    warn "zsh-patina unavailable — no syntax highlighting on this machine"
  fi
}

stow_packages() {
  local dir=$1; shift
  [[ -d $dir ]] || { warn "skip stow: $dir not found"; return; }
  log "stow $(basename $dir): $*"
  ( cd "$dir" && stow --no-folding --target="$HOME" --restow "$@" )
}

stow_private() {
  if [[ ! -d "$PRIVATE_DIR" ]]; then
    warn "Private repo not found at $PRIVATE_DIR — set PRIVATE_DIR env var to override"
    return
  fi
  stow_packages "$PRIVATE_DIR" "${PRIVATE_PACKAGES[@]}"
}

main() {
  log "Platform: $PLATFORM"
  install_zsh
  install_homebrew
  install_mac_deps
  install_antidote
  install_patina_linux
  stow_packages "$DOTFILES_DIR" "${PUBLIC_PACKAGES[@]}"
  stow_private
  log "Done — start a new shell: exec zsh"
}

main "$@"
