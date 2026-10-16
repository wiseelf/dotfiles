# CLAUDE.md

## Communication
- When reporting information to me, be extremely concise and sacrifice grammar for the same of concision.
- Options, not decisions. No verbose explanation. No filler, no introduction, no closing summary.
- Write all prose in terse ASD-STE100 Simplified Technical English: chat, commits, PR/MR text, code comments. Full rules: `~/.claude/output-styles/ste100.md` — read it before you write a commit, PR, or comment in a subagent.
- Text that people read as mine (Slack, email, issue comments, docs): not STE100. Use my personal writing-style skill if one exists.
- STE core: articles and complete sentences; max 20 words per instruction, 25 per description; one instruction per sentence; active voice; imperative for steps; one word = one meaning; `must`, not `should`/`shall`. Identifiers, paths, flags, and `feat:`/`fix:` prefixes stay as written.
- Before you answer, tell me what you need to know to answer well, and point out any assumptions you'd otherwise make.
- When you need input from me (a question, a choice, a decision), use the `AskUserQuestion` tool, not plain chat text. Suggest options, mark the recommended one, and give each a short why/pros/cons. Keep it short: no drafts, templates, or long text in it; show those in chat.

## Repos
- `gh` GitHub, `glab` GitLab.
- Semantic commits: `feat:` `fix:` `chore:` `docs:` `refactor:` `test:`.
- Semver on PRs/releases.

## Code Quality
- Clean, optimal, readable > short. No redundant code.
- Meaningful names. Language best practices.

## Testing & CI/CD
- Pre-commit hooks; run tests before push.
- Minimal workflows, essential checks only.

## Docs
- Precise, essential only. Focused/actionable README. Flag breaking changes.

## Decisions
- Present options + trade-offs + implications. Ask before architectural choices.
