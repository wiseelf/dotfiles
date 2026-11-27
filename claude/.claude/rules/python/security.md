---
paths:
  - "**/*.py"
  - "**/*.pyi"
---
# Python Security

> This file extends [common/security.md](../common/security.md) with Python specific content.

## Security Scanning

- Use **bandit** for static security analysis:
  ```bash
  bandit -r src/
  ```
