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
7. Find the repo PR/MR template. Read the first match:
   - GitLab: `.gitlab/merge_request_templates/Default.md`, then the project setting `glab api projects/:id | jq -r .merge_requests_template`.
   - GitHub: `.github/pull_request_template.md`, `pull_request_template.md`, or `docs/pull_request_template.md` (any case).
   - If only a directory with more than one template exists, ask the user which template to use.

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
   - Add a note only if it gives a concrete fact that the reviewer needs. Otherwise, omit the section.

### If the repo has a template

The CLI does not apply the template when you give a body file. Merge the template into the description yourself:

1. Keep the order and the headings of the template.
2. Put the content of each section above into the template section with the same purpose (for example, "Description" gets What, "Testing" gets Checks).
3. Add each section above that has no match in the template. Put it before the quick actions.
4. If a template section does not apply, keep the heading and write `N/A`.
5. Tick a checkbox only if the item is true and verified. Leave the other checkboxes empty.
6. Remove the placeholder text and the HTML instruction comments that you replaced.
7. Keep the quick actions (`/assign`, `/label`, `/milestone`, `/draft`, and others) exactly as written, at the end of the description.

## 4. Publish

Publish without approval. The user reviews the text in the PR/MR.

1. If the branch has no upstream, push it with `git push -u origin <branch>`.
2. Create the PR/MR with a body file, not an inline string:
   - GitHub: `gh pr create --base <base> --title "<title>" --body-file <file>`
   - GitLab: `glab mr create --target-branch <base> --title "<title>" --description "$(cat <file>)"`
3. To update an existing PR/MR, use `gh pr edit --body-file <file>` or `glab mr update <id> --description "$(cat <file>)"`.
4. Give the user the title and the URL. Do not show the description in chat.

## Common mistakes

| Mistake | Correct |
|---|---|
| "Improves reliability" | "Retries failed webhook deliveries 6 times with backoff" |
| "Tested locally", "All tests pass" | The exact command and its result |
| A list of changed files | The behavior change of each component |
| A summary section at the end | Notes for reviewers only, or nothing |
| An empty section heading | Omit the section (a template section gets `N/A`) |
| The template is ignored, or its quick actions are lost | Merge into the template, keep the quick actions |
| A filler note ("no hooks ran", "no issues found") | Omit the note |
| Text describes only the last commit | Text describes all commits since the base |
