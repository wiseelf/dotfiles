# rule-guard

A `tool.call` hook on Bash and REPL. It denies a command or a script that breaks a setup rule. The reason names the fix, so the agent can try again the correct way.

| Rule | Denied | Allowed |
|---|---|---|
| No commit on the default branch | `git commit` when the current branch is the default branch of a repo with an `origin` remote | A commit on another branch, or in a repo with no `origin` |
| No push to the default branch | `git push` with no refspec when `@{push}` (or the current branch) is the default branch; a refspec that writes it (`main`, `HEAD`, `x:main`, `:main`, `refs/heads/*`); `--all`, `--branches`, `--mirror` | A push of another branch, `--tags` |
| No in-place edit | `sed -i`, `sed -I`, `sed --in-place`, `gsed -i`, `perl -i`, `perl -pi`, `-i.bak` | `sed -n`, `sed 's/a/b/' f > g`, `perl -ne` |
| No sleep to wait | `sleep` that starts the line, `sleep N` with N > 5 s, `sleep "$VAR"` | `sleep 2` inside a retry loop |
| No sleep to wait in the REPL | `sleep(N)` with N > 5000 ms, or a value that is not a number literal (`sleep(ms)`, `sleep(60 * 1000)`) | `await sleep(2000)` inside a retry loop |

It finds a command after `;`, `&&`, `|`, `$(…)`, `bash -c`, `eval`, `find -exec`, and wrappers like `sudo`, `env`, `xargs` and `timeout`. It ignores quoted text, comments and heredoc bodies.

The repo of a git call is the session folder, changed by each `cd` and `git -C` on the line. A folder with a variable in it is denied, because the hook cannot know the repo.

It does not block `gh pr merge` or `glab mr merge`.

In a REPL script, it ignores comments, strings and template text. A `$` command in a script goes through the Bash hook.

## Limits

- A command inside double quotes, such as `"$(sleep 10)"`, is not seen.
- A command that does not contain `git`, `sed`, `gsed`, `perl` or `sleep` goes through without a check.
- In the REPL, a wait through `setTimeout`, or through `sleep` under another name, is not seen.
- A REPL script that does not contain `sleep(` goes through without a check.
- If the hook fails, the `.catch` denies the command (fail-closed). The word filter above limits this to commands with those words.

## Bypass

The hook has no bypass. To run a denied command, type `! <command>` in the prompt: tool hooks do not run for it. A denied REPL script has no bypass.

## Check

```bash
claude plugin validate .
claude plugin test .
```
