import type { Register } from 'claude-code'

// Only prefix-anchored shapes. A bare 32-character match (for example a Fastly token) also matches commit SHAs and IDs.
export const SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'GitLab token', pattern: /glpat-[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/ },
  { name: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/ },
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

/** The name of the first token shape in the text, or null. Never returns the value. */
export function findSecret(text: string): string | null {
  return SECRET_PATTERNS.find(({ pattern }) => pattern.test(text))?.name ?? null
}

// Only the person's own prompts. A background notice or a peer message can quote a token shape, and dropping it loses the report.
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

export const register: Register = on => {
  on('prompt.submit', ($, e, next) => {
    const found = USER_ORIGINS.has(e.origin.kind) ? findSecret(e.text) : null
    if (found === null) {
      return next(e)
    }
    return {
      drop: `${$.plugin.name}: the prompt contains a ${found}. Put the token in a file, refer to the file path, and rotate the token.`,
    }
  }).catch(($, e, next) =>
    next.called ? next(e) : { drop: `${$.plugin.name}: the guard failed, so the prompt was not sent.` },
  )
}
