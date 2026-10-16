# blast-radius

A fork of [blast-radius](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius) (Apache-2.0), from upstream commit `569c528`.

## Local changes

The mod also holds these commands and shows what they change:

| Command | What the pane shows |
|---|---|
| `terraform`/`tofu destroy`, `apply -destroy` | The resources in `plan -destroy`. |
| `kubectl delete` | The resources from `kubectl get` with the same selectors. |
| `helm uninstall` (`delete`, `del`, `un`) | The resources in `helm get manifest`. |

A `--dry-run` (not `none`) command runs and is not held.

An `rm -r`/`rm -f` runs and is not held if each path is one of these:

- A path inside `/tmp` (not `/tmp` itself).
- A linked worktree inside the main worktree of its repo (for example `.worktrees/feature`). Files inside a worktree are still held.

The mod holds a git push or branch command only if it deletes or force-pushes `main` or `master`:

- `git push --force`, `-f`, `--force-with-lease`, or `+ref` to `main`/`master`. A force push with no refspec is held if the current branch pushes to `main`/`master`.
- `git push --mirror`, and `git push --force --all`.
- `git push --delete main`, `git push origin :main`, `git branch -D main`.

The mod examines every segment of a command line, so one allowed `rm` does not let a later risky segment run. The text of a heredoc is data, so the mod does not examine it.

The pane shows the risky segment, not the whole command, so the pane does not scroll. It shows one button on each row. Use ↑/↓ and Enter, or press `1` (Proceed) or `2` (Cancel).

## Load

`settings.json` sets `CLAUDE_CODE_PLUGIN_DIRS` to `~/.claude/mods`. Stow links the `mods` folder there. Each session loads the mod and reloads it when a file changes.

## Add a command

1. Write a classifier `(cmd, args, dir) => risk | null` in `hooks/blast-radius.mjs`.
2. Add the classifier to `TOOL_CLASSIFIERS`.
3. Write a measurer `($, risk, cwd) => { summary, lines, more, note }`.
4. Add a branch for `risk.kind` to `measure()`. Call the measurer by name, because the validator reads `$` calls from source.
5. Add tests to `tests/classify.test.ts`.

## Check

```bash
claude plugin validate .
claude plugin test .
```
