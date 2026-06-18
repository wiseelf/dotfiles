# dotfiles

Modular zsh dotfiles managed with [stow](https://www.gnu.org/software/stow/).

## What's inside

| Package | Contents |
|---------|----------|
| `zsh` | modular `.zshrc` + `.zsh/` config files |
| `starship` | [starship](https://starship.rs) prompt config |
| `btop` | [btop](https://github.com/aristocratos/btop) config + catppuccin theme |
| `claude` | [Claude Code](https://claude.ai/code) agents, skills, rules |
| `mc` | midnight commander + catppuccin skin |

**Plugin manager**: [antidote](https://github.com/mattmc3/antidote) (static bundle — zero startup cost)
**Syntax highlighting**: [zsh-patina](https://github.com/michel-kraemer/zsh-patina)

## Install

```bash
git clone --recurse-submodules https://github.com/wiseelf/dotfiles ~/dotfiles
cd ~/dotfiles
./install.sh
```

`install.sh` is platform-aware: installs zsh on Linux, runs `brew bundle` on macOS.

## Private overrides

Machine-specific and sensitive config lives in a separate private repo that stows files into `~/.zsh/private/`. The public `.zshrc` automatically sources `~/.zsh/private/*.zsh` if present.

Clone your private repo and stow its `zsh` and `claude` packages alongside this one.

## Packages

Stow individual packages selectively:

```bash
stow --no-folding --target=$HOME zsh        # shell only (e.g. remote servers)
stow --no-folding --target=$HOME zsh btop   # shell + system monitor
```
