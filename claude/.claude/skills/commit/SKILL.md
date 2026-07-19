---
name: commit
description: Commit staged or unstaged changes in this repo.
user-invocable: true
allowed-tools: Bash, zsh
---

Commit changes in this gitlabform repository following these rules:

1. **Stage files explicitly** — use `git add <specific files>`, never `git add -A` or `git add .`
2. **Never use `--no-verify`** — all other hooks must run and pass
3. **Commit message style** — match recent commits (imperative, no period, e.g. "Grants mc-pad-onboard-dev access to playwright-e2e repo")
4. **No Co-Authored-By trailer** — do not add it

If $ARGUMENTS is provided, use it as the commit message. Otherwise derive one from the staged diff.
