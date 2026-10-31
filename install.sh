#!/usr/bin/env bash
set -euo pipefail

PLATFORM="$(uname -s)"
DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIVATE_DIR="${PRIVATE_DIR:-$(dirname "$DOTFILES_DIR")/private}"

PUBLIC_PACKAGES=(zsh starship btop claude mc ghostty tmux zed)
# Stowed as one folder link: Claude Code refuses a mod file that is a symlink out of its plugin folder.
FOLDED_PACKAGES=(claude-mods)
PRIVATE_PACKAGES=(zsh)
CATPPUCCIN_TMUX_VERSION=v2.3.2
ZSH_PATINA_VERSION=1.11.0

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

install_linux_deps() {
  [[ "$PLATFORM" == Linux ]] || return 0
  local pkgs=()
  have stow || pkgs+=(stow)
  [[ ${#pkgs[@]} -eq 0 ]] && return 0
  log "Installing Linux dependencies: ${pkgs[*]}"
  if   have apt-get; then sudo apt-get install -y "${pkgs[@]}"
  elif have dnf;     then sudo dnf install -y "${pkgs[@]}"
  elif have pacman;  then sudo pacman -S --noconfirm "${pkgs[@]}"
  elif have zypper;  then sudo zypper install -y "${pkgs[@]}"
  else warn "Unknown package manager — install ${pkgs[*]} manually"; fi
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
  local arch sha256
  arch=$(uname -m)
  # SHA256 of each release asset. Update these values when you change ZSH_PATINA_VERSION.
  case "$arch" in
    x86_64)  sha256=00ab75b59aa974fc434e63fc6225a9f5a8fd35b5d4fa2f5c36342dc56bf82005 ;;
    aarch64) sha256=e224d055c55957c888c1d027399827553f13a08f6f856fb16cee77084fde5579 ;;
    i686)    sha256=f3edb4cc06bc5a399873381f5b9203dc94b58028df9b841309d5c02633287293 ;;
    *)       sha256="" ;;
  esac
  local bin_dir="$HOME/.local/bin"
  local asset="zsh-patina-v${ZSH_PATINA_VERSION}-${arch}-unknown-linux-musl.tar.gz"
  local tarball
  tarball=$(mktemp)
  mkdir -p "$bin_dir"
  log "Downloading zsh-patina $ZSH_PATINA_VERSION for $arch"
  if [[ -n $sha256 ]] \
    && curl -fsSL -o "$tarball" "https://github.com/michel-kraemer/zsh-patina/releases/download/${ZSH_PATINA_VERSION}/${asset}" \
    && echo "$sha256  $tarball" | sha256sum -c --status \
    && tar -xzf "$tarball" --strip-components=1 -C "$bin_dir" --wildcards '*/zsh-patina' 2>/dev/null; then
    chmod +x "$bin_dir/zsh-patina"
    log "zsh-patina installed to $bin_dir"
  elif have cargo; then
    log "Verified binary unavailable — falling back to cargo install"
    cargo install --locked zsh-patina --version "$ZSH_PATINA_VERSION"
  else
    warn "zsh-patina unavailable — no syntax highlighting on this machine"
  fi
  rm -f "$tarball"
}

# Upstream recommends a manual clone instead of TPM.
install_catppuccin_tmux() {
  local dir="$HOME/.config/tmux/plugins/catppuccin/tmux"
  if [[ -d $dir ]]; then
    log "catppuccin/tmux: checkout $CATPPUCCIN_TMUX_VERSION"
    git -C "$dir" fetch -q --depth=1 origin tag "$CATPPUCCIN_TMUX_VERSION"
    git -C "$dir" -c advice.detachedHead=false checkout -q "$CATPPUCCIN_TMUX_VERSION"
    return
  fi
  log "Cloning catppuccin/tmux $CATPPUCCIN_TMUX_VERSION"
  git clone -q -c advice.detachedHead=false --depth=1 -b "$CATPPUCCIN_TMUX_VERSION" \
    https://github.com/catppuccin/tmux.git "$dir"
}

# Usage: stow_packages <dir> [--fold] <packages...>
stow_packages() {
  local dir=$1; shift
  local folding=--no-folding
  if [[ ${1:-} == --fold ]]; then folding=""; shift; fi
  [[ -d $dir ]] || { warn "skip stow: $dir not found"; return; }
  log "stow $(basename $dir): $*"
  # Back up any plain files that would conflict with stow symlinks
  local conflicts
  # shellcheck disable=SC2086 # $folding is empty or one word
  conflicts=$(cd "$dir" && stow $folding --target="$HOME" --simulate --restow "$@" 2>&1 || true)
  while IFS= read -r target; do
    [[ -z $target ]] && continue
    [[ -e "$HOME/$target" && ! -L "$HOME/$target" ]] || continue
    warn "backing up ~/$target → ~/$target.bak"
    mv "$HOME/$target" "$HOME/$target.bak"
  done < <(echo "$conflicts" | sed -n 's/.*existing target \([^ ]*\) since.*/\1/p')
  # shellcheck disable=SC2086
  ( cd "$dir" && stow $folding --target="$HOME" --restow "$@" )
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
  install_linux_deps
  install_antidote
  install_patina_linux
  stow_packages "$DOTFILES_DIR" "${PUBLIC_PACKAGES[@]}"
  stow_packages "$DOTFILES_DIR" --fold "${FOLDED_PACKAGES[@]}"
  install_catppuccin_tmux
  stow_private
  log "Done — start a new shell: exec zsh"
}

main "$@"
