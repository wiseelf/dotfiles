import { describe, expect, test } from 'claude-code/testing'
import { analyze, hasLongReplSleep, refspecTarget, splitCommands } from '../hooks/register'

const findings = (command: string) => analyze(command).findings

describe('splitCommands', () => {
  test('drops heredoc bodies and comments, and keeps quoted words whole', () => {
    const text = "cat > f <<'EOF'\nsleep 10\nsed -i x f\nEOF\necho ok # sleep 9\ngit commit -m 'a; sleep 10'"
    expect(splitCommands(text)).toEqual([['cat', '>', 'f'], ['echo', 'ok'], ['git', 'commit', '-m', 'a; sleep 10']])
  })
})

describe('sleep', () => {
  test('denies a sleep that starts the line, a long sleep, and a sleep with an unknown value', () => {
    for (const command of ['sleep 2', 'sleep 30 && gh pr view', 'cd x && sleep 10', 'until curl -sf u; do sleep 10; done', 'x; sleep "$D"', "bash -c 'sleep 3'", 'timeout 60 sleep 2', 'x && sleep 1m']) {
      expect([command, findings(command)]).toEqual([command, ['sleep']])
    }
  })

  test('allows a short backoff in a retry loop, and the word sleep as text', () => {
    for (const command of ['for i in 1 2 3; do curl -sf u && break; sleep 2; done', "rg 'sleep 10' src", 'echo sleep 10', 'git log --grep sleep']) {
      expect([command, findings(command)]).toEqual([command, []])
    }
  })
})

describe('edit in place', () => {
  test('denies sed -i, sed -I, perl -i in each form', () => {
    const denied = [
      "sed -i '' 's/a/b/' f",
      "sed -i.bak 's/a/b/' f",
      "sed -Ei 's/a/b/' f",
      "sed 's/a/b/' -i f",
      "gsed --in-place 's/a/b/' f",
      "sed -I '' 's/a/b/' f",
      "/usr/bin/sed -i 's/a/b/' f",
      "perl -pi -e 's/a/b/' f",
      "perl -i.bak -pe 's/a/b/' f",
      "find . -name '*.tf' -exec sed -i 's/a/b/' {} \\;",
      "rg -l x | xargs sed -i 's/a/b/'",
      "sudo sed -i 's/a/b/' f",
      "FOO=1 sed -i 's/a/b/' f",
    ]
    for (const command of denied) {
      expect([command, findings(command)]).toEqual([command, ['edit-in-place']])
    }
  })

  test('allows sed and perl that do not edit in place', () => {
    for (const command of ["sed -n '1,5p' f", "sed -e 's/-i//' f", "sed 's/a/b/' f > g", "perl -ne 'print if /-i/' f", "echo sed -i", "git commit -m 'no sed -i'"]) {
      expect([command, findings(command)]).toEqual([command, []])
    }
  })
})

describe('refspecTarget', () => {
  test('finds the written branch', () => {
    expect(refspecTarget('main', 'feat/x')).toBe('main')
    expect(refspecTarget('+feat/x:main', 'feat/x')).toBe('main')
    expect(refspecTarget(':main', 'feat/x')).toBe('main')
    expect(refspecTarget('HEAD', 'main')).toBe('main')
    expect(refspecTarget('HEAD:refs/heads/feat/y', 'main')).toBe('feat/y')
    expect(refspecTarget('refs/heads/*:refs/heads/*', 'main')).toBe(null)
  })
})

type Repo = { hasOrigin?: boolean; defaultHead?: string | null; current?: string | null; push?: string | null }

/** Registers a fake repo beneath the mod. `run` sends a Bash command through the mod and returns its result and the argv of each process. */
function fakeRepo($: any, on: any) {
  let repo: Repo = {}
  let calls: string[][] = []
  const answer = (args: string): string | null => {
    const answers: Record<string, string | null> = {
      'remote get-url origin': repo.hasOrigin === false ? null : 'git@example.com:me/repo.git',
      'symbolic-ref --short refs/remotes/origin/HEAD': repo.defaultHead === undefined ? 'origin/main' : repo.defaultHead,
      'symbolic-ref --short -q HEAD': repo.current === undefined ? 'feat/x' : repo.current,
      'rev-parse --abbrev-ref @{push}': repo.push === undefined ? 'origin/feat/x' : repo.push,
    }
    return answers[args] ?? null
  }
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    calls.push(e.argv)
    const value = e.argv[0] === 'printenv' ? '/home/me' : answer(e.argv.slice(3).join(' '))
    return { value: { exitCode: value === null ? 1 : 0, stdout: value ?? '', stderr: '' } }
  })
  on('tool.call', () => ({ result: 'ran' }))
  return async (command: string, next: Repo = {}) => {
    repo = next
    calls = []
    const result = await $.tool.call({ tool: 'Bash', command })
    return { result, calls }
  }
}

describe('git commit', () => {
  test('denies a commit on the default branch', async ($, on) => {
    const run = fakeRepo($, on)
    const { result } = await run("git commit -m 'x'", { current: 'main' })
    expect(result.deny).toContain('do not commit on the default branch "main" of /repo')
  })

  test('allows a commit on a feature branch, and in a repo with no origin', async ($, on) => {
    const run = fakeRepo($, on)
    expect((await run("git commit -m 'x'")).result).toEqual({ result: 'ran' })
  })

  test('allows a commit when the repo has no origin', async ($, on) => {
    const run = fakeRepo($, on)
    expect((await run("git commit -m 'x'", { hasOrigin: false, current: 'main' })).result).toEqual({ result: 'ran' })
  })

  test('reads the repo from -C and cd', async ($, on) => {
    const run = fakeRepo($, on)
    const { calls } = await run('cd sub && git -C ../other commit -m x')
    expect(calls[0]?.slice(0, 3)).toEqual(['git', '-C', '/repo/sub/../other'])
  })

  test('expands ~ and denies a directory with a variable', async ($, on) => {
    const run = fakeRepo($, on)
    const { calls } = await run('git -C ~/r commit -m x')
    expect(calls.find(c => c[0] === 'git')?.[2]).toBe('/home/me/r')
    const { result } = await run('git -C "$W" commit -m x')
    expect(result.deny).toContain('its directory holds a variable')
  })
})

describe('git push', () => {
  test('denies each form that writes the default branch', async ($, on) => {
    const run = fakeRepo($, on)
    const denied: [string, Repo][] = [
      ['git push', { push: 'origin/main' }],
      ['git push', { push: null, current: 'main' }],
      ['git push origin main', {}],
      ['git push origin HEAD', { current: 'main' }],
      ['git push -f origin +feat/x:main', {}],
      ['git push --all', {}],
      ['git push --mirror origin', {}],
      ['git push origin --delete main', {}],
      ["git push origin 'refs/heads/*:refs/heads/*'", {}],
    ]
    for (const [command, repo] of denied) {
      const { result } = await run(command, repo)
      expect([command, String(result.deny)]).toEqual([command, expect.stringContaining('do not push to the default branch')])
    }
  })

  test('allows a push of a feature branch or tags', async ($, on) => {
    const run = fakeRepo($, on)
    for (const command of ['git push', 'git push -u origin feat/x', 'git push origin HEAD', 'git push --tags', 'git push origin v1.2.0']) {
      const { result } = await run(command)
      expect([command, result]).toEqual([command, { result: 'ran' }])
    }
  })
})

describe('guard', () => {
  test('passes a command with no guarded word without a git call', async ($, on) => {
    const run = fakeRepo($, on)
    const { result, calls } = await run('gh pr merge 3 --squash')
    expect(result).toEqual({ result: 'ran' })
    expect(calls).toEqual([])
  })

  test('denies when the guard fails', async ($, on) => {
    on('session.cwd', () => ({ value: '/repo' }))
    on('process.run', () => {
      throw new Error('spawn failed')
    })
    on('tool.call', () => ({ result: 'ran' }))
    const result = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(result.deny).toContain('the guard failed')
  })
})

describe('REPL sleep', () => {
  test('denies a long sleep(), a computed value, and an unknown value', () => {
    const denied = [
      'await sleep(6000)',
      'await sleep (60_000)',
      'await sleep(60 * 1000)',
      'await sleep(ms)',
      'await sleep(Math.min(1000, wait))',
      'const x = `${await sleep(9000)}`',
      "await sleep(2000)\nawait sleep(30000)",
    ]
    for (const code of denied) {
      expect([code, hasLongReplSleep(code)]).toEqual([code, true])
    }
  })

  test('allows a short sleep(), and sleep( in strings, comments and template text', () => {
    const allowed = [
      'for (let i = 0; i < 3; i += 1) { if (await ok()) break; await sleep(2000) }',
      'await sleep(5_000)',
      "const s = 'sleep(60000)'",
      'const s = "sleep(60000)"',
      '// await sleep(60000)',
      '/* await sleep(60000) */',
      'await $`sleep 10`',
      'const t = `text sleep(9000) ${x} more sleep(9000)`',
      'time.sleep(60)',
    ]
    for (const code of allowed) {
      expect([code, hasLongReplSleep(code)]).toEqual([code, false])
    }
  })

  test('denies a REPL script with a long sleep() and runs a short one', async ($, on) => {
    on('tool.call', () => ({ result: 'ran' }))
    const denied = await $.tool.call({ tool: 'REPL', code: 'await sleep(60000)' })
    expect(String(denied.deny)).toContain('do not use sleep() in the REPL')
    expect(await $.tool.call({ tool: 'REPL', code: 'await sleep(2000)' })).toEqual({ result: 'ran' })
  })
})
