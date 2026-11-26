---
name: mr
description: Use when the user asks to create, watch, finish, or check a GitHub pull request or GitLab merge request. Triggers - "/mr", "create mr", "commit and create mr", "check pipeline", "fix pipeline", "fix sonar", "check comments", "merged, cleanup", "merged and deployed", "where is the mr", "status?", "is it merged?".
user-invocable: true
argument-hint: "[create|watch|done|status] [id|url]"
allowed-tools: Bash, Read, Edit, Write
---

# MR lifecycle

One skill for the whole PR/MR lifecycle. The first argument selects the phase. With no argument, run `create`.

## Before each phase

1. Find the platform from `git remote -v`. GitHub uses `gh`. GitLab uses `glab`.
2. Run `command -v gh` or `command -v glab`, then `gh auth status` or `glab auth status`. If the CLI fails, stop and tell the user.
3. Find the default branch: `git symbolic-ref --short refs/remotes/origin/HEAD`.
4. If `~/.claude/skills/mr/overlay.md` exists, read it. Its rules add to the rules in this file. If a rule conflicts, the overlay wins.
5. Detect the integrations (next section).

## Integrations

Each integration is optional. If an integration is not detected, skip its steps. Do not report it as an error.

| Integration | Detect |
|---|---|
| Sonar | `sonar-project.properties` exists, or the CI config has a Sonar job, or the overlay enables it |
| Review bot | The CI config has a review-bot job, or a bot left a comment on the MR, or the overlay names one |
| Ticket tracker | The branch name has a ticket key (`[A-Z][A-Z0-9]+-[0-9]+`) and a Jira MCP tool is available |
| Post-merge extras | Only from the overlay |

## create

1. Run the `commit` skill for the pending changes.
2. If the branch has no upstream, run `git push -u origin <branch>`. Otherwise, run `git push`.
3. Run the `pull-request` skill. If a PR/MR for the branch exists, update it. Put the quick actions of the overlay (reviewers, assignee) at the end of the description, so that they apply at creation.
4. If the PR/MR existed before, post the quick actions as a note: `glab mr note <id> -m "<quick actions>"`.
5. Ticket tracker: add the PR/MR URL as a remote link on the ticket. Do not change the ticket status.
6. The last line of the reply must be the PR/MR URL.

## watch [id|url]

Default target: the PR/MR of the current branch. Repeat these steps until the pipeline passes and no unresolved thread is left, or until a fix needs the user.

1. Wait for the pipeline: `gh pr checks --watch` or `glab ci status --live`.
2. If a job failed, read its log: `gh run view <run-id> --log-failed` or `glab ci trace <job-id>`.
3. Read the unresolved review threads:
   - GitHub: `gh pr view --comments` and `gh api repos/{owner}/{repo}/pulls/<n>/comments`.
   - GitLab: `glab api projects/:id/merge_requests/<iid>/discussions`, filter `resolved == false`.
4. Sonar: read the new issues and the quality gate of the PR/MR.
5. Review bot: read its findings. If it did not approve, find the cause and tell the user.
6. Fix each real problem. Commit with the `commit` skill and push.
7. Reply to each thread that you fixed. Do not resolve a thread that a person opened.

Stop and ask the user when a fix changes the design, when a finding is a false positive, or after 3 rounds on the same failure.

Report as a short checklist: pipeline state, threads left, Sonar state, the bot state, and the URL.

## done

Run this after the user says that the PR/MR is merged.

1. Make sure that the PR/MR is merged: `gh pr view --json state,mergedAt` or `glab mr view <id> -F json`. If it is not merged, stop and tell the user.
2. Find the worktree of the branch: `git worktree list`. If `git -C <worktree> status --porcelain` shows changes, stop and tell the user.
3. Remove the worktree: `git worktree remove <path>`.
4. In the main checkout, run `git switch <default-branch>`, `git pull --ff-only`, and `git fetch --prune`.
5. Delete the local branch: `git branch -d <branch>`. If `-d` refuses (for example after a squash merge), and step 1 showed the merge, use `-D`.
6. Ticket tracker and post-merge extras: do the steps of the overlay. Show each change to the user before you send it.
7. If the user gave an ordered list of MRs, show the list with each item marked done or open, and name the next one.
8. Suggest `/clear` before the next task. The next task does not need the context of this one.

## status

1. List the open PRs/MRs of the user in this repo: `gh pr list --author @me` or `glab mr list --author=@me`.
2. For each one, show the pipeline state, the count of unresolved threads, the approval state, and the URL.
3. If the session has an ordered merge list, show it as a checklist.
