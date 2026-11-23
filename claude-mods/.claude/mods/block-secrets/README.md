# block-secrets

A `prompt.submit` hook. It drops a prompt from the person (typed, Remote Control, or `claude -p`) that contains a known token shape, before the prompt enters the session. The reason names the token shape. It never shows the value.

Shapes: GitLab, GitHub, Slack, AWS access key, Anthropic, OpenAI, private key. Only prefix-anchored shapes are in the list, because a bare 32-character match also matches commit SHAs.

If the hook fails, the `.catch` drops the prompt (fail-closed).

The prompt can still be in `~/.claude/history.jsonl`. Rotate a token that you pasted.

## Add a shape

Add an entry to `SECRET_PATTERNS` in `hooks/register.ts`, and add a test to `tests/block-secrets.test.ts`. Build the fake value from parts, so that the test file holds no token shape.

## Check

```bash
claude plugin validate .
claude plugin test .
```
