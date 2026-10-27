# statusline

One row above the prompt hint line. It replaces the `statusLine` command.
Fork of the `statusline` mod (v0.4.0) from `sirantd/claude-mods` @ `b36a639`, by Dmytro Sirant.

## What it shows

Parts are joined by ` | `, in this order:

- Model, `Effort <level>` (the main loop's last request), `Ctx 120k/200k 60%`.
- Plan figures:
  - Subscription: `5h N%` and its reset (only above 90%), `Pace →N%` weekly projection (green under, red over, grey even).
  - Metered (enterprise): `Session $x.xx`, `Month $used/$limit N% left` (reset at 20% left or less). The limit comes from
    `https://api.anthropic.com/api/oauth/usage` with the session's own credential, once in 5 minutes at most.
- `Skill <name>` (the last skill used).
- `~/dir`, git host icon (a click opens `origin`), `⎇ branch`, `+added -removed` against `HEAD`, `𖠰` in a linked
  worktree (a click copies its path).

On a narrow terminal, parts drop from the end. The icons need a Nerd Font. The terminal and the desktop app draw the
row. VS Code and mobile do not.

Git runs only when the directory changes, or after a `Bash`, `Edit`, `Write`, `MultiEdit` or `NotebookEdit` call.

## Install

This folder loads through `CLAUDE_CODE_PLUGIN_DIRS=~/.claude/mods` (see the repo README). Do not also set a
`statusLine` key in `settings.json`, or two status lines show.

## Develop

```sh
claude plugin validate --strict ~/.claude/mods/statusline
claude plugin test ~/.claude/mods/statusline
tsc -p ~/.claude/mods/statusline
```
