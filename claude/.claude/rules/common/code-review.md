# Code review

- Before you commit, run `/security-review` on the pending changes when the diff touches auth, secrets, input handling, templates, shell, or SQL, or when the change fixes a security issue.
- Severity: CRITICAL (security or data loss) blocks the merge. HIGH (bug) must be fixed before the merge. MEDIUM and LOW are optional.
- Do not leave debug output (`console.log`, `print`) in the code.
