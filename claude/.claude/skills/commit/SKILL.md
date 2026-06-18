---
name: commit
description: Commit staged or unstaged changes in this repo. Handles the terragrunt_fmt pre-commit hook issue automatically.
user-invocable: true
allowed-tools: Bash, zsh
---

Commit changes in this gitlabform repository following these rules:

1. **Stage files explicitly** — use `git add <specific files>`, never `git add -A` or `git add .`
2. **Run pre-commit but skip terragrunt_fmt** — `terragrunt` is not installed locally so that hook always fails. Skip it with `SKIP=terragrunt_fmt`:
   - Stage first: `git add <files>`
   - Then commit: `SKIP=terragrunt_fmt git commit -m "<message>"`
   - Do NOT inline `SKIP=` on the same command as `git add` — it won't carry over to `git commit`
3. **Never use `--no-verify`** — all other hooks must run and pass
4. **Commit message style** — match recent commits (imperative, no period, e.g. "Grants mc-pad-onboard-dev access to playwright-e2e repo")
5. **No Co-Authored-By trailer** — do not add it

If $ARGUMENTS is provided, use it as the commit message. Otherwise derive one from the staged diff.


