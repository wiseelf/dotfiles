import { describe, expect, test } from 'claude-code/testing'
import { findSecret } from '../hooks/register'

// Fake values, built from parts so that this file does not hold a token shape.
const fake = {
  gitlab: 'glpat-' + 'A'.repeat(20),
  github: 'ghp_' + 'a1'.repeat(18),
  slack: 'xoxb-' + '1234567890-abc',
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  anthropic: 'sk-ant-' + 'x'.repeat(24),
  privateKey: '-----BEGIN RSA ' + 'PRIVATE KEY-----',
}

describe('findSecret', () => {
  test('names each token shape and never returns the value', () => {
    expect(findSecret(`use ${fake.gitlab} here`)).toBe('GitLab token')
    expect(findSecret(fake.github)).toBe('GitHub token')
    expect(findSecret(fake.slack)).toBe('Slack token')
    expect(findSecret(`key=${fake.aws}`)).toBe('AWS access key')
    expect(findSecret(fake.anthropic)).toBe('Anthropic key')
    expect(findSecret(fake.privateKey)).toBe('private key')
  })

  test('passes normal prompts, commit SHAs and bare 32-character IDs', () => {
    expect(findSecret('merged, cleanup')).toBe(null)
    expect(findSecret('commit 4b044aa1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7')).toBe(null)
    expect(findSecret('abcdefghijklmnopqrstuvwxyzABCDEF')).toBe(null)
    expect(findSecret('read the token from ~/.config/bugsnag.token')).toBe(null)
  })
})

// A prompt typed at the terminal, as the engine raises it.
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const notice = (text: string) => ({ text, wait: false, origin: { kind: 'task-notification' as const } })

describe('prompt.submit', () => {
  test('drops a prompt with a token, with the shape name as the reason', async ($, on) => {
    on('prompt.submit', (_, e) => ({ text: e.text }))

    const result = await $.prompt.submit(typed(`deploy with ${fake.gitlab}`))

    expect(result.drop).toContain('GitLab token')
    expect(result.drop).not.toContain(fake.gitlab)
  })

  test('lets a background notice with a token shape enter, so the report is not lost', async ($, on) => {
    on('prompt.submit', (_, e) => ({ text: e.text }))

    const result = await $.prompt.submit(notice(`finding: ${fake.gitlab}`))

    expect(result.drop).toBe(undefined)
  })

  test('lets a normal prompt enter unchanged', async ($, on) => {
    on('prompt.submit', (_, e) => ({ text: e.text }))

    const result = await $.prompt.submit(typed('check pipeline'))

    expect(result.drop).toBe(undefined)
    expect(result.text).toBe('check pipeline')
  })
})
