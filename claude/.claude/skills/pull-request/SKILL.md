---
name: pull-request
description: Use when the user asks to open, create, draft, or update a GitHub pull request or a GitLab merge request, or to write a PR or MR title or description.
user-invocable: true
allowed-tools: Bash, Read
---

# Pull request / merge request

The description tells a reviewer why the change exists, what it does, and how it was verified. Every claim is a concrete fact: names, timestamps, counts, command output.

Write all prose in ASD-STE100. Read `~/.claude/output-styles/ste100.md` before you write. `example.md` in this directory shows the target quality.

## 1. Collect the facts

1. Find the platform from `git remote -v`: GitHub uses `gh`, GitLab uses `glab`.
2. Find the base branch: `gh repo view --json defaultBranchRef` or `glab repo view`.
3. Read all changes: `git log <base>..HEAD` and `git diff <base>...HEAD`. Also read uncommitted changes.
4. Find the ticket key in the branch name and the commit messages (for example `SHOP-512`).
5. Find related PRs/MRs, incidents, and parent tickets in the commits, the ticket, and the conversation.
6. Collect the verification evidence: commands that ran in this session and their results.

If a fact for a section is not known, ask the user. Do not invent incidents, numbers, or check results.

## 2. Write the title

`<type>: <what changed>` with a semantic type (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`). Imperative, no period, max approximately 70 characters. Add `!` after the type for a breaking change.

## 3. Write the description

Use these sections in this order. Omit a section that has no content, except Why and What.

1. **Ticket line** (if a ticket exists): `Jira: <KEY> (part of <PARENT>, <INCIDENT> remediation)`.
2. **`## Why`**: the problem in 2–4 sentences. Give the concrete trigger: what failed, when, who did not see it, and the effect.
3. **`## What`**: one short paragraph for each changed component. Start each paragraph with the component name in bold, then a colon.
   - Use a table for parallel items (endpoints, config keys, resources) with the same attributes.
   - For each non-obvious design choice, give the reason and the rejected alternative.
   - State what the change deliberately does not do, and why.
   - State the relation to other PRs/MRs: replaces, depends on, follow-up.
   - Start a `**Breaking:**` paragraph if users or other systems must change something.
4. **`## Checks`**: a bulleted list. Each item is the exact command or method, then the result (`pytest tests/webhooks: 42 passed.`). Only include checks that ran.
5. **`## Notes for reviewers`**: a bulleted list of findings outside the scope, known limitations, and things deliberately left as they are.

## 4. Confirm, then publish

1. Show the title and the description to the user. Wait for approval.
2. If the branch has no upstream, push it with `git push -u origin <branch>`.
3. Create the PR/MR with a body file, not an inline string:
   - GitHub: `gh pr create --base <base> --title "<title>" --body-file <file>`
   - GitLab: `glab mr create --target-branch <base> --title "<title>" --description "$(cat <file>)"`
4. To update an existing PR/MR, use `gh pr edit --body-file <file>` or `glab mr update <id> --description "$(cat <file>)"`.
5. Give the user the URL.

## Common mistakes

| Mistake | Correct |
|---|---|
| "Improves reliability" | "Retries failed webhook deliveries 6 times with backoff" |
| "Tested locally", "All tests pass" | The exact command and its result |
| A list of changed files | The behavior change of each component |
| A summary section at the end | Notes for reviewers only, or nothing |
| An empty section heading | Omit the section |
| Text describes only the last commit | Text describes all commits since the base |
