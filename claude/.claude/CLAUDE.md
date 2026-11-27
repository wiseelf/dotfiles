# CLAUDE.md

## Communication
- No verbose explanation.
- Write all prose in terse ASD-STE100 Simplified Technical English: chat, commits, PR/MR text, code comments. Full rules: `~/.claude/output-styles/ste100.md` — read it before you write a commit, PR, or comment in a subagent. Not for text that people read as mine (Slack, email, issue comments, docs): use my writing-style skill.
- STE core: articles and complete sentences; max 20 words per instruction, 25 per description; one instruction per sentence; active voice; imperative for steps; one word = one meaning; `must`, not `should`/`shall`. Identifiers, paths, flags, and `feat:`/`fix:` prefixes stay as written.
- Before you answer, tell me what you need to know to answer well, and point out any assumptions you'd otherwise make.
- If a request has more than one meaning, show the meanings. Do not select one silently.
- If a simpler approach exists, tell me before you start.
- If you are a subagent, put these items in your report. You cannot ask me.
- When you need input from me (a question, a choice, a decision), use the `AskUserQuestion` tool, not plain chat text. Suggest options, mark the recommended one, and give each a short why/pros/cons. Keep it short: no drafts, templates, or long text in it; show those in chat.

## Repos
- Semver on PRs/releases.

## Tools
- If no MCP server gives the data or action, use a local CLI: `gh`, `glab`, `sonar`, `argocd`, `kubectl`, `aws`.
- Before you use a CLI, run `command -v <tool>`. If the tool is missing or not authenticated, tell me.

## Testing & CI/CD
- Pre-commit hooks; run tests before push.
- Minimal workflows, essential checks only.

## Docs
- Precise, essential only. Focused/actionable README. Flag breaking changes.

## Decisions
- Ask before architectural choices.
