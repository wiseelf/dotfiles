import { expect, mock, test } from 'claude-code/testing'

import type { Snapshot } from '../types'
import {
  countdown,
  dollars,
  fit,
  homeShort,
  nextMonthStart,
  pace,
  parseGit,
  parseShortstat,
  parseSpend,
  placeParts,
  tokens,
  usageParts,
  webUrl,
} from './register'

const NOW = Date.parse('2026-10-24T03:00:00Z')
const HOUR = 3600 * 1000

// `$.tool.call` for Bash through a loose type: the typed call makes tsc give up
// (TS2589) once the generated MCP typings of a session with many servers are laid.
function bash($: any, command: string): Promise<unknown> {
  return $.tool.call({ tool: 'Bash', command })
}

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  model: 'Opus 5.5',
  contextPercent: 60,
  contextTokens: 120_000,
  contextWindow: 200_000,
  fiveHour: { percent: 23, resetsAt: NOW + 2 * HOUR + 13 * 60_000 },
  sevenDay: { percent: 41, resetsAt: NOW + 3.5 * 24 * HOUR },
  spendLimit: null,
  costUsd: 0.5,
  cwd: '/Users/lex/.claude/mods',
  home: '/Users/lex',
  git: { root: 'mods', top: '/Users/lex/.claude/mods', branch: 'main', worktree: null, webUrl: 'https://github.com/lex/mods', added: 0, removed: 0 },
  at: NOW,
  ...over,
})

test('pace projects the weekly use at the reset and stays quiet in the first hour', () => {
  expect(pace({ percent: 41, resetsAt: NOW + 3.5 * 24 * HOUR }, NOW)).toBe(82)
  expect(pace({ percent: 10, resetsAt: NOW + 7 * 24 * HOUR - 30 * 60_000 }, NOW)).toBeNull()
  expect(pace({ percent: 10, resetsAt: null }, NOW)).toBeNull()
})

test('countdown, homeShort and parseGit read as the old widgets did', () => {
  expect(countdown(NOW + 2 * HOUR + 13 * 60_000, NOW)).toBe('2h13m')
  expect(countdown(NOW + 45 * 60_000, NOW)).toBe('45m')
  expect(countdown(NOW - 1000, NOW)).toBe('0m')
  expect(countdown(NOW + 5 * 24 * HOUR + 3 * HOUR + 10 * 60_000, NOW)).toBe('5d3h')
  expect(dollars(0.0722)).toBe('$0.07')
  expect(dollars(12.4)).toBe('$12.40')
  expect(dollars(123.6)).toBe('$124')
  expect(homeShort('/Users/lex/.claude/mods', '/Users/lex')).toBe('~/.claude/mods')
  expect(homeShort('/Users/lexa', '/Users/lex')).toBe('/Users/lexa')
  expect(parseGit('main\n/r/mods\n/r/mods/.git\n/r/mods/.git\n')).toEqual({ root: 'mods', top: '/r/mods', branch: 'main', worktree: null, webUrl: null, added: 0, removed: 0 })
  expect(parseGit('wt-b\n/r/h/.claude/worktrees/b\n/r/h/.git/worktrees/b\n/r/h/.git\n')).toEqual({
    root: 'b',
    top: '/r/h/.claude/worktrees/b',
    branch: 'wt-b',
    worktree: 'b',
    webUrl: null,
    added: 0,
    removed: 0,
  })
  expect(parseGit('')).toBeNull()
  expect(parseShortstat(' 3 files changed, 12 insertions(+), 1 deletion(-)\n')).toEqual({ added: 12, removed: 1 })
  expect(parseShortstat(' 1 file changed, 1 insertion(+)\n')).toEqual({ added: 1, removed: 0 })
  expect(parseShortstat('')).toEqual({ added: 0, removed: 0 })
  expect([tokens(850), tokens(45_400), tokens(1_000_000)]).toEqual(['850', '45k', '1.0M'])
})

test('the row parts hold each figure and drop the parts that do not fit', () => {
  expect(usageParts(snap(), 'pr').map(p => p.text)).toEqual([
    'Opus 5.5',
    'Ctx 120k/200k 60%',
    'Pace →82%',
    'Skill pr',
  ])
  const nearLimit = (percent: number) =>
    usageParts(snap({ fiveHour: { percent, resetsAt: NOW + 2 * HOUR + 13 * 60_000 } }), null).map(p => p.text)
  expect(nearLimit(90)).toEqual(['Opus 5.5', 'Ctx 120k/200k 60%', 'Pace →82%'])
  expect(nearLimit(91)).toEqual(['Opus 5.5', 'Ctx 120k/200k 60%', '5h 91%', 'Pace →82%', 'Reset 2h13m'])
  expect(usageParts(snap({ sevenDay: { percent: 70, resetsAt: NOW + 3.5 * 24 * HOUR } }), null).find(p => p.text.startsWith('Pace'))?.color).toBe('#cc0000')
  expect(usageParts(snap(), null, 'high').map(p => p.text).slice(0, 3)).toEqual(['Opus 5.5', 'Effort high', 'Ctx 120k/200k 60%'])
  expect(usageParts(snap({ contextTokens: null }), null).map(p => p.text)[1]).toBe('Ctx 60%')
  expect(usageParts(snap({ contextPercent: null, fiveHour: null, sevenDay: null, costUsd: 0 }), null).map(p => p.text)).toEqual(['Opus 5.5'])
  const wt = placeParts(snap({ git: { root: 'b', top: '/r/h/.claude/worktrees/b', branch: 'wt-b', worktree: 'b', webUrl: 'https://gitlab.tools.nmi.com/g/p', added: 12, removed: 3 } }))
  expect(wt).toEqual([
    { text: '~/.claude/mods' },
    { text: '\uf296', color: 'magenta', href: 'https://gitlab.tools.nmi.com/g/p' },
    { text: '⎇ wt-b', color: 'green', isJoined: true },
    { text: '+12 -3', color: 'yellow', isJoined: true },
    { text: '𖠰', color: 'blue', copy: '/r/h/.claude/worktrees/b', isJoined: true },
  ])
  expect(placeParts(snap()).map(p => p.text)).toEqual(['~/.claude/mods', '\uf09b', '⎇ main'])
  const local = placeParts(snap({ git: { root: 'x', top: '/x', branch: 'main', worktree: null, webUrl: null, added: 0, removed: 0 } }))
  expect(local[1]).toEqual({ text: '\ue702', color: 'magenta' })
  expect(fit(usageParts(snap(), null), 35).map(p => p.text)).toEqual(['Opus 5.5', 'Ctx 120k/200k 60%'])
  expect(fit([{ text: 'a very long model name' }], 5).map(p => p.text)).toEqual(['a very long model name'])
  // A joined part takes one column before it, not the separator's three.
  expect(fit([{ text: 'ab' }, { text: 'cd', isJoined: true }], 5).map(p => p.text)).toEqual(['ab', 'cd'])
  expect(fit([{ text: 'ab' }, { text: 'cd' }], 5).map(p => p.text)).toEqual(['ab'])
})

test('webUrl turns a git remote into the page a browser opens', () => {
  expect(webUrl('git@github.com:sirantd/claude-mods.git\n')).toBe('https://github.com/sirantd/claude-mods')
  expect(webUrl('ssh://git@gitlab.tools.nmi.com:2222/group/sub/proj.git')).toBe('https://gitlab.tools.nmi.com/group/sub/proj')
  expect(webUrl('https://lex@gitlab.com/g/p.git')).toBe('https://gitlab.com/g/p')
  expect(webUrl('https://github.com/o/r')).toBe('https://github.com/o/r')
  expect(webUrl('/srv/git/r.git')).toBeNull()
  expect(webUrl('file:///srv/git/r.git')).toBeNull()
})

test('a metered account shows the session cost and the monthly limit left in place of the windows', () => {
  const metered = (over: Partial<Snapshot> = {}) =>
    usageParts(snap({ fiveHour: null, sevenDay: null, costUsd: 1.237, ...over }), 'pr')
  const monthEnd = NOW + 5 * 24 * HOUR + 3 * HOUR
  expect(metered().map(p => p.text)).toEqual(['Opus 5.5', 'Ctx 120k/200k 60%', 'Session $1.24', 'Skill pr'])
  expect(metered({ spendLimit: { percent: 37, resetsAt: monthEnd, usedUsd: null, limitUsd: null } }).map(p => p.text)).toEqual([
    'Opus 5.5',
    'Ctx 120k/200k 60%',
    'Session $1.24',
    'Month 63% left',
    'Skill pr',
  ])
  const low = metered({ spendLimit: { percent: 85.5, resetsAt: monthEnd, usedUsd: null, limitUsd: null } })
  expect(low.map(p => p.text)).toEqual(['Opus 5.5', 'Ctx 120k/200k 60%', 'Session $1.24', 'Month 15% left', 'Reset 5d3h', 'Skill pr'])
  expect(low.find(p => p.text.startsWith('Month'))?.color).toBe('yellow')
  const over = metered({ spendLimit: { percent: 104, resetsAt: monthEnd, usedUsd: null, limitUsd: null } })
  expect(over.find(p => p.text.startsWith('Month'))).toEqual({ text: 'Month limit reached', color: '#cc0000' })
  const withDollars = metered({ spendLimit: { percent: 37, resetsAt: monthEnd, usedUsd: 296, limitUsd: 800 } })
  expect(withDollars.find(p => p.text.startsWith('Month'))?.text).toBe('Month $296/$800 63% left')
  // Before the first priced response neither plan shows a cost.
  expect(metered({ costUsd: 0 }).map(p => p.text)).toEqual(['Opus 5.5', 'Ctx 120k/200k 60%', 'Skill pr'])
  // A subscription never shows the cost.
  expect(usageParts(snap({ costUsd: 3 }), null).some(p => p.text.startsWith('Session'))).toBe(false)
})

test('parseSpend reads the usage endpoint the way /usage shows it', () => {
  const spend = { used: { amount_minor: 52041, exponent: 2 }, limit: { amount_minor: 80000, exponent: 2 }, enabled: true }
  const extra = { is_enabled: true, monthly_limit: 80000, used_credits: 52041 }
  const reset = nextMonthStart(NOW)
  expect(parseSpend(JSON.stringify({ spend, extra_usage: extra }), NOW)).toEqual({ percent: 65.1, resetsAt: reset, usedUsd: 520.41, limitUsd: 800 })
  expect(parseSpend(JSON.stringify({ spend: null, extra_usage: extra }), NOW)).toEqual({ percent: 65.1, resetsAt: reset, usedUsd: 520.41, limitUsd: 800 })
  expect(parseSpend(JSON.stringify({ spend: { ...spend, enabled: false } }), NOW)).toBeNull()
  expect(parseSpend(JSON.stringify({ five_hour: null }), NOW)).toBeNull()
  expect(parseSpend('<html>', NOW)).toBeNull()
  const d = new Date(reset)
  expect([d.getDate(), d.getHours(), d.getMonth()]).toEqual([1, 0, (new Date(NOW).getMonth() + 1) % 12])
})

test('after session start the hint site draws the row above the engine line', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/Users/lex' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.cwd', () => ({ value: '/Users/lex/.claude/mods' }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW - HOUR,
      context: { tokens: 120_000, window: 200_000, percent: 60 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 95, resetsAt: new Date(NOW + 2 * HOUR + 13 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(NOW + 3.5 * 24 * HOUR).toISOString() },
      ],
    },
  }))
  const ran: string[] = []
  on('process.run', (_$, e) => {
    ran.push(e.argv.join(' '))
    const stdout = e.argv.includes('config')
      ? 'git@github.com:lex/mods.git\n'
      : 'wt-b\n/Users/lex/.claude/mods/.claude/worktrees/b\n/Users/lex/.claude/mods/.git/worktrees/b\n/Users/lex/.claude/mods/.git\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const copied: string[] = []
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? e))
    return { value: undefined }
  })
  // Nothing else draws the hint line: this hook stands for the engine's own.
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>? for shortcuts</Text>
  })

  await $.session.start({ cwd: '/Users/lex/.claude/mods', surface: 'terminal', isInteractive: true })
  await clock.advance(300)

  const ui = await $.ui.mount({
    plugin: 'statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  expect((await ui.find({ type: 'Text', text: 'Opus 5.5' }))?.props.color).toBe('cyan')
  expect(await ui.find({ type: 'Text', text: 'Pace →82%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Reset 2h13m' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '~/.claude/mods' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '⎇ wt-b' }))?.props.color).toBe('green')
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://github.com/lex/mods')
  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
  expect(ran.filter(a => a.includes('rev-parse')).length).toBe(1)
  expect(ran.filter(a => a.includes('remote.origin.url')).length).toBe(1)

  await ui.press({ key: 'worktree' })
  await clock.advance(10)
  expect(copied).toEqual(['/Users/lex/.claude/mods/.claude/worktrees/b'])
  expect(toasts.some(t => t.includes('Copied /Users/lex/.claude/mods/.claude/worktrees/b'))).toBe(true)
  await ui.unmount()
})

test('git runs again only after a Bash call, a file edit or a cwd change, not on each tick', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/Users/lex' })
  let cwd = '/Users/lex/.claude/mods'
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] } }))
  let gitRuns = 0
  on('process.run', (_$, e) => {
    if (!e.argv.includes('rev-parse')) return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    gitRuns += 1
    const stdout = `main\n${cwd}\n${cwd}/.git\n${cwd}/.git\n`
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // The test's hook sits beneath the plugin and answers in place of Bash.
  on('tool.call', { tool: ['Bash', 'Edit'] }, () => ({ result: 'ran' }))

  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
  await clock.advance(400)
  expect(gitRuns).toBe(1)

  await clock.advance(30_400) // the tick at 30 s refreshes the figures from the cache
  expect(gitRuns).toBe(1)

  await bash($, 'git switch dev')
  await clock.advance(400)
  expect(gitRuns).toBe(2)

  await $.tool.call({ tool: 'Edit', file_path: `${cwd}/a.ts`, old_string: 'a', new_string: 'b' } as any)
  await clock.advance(400)
  expect(gitRuns).toBe(3)

  cwd = '/Users/lex/Projects/p'
  await clock.advance(30_000) // the tick sees the new cwd
  expect(gitRuns).toBe(4)
})

test('before the first refresh the hint site is the engine line alone', async ($, on) => {
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>? for shortcuts</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeUndefined()
  await ui.unmount()
})

test('on a metered account the hint site draws the cost and the limit left', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/Users/lex' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.cwd', () => ({ value: '/Users/lex/.claude/mods' }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW - HOUR,
      context: { tokens: 120_000, window: 200_000, percent: 60 },
      rateLimits: [],
      cost: { usd: 4.2 },
    },
  }))
  let fetches = 0
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  on('http.fetch', () => {
    fetches += 1
    const text = JSON.stringify({ spend: { used: { amount_minor: 29600 }, limit: { amount_minor: 80000 }, enabled: true } })
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>? for shortcuts</Text>
  })

  await $.session.start({ cwd: '/Users/lex/.claude/mods', surface: 'terminal', isInteractive: true })
  await clock.advance(300)
  await clock.advance(300) // the fetch landed and scheduled its own refresh

  const ui = await $.ui.mount({
    plugin: 'statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  expect(await ui.find({ type: 'Text', text: 'Session $4.20' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Month $296/$800 63% left' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Pace →82%' })).toBeUndefined()
  await ui.unmount()

  await clock.advance(60_000) // two ticks inside the 5-minute cache: no new fetch
  expect(fetches).toBe(1)
  await clock.advance(5 * 60_000)
  expect(fetches).toBe(2)
})

test('the row shows the effort of the main loop, not a subagent', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/Users/lex' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.cwd', () => ({ value: '/Users/lex' }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] } }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as any
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>? for shortcuts</Text>
  })
  const step = async (over: object) => {
    for await (const _ of ($ as any).turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 1, ...over }));
  }
  const isDrawn = async (text: string) => {
    const ui = await $.ui.mount({
      plugin: 'statusline',
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    const found = await ui.find({ type: 'Text', text })
    await ui.unmount()
    return found !== undefined
  }

  await $.session.start({ cwd: '/Users/lex', surface: 'terminal', isInteractive: true })
  await clock.advance(300)

  await step({ effort: 'high' })
  expect(await isDrawn('Effort high')).toBe(true)
  await step({ effort: 'low', agentId: 'a1' })
  expect(await isDrawn('Effort high')).toBe(true)
  await step({})
  expect(await isDrawn('Effort high')).toBe(false)
  expect(await isDrawn('Opus 5.5')).toBe(true)
})
