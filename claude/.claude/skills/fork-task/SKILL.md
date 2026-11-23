---
name: fork-task
description: Use when the user asks to fork, hand off, or delegate a task to a new Claude session in another local directory or repo, or when a change spans several repos and another repo needs its own session.
user-invocable: true
allowed-tools: Bash, Read, Write
---

# Fork a task to another directory

Write a handoff document, then start a new `claude` session in the tmux session of the target directory. Do not watch the new session.

## Inputs

- The target directory. It can be a git repo or a plain directory.
- The task.
- A topic: a short kebab-case name for the folder `~/.local/state/claude-handoffs/<topic>/`.

If `~/.claude/skills/fork-task/presets.md` exists, read it. It gives the default scope and contract for common targets.

If an input is missing, ask the user.

## Steps

1. Examine the target.
   - If the directory does not exist, stop and tell the user.
   - If `git -C <target-dir> rev-parse --is-inside-work-tree` succeeds, run `git -C <target-dir> status -sb`. Show the branch and the status to the user.
   - Find the default branch: `git -C <target-dir> symbolic-ref --short refs/remotes/origin/HEAD`. If this fails, use `main`.
2. Write the handoff document to `~/.local/state/claude-handoffs/<topic>/handoff-<dir-slug>.md`. The `<dir-slug>` is the target directory name in kebab-case, with no spaces. Use the template below.
   - Give the paths of files that have the context. Do not copy their content.
   - Remove secrets: tokens, passwords, keys, and decrypted values. Refer to a secret by its name or path.
   - Use absolute paths. The new session starts in a different directory.
   - If the target is not a git repo, remove the "Start" section and the git rule (commit or push) from the "Do not" section.
3. Start the session. The `<source-dir>` is the working directory of this session. The script uses the tmux session name that `cs` uses. If that session exists, the script adds a window to it.

   ```bash
   bash <skill-dir>/open-session.sh <target-dir> "Read the handoff document <document-path> and do the task in it. Before you stop, write the report file that its Report section names."
   ```

4. Tell the user the document path and the script output, with its `cs` command. If Claude Code did not open the directory before, the new session first asks the user to trust the folder.

## Read the reports

The child does not send messages to this session. It writes a report file. To see the state of all forks, run:

```bash
bash <skill-dir>/handoff-status.sh [topic]
```

Read each report with `status: done` or `status: blocked`. Apply the facts that affect the source task.

## Resume a stopped session

If a session stops before its task is complete, it writes `~/.local/state/claude-handoffs/<topic>/next-session.md`: the state, the next steps, and the files to read. To resume, run `bash <skill-dir>/handoff-status.sh <topic>`. Then start the next session with `open-session.sh` and the prompt "Read <path-to-next-session.md> and continue the task in it." The user does not paste a prompt.

## Handoff document template

Keep all sections. If a section has no content, write "None."

```markdown
# Handoff: <task>

## Goal
<One to three lines.>

## Scope
Change only this directory: `<target-dir>`.
Do not change these directories: <list>.

## What is already done
- `<absolute-path>`: <what it contains>. Read it. Do not edit it.

## Contract
<The exact file names, keys, formats, and values that the other side expects.>

## Start
Do these steps before the tasks.
1. Run `git status -sb`.
2. If the working tree is clean, run `git switch <default-branch>` and `git pull --ff-only`.
3. If the working tree has changes, do not touch them. Start a worktree from `<default-branch>` with the `EnterWorktree` tool, or with `git worktree add`.
4. Create a new branch for the task.

## Tasks
1. <Step.> <Order rules, for example "Do not merge before X is live.">

## Report
When you finish or stop, write `~/.local/state/claude-handoffs/<topic>/report-<dir-slug>.md`. The first line is `status: done` or `status: blocked`. Then give only the facts that affect the source task in `<source-dir>`: contract changes, blockers, open questions, and the PR/MR URL. If no fact affects it, write "None."
If you stop before the task is complete, also write `~/.local/state/claude-handoffs/<topic>/next-session.md`.

## Do not
- Do not run commands that change live systems (`apply`, `deploy`, `sync`).
- Do not decrypt or show secrets.
- Do not commit or push before the user approves.
```
