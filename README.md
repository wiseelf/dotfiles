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
git clone https://github.com/wiseelf/dotfiles/public ~/dotfiles/public
git clone <private-repo-url>                          ~/dotfiles/private  # optional
cd ~/dotfiles/public
./install.sh
```

`install.sh` is platform-aware: installs zsh on Linux, runs `brew bundle` on macOS. It expects the private repo at `../private` relative to itself (i.e. `~/dotfiles/private`). Override with `PRIVATE_DIR=/path/to/private ./install.sh`.

## Private overrides

Machine-specific and sensitive config lives in a separate private repo. The installer stows shared private packages automatically. Machine-specific packages must be stowed manually from the private repo after install.

The installer auto-detects `../private` alongside the public repo. Set `PRIVATE_DIR` to use a different path. The public `.zshrc` automatically sources `~/.zsh/private/*.zsh` if present.

## Packages

Stow individual packages selectively:

```bash
stow --no-folding --target=$HOME zsh        # shell only (e.g. remote servers)
stow --no-folding --target=$HOME zsh btop   # shell + system monitor
```
