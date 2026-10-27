// statusline: the ccstatusline figures in two rows, drawn in-process on the PromptHint site.
// The first row holds the usage figures, the second the skill and the place.
// A subscription (5-hour and weekly windows) shows the 5-hour use and the weekly
// pace; a metered account (enterprise, no such windows) shows the session's cost
// and what is left of the monthly spend limit instead. The engine reports no such
// limit for a claude.ai login, so it is read from the endpoint /usage reads, at
// most once per SPEND_TTL_MS, and only while the windows are absent.
//   ui.render (PromptHint)            the two rows, then the engine's own hint line
//   session.start, turn.step,         refresh the snapshot, at most once per
//   tool.call, $.clock.every          SETTLE_MS, and every TICK_MS for the clocks
//   turn.step                         also the effort of the main loop's last request
// No session.append hook: a security plugin above it continues past it.
// The figures come from $.session and start no process. Only the branch, the
// worktree and the diff need git: one read when the directory changes, and again
// after a Bash call or a file edit, which can change them.
import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, Timer } from 'claude-code'

import type { GitInfo, Snapshot, Spend, Window } from '../types'

type Engine = EngineInterface

/**
 * One piece of a row: its words and, if any, its color; `href` draws it as a link,
 * `copy` as a button that puts that text on the clipboard; `isJoined` follows the
 * part before after a space, not the separator.
 */
export type Part = { text: string; color?: Color; href?: string; copy?: string; isJoined?: boolean }

const WEEK_MS = 7 * 24 * 3600 * 1000
const MIN_ELAPSED_MS = 3600 * 1000 // the first hour after a reset: too little data for a pace
const SETTLE_MS = 300
const TICK_MS = 30_000
const SEPARATOR = ' | '
const JOINER = ' '
const PACE_COLORS = { under: '#4e9a06', over: '#cc0000', even: '#888a85' } as const
// Nerd Font glyphs: the repository's host, a link to it in the browser.
const GIT_ICONS = { github: '\uf09b', gitlab: '\uf296', other: '\ue702' } as const
const WORKTREE_ICON = '𖠰'
const FIVE_HOUR_MIN_PERCENT = 90 // the 5-hour use and its reset show only above this use
const SPEND_RESET_MAX_LEFT = 20 // the spend limit's reset shows only at or below this much left
const SPEND_TTL_MS = 5 * 60_000
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CENTS_EXPONENT = 2 // the usage endpoint's default minor unit
// Tools whose calls can change the branch or the diff: git is read again after them.
const GIT_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']

const snapshot = atom({ plugin: 'statusline', key: 'snapshot' } as const, null)
const lastSkill = atom({ plugin: 'statusline', key: 'skill' } as const, null)
const lastEffort = atom({ plugin: 'statusline', key: 'effort' } as const, null)

// Module state: a reload starts these over, and the next refresh fills them.
let ticker: Timer | null = null
let settle: Timer | null = null
let isRefreshing = false
let gitCache: { cwd: string; info: GitInfo | null } | null = null
let isGitStale = false // a Bash call or a file edit ran since the last git read began
let spendCache: { at: number; window: Spend | null } | null = null
let isFetchingSpend = false

/** The projected weekly use at the reset, in percent; null in the first hour of the window. */
export function pace(window: Window, now: number): number | null {
  if (window.resetsAt === null) return null
  const elapsed = Math.max(0, Math.min(WEEK_MS, WEEK_MS - (window.resetsAt - now)))
  if (elapsed < MIN_ELAPSED_MS) return null
  return Math.round((window.percent * WEEK_MS) / elapsed)
}

/** `5d3h`, `2h13m`, `45m`, or `0m` for a reset that is due. */
export function countdown(resetsAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000))
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)}d${hours % 24}h`
  return hours > 0 ? `${hours}h${minutes % 60}m` : `${minutes}m`
}

/** `$0.07`, `$12.40`, or `$123` from 100 dollars up. */
export function dollars(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

/** `850`, `45k`, or `1.2M` tokens. */
export function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}

/** `Ctx 120k/200k 60%`, or `Ctx 60%` before the engine reports the tokens. */
function contextText(s: Snapshot): string {
  const fill = s.contextTokens === null ? '' : `${tokens(s.contextTokens)}/${tokens(s.contextWindow)} `
  return `Ctx ${fill}${s.contextPercent}%`
}

/** Whether the snapshot is a subscription's: it has a 5-hour or a weekly window. */
export function isSubscription(s: Snapshot): boolean {
  return s.fiveHour !== null || s.sevenDay !== null
}

/** The cwd with the home folder written as `~`. */
export function homeShort(cwd: string, home: string): string {
  if (!home) return cwd
  if (cwd === home) return '~'
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd
}

/** The usage parts of the first row: model, effort, context, and the plan's own figures. */
export function usageParts(s: Snapshot, effort: string | null = null): Part[] {
  const parts: Part[] = [{ text: s.model, color: 'cyan' }]
  if (effort) parts.push({ text: `Effort ${effort}`, color: 'cyan' })
  if (s.contextPercent !== null) parts.push({ text: contextText(s) })
  parts.push(...(isSubscription(s) ? subscriptionParts(s) : meteredParts(s)))
  return parts
}

/** A subscription's parts: the 5-hour use and reset near the limit, and the weekly pace. */
function subscriptionParts(s: Snapshot): Part[] {
  const parts: Part[] = []
  const fiveHour = s.fiveHour && s.fiveHour.percent > FIVE_HOUR_MIN_PERCENT ? s.fiveHour : null
  const projected = s.sevenDay ? pace(s.sevenDay, s.at) : null
  if (fiveHour) parts.push({ text: `5h ${fiveHour.percent}%`, color: 'yellow' })
  if (projected !== null) {
    const color = projected === 100 ? PACE_COLORS.even : projected > 100 ? PACE_COLORS.over : PACE_COLORS.under
    parts.push({ text: `Pace →${projected}%`, color })
  }
  if (fiveHour?.resetsAt != null) parts.push({ text: `Reset ${countdown(fiveHour.resetsAt, s.at)}` })
  return parts
}

/**
 * A metered account's parts: the session's cost and what is left of the monthly
 * spend limit, with its reset when little is left. The cost waits for the first
 * priced response, so a subscription's row never shows it before its windows arrive.
 */
function meteredParts(s: Snapshot): Part[] {
  const parts: Part[] = []
  if (s.costUsd !== null && (s.costUsd > 0 || s.spendLimit)) parts.push({ text: `Session ${dollars(s.costUsd)}` })
  if (s.spendLimit) {
    const left = Math.max(0, Math.round(100 - s.spendLimit.percent))
    if (s.spendLimit.percent >= 100) parts.push({ text: 'Month limit reached', color: PACE_COLORS.over })
    else parts.push({ text: monthText(s.spendLimit, left), color: left <= SPEND_RESET_MAX_LEFT ? 'yellow' : PACE_COLORS.under })
    if (left <= SPEND_RESET_MAX_LEFT && s.spendLimit.resetsAt !== null)
      parts.push({ text: `Reset ${countdown(s.spendLimit.resetsAt, s.at)}` })
  }
  return parts
}

/** `Month $296/$800 63% left`, or `Month 63% left` when the limit has no dollar figures. */
function monthText(spend: Spend, left: number): string {
  const money = spend.usedUsd !== null && spend.limitUsd !== null ? `${dollars(spend.usedUsd)}/${dollars(spend.limitUsd)} ` : ''
  return `Month ${money}${left}% left`
}

/** The parts of the second row: the last skill, the directory, the repository's host, the branch, the diff and the worktree. */
export function placeParts(s: Snapshot, skill: string | null = null): Part[] {
  const parts: Part[] = skill ? [{ text: `Skill ${skill}` }] : []
  parts.push({ text: homeShort(s.cwd, s.home) })
  if (s.git) {
    const host = s.git.webUrl ? new URL(s.git.webUrl).hostname : ''
    const icon = host.includes('github') ? GIT_ICONS.github : host.includes('gitlab') ? GIT_ICONS.gitlab : GIT_ICONS.other
    parts.push({ text: icon, color: 'magenta', ...(s.git.webUrl ? { href: s.git.webUrl } : {}) })
    // The icons sit beside the branch: one group, no separators inside it.
    parts.push({ text: `⎇ ${s.git.branch}`, color: 'green', isJoined: true })
    if (s.git.added + s.git.removed > 0)
      parts.push({ text: `+${s.git.added} -${s.git.removed}`, color: 'yellow', isJoined: true })
    if (s.git.worktree) parts.push({ text: WORKTREE_ICON, color: 'blue', copy: s.git.top, isJoined: true })
  }
  return parts
}

/**
 * The browser URL of a git remote: `git@host:o/r.git`, `ssh://git@host:2222/o/r.git`
 * and `https://user@host/o/r.git` all read `https://host/o/r`; null for a path or file remote.
 */
export function webUrl(remote: string): string | null {
  const url = remote.trim()
  const scp = /^[\w.-]+@([^:/]+):(?!\/)(.+)$/.exec(url)
  let host: string
  let path: string
  if (scp) {
    host = scp[1]!
    path = scp[2]!
  } else {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (!['ssh:', 'git:', 'http:', 'https:', 'git+ssh:'].includes(parsed.protocol)) return null
    host = parsed.hostname
    path = parsed.pathname
  }
  path = path.replace(/^\/+/, '').replace(/\.git\/?$/, '').replace(/\/+$/, '')
  return host && path ? `https://${host}/${path}` : null
}

/** The parts that fit in `columns` with their separators; the first part always stays. */
export function fit(parts: Part[], columns: number): Part[] {
  const kept: Part[] = []
  let used = 0
  for (const part of parts) {
    const gap = kept.length === 0 ? '' : part.isJoined ? JOINER : SEPARATOR
    const width = gap.length + [...part.text].length
    if (kept.length > 0 && used + width > columns) break
    kept.push(part)
    used += width
  }
  return kept
}

/** Reads `git rev-parse` for `cwd`: null outside a repository or when git fails. */
export function parseGit(stdout: string): GitInfo | null {
  const [branch, top, gitDir, commonDir] = stdout.trim().split('\n')
  if (!branch || !top || !gitDir || !commonDir) return null
  const worktree = gitDir === commonDir ? null : (gitDir.split('/').pop() ?? null)
  return { root: top.split('/').pop() ?? top, top, branch, worktree, webUrl: null, added: 0, removed: 0 }
}

/** Reads `git diff --shortstat`: ` 3 files changed, 12 insertions(+), 1 deletion(-)`. */
export function parseShortstat(stdout: string): { added: number; removed: number } {
  const count = (pattern: RegExp) => Number(pattern.exec(stdout)?.[1] ?? 0)
  return { added: count(/(\d+) insertions?\(\+\)/), removed: count(/(\d+) deletions?\(-\)/) }
}

/** The first moment of the month after `now`, in the local time zone: when a monthly limit resets. */
export function nextMonthStart(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
}

type Money = { amount_minor?: unknown; exponent?: unknown }

/**
 * Reads the monthly spend limit from the usage endpoint's answer: `spend`, or the
 * older `extra_usage` in cents. Null when the account has no limit or the shape is new.
 */
export function parseSpend(text: string, now: number): Spend | null {
  let body: {
    spend?: { used?: Money; limit?: Money; enabled?: unknown } | null
    extra_usage?: { is_enabled?: unknown; monthly_limit?: unknown; used_credits?: unknown } | null
  }
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  const minor = (m: Money | undefined) => (typeof m?.amount_minor === 'number' ? m.amount_minor : null)
  let used: number | null = null
  let limit: number | null = null
  let exponent = CENTS_EXPONENT
  if (body.spend && body.spend.enabled !== false) {
    used = minor(body.spend.used)
    limit = minor(body.spend.limit)
    const given = body.spend.limit?.exponent
    if (typeof given === 'number') exponent = given
  } else if (body.extra_usage && body.extra_usage.is_enabled !== false) {
    const { used_credits, monthly_limit } = body.extra_usage
    used = typeof used_credits === 'number' ? used_credits : null
    limit = typeof monthly_limit === 'number' ? monthly_limit : null
  }
  if (used === null || limit === null || limit <= 0) return null
  const unit = 10 ** exponent
  return {
    percent: Math.round((used * 1000) / limit) / 10,
    resetsAt: nextMonthStart(now),
    usedUsd: used / unit,
    limitUsd: limit / unit,
  }
}

/**
 * Fetches the spend limit in the background when the cached one is older than
 * SPEND_TTL_MS, then refreshes the row. A failure keeps the last figure until the
 * next try; never throws.
 */
function fetchSpend($: Engine, now: number): void {
  if (isFetchingSpend || (spendCache && now - spendCache.at < SPEND_TTL_MS)) return
  isFetchingSpend = true
  void (async () => {
    let window = spendCache?.window ?? null
    try {
      const auth = await $.session.authorize()
      if (auth) {
        const r = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
        if (r.ok) window = parseSpend(r.text, now)
      }
    } catch {
      // offline or refused: the row keeps the last figure
    }
    spendCache = { at: now, window }
    isFetchingSpend = false
    schedule($)
  })()
}

async function readGit($: Engine, cwd: string): Promise<GitInfo | null> {
  if (gitCache && gitCache.cwd === cwd && !isGitStale) return gitCache.info
  // Cleared before git starts: a Bash call during the run sets it again, and
  // the next refresh reads git again.
  isGitStale = false
  let info: GitInfo | null = null
  try {
    const [r, remote, diff] = await Promise.all([
      $.process.run(
        ['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD', '--show-toplevel', '--path-format=absolute', '--git-dir', '--git-common-dir'],
        { timeoutMs: 2000 },
      ),
      $.process.run(['git', '-C', cwd, 'config', '--get', 'remote.origin.url'], { timeoutMs: 2000 }).catch(() => null),
      $.process.run(['git', '-C', cwd, 'diff', '--shortstat', 'HEAD'], { timeoutMs: 2000 }).catch(() => null),
    ])
    info = r.exitCode === 0 ? parseGit(r.stdout) : null
    if (info && remote?.exitCode === 0) info = { ...info, webUrl: webUrl(remote.stdout) }
    if (info && diff?.exitCode === 0) info = { ...info, ...parseShortstat(diff.stdout) }
  } catch {
    // git is missing or timed out: the row shows the directory alone.
  }
  gitCache = { cwd, info }
  return info
}

function windowOf(limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[], kind: string): Window | null {
  const found = limits.find(w => w.kind === kind)
  if (!found) return null
  const resetsAt = found.resetsAt ? Date.parse(found.resetsAt) : NaN
  return { percent: found.percentUsed, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null }
}

async function refresh($: Engine): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  try {
    const [model, usage, cwd, home, now] = await Promise.all([
      $.session.model(),
      $.session.usage(),
      $.session.cwd(),
      $.env.get('HOME'),
      $.clock.now(),
    ])
    const git = await readGit($, cwd)
    const fiveHour = windowOf(usage.rateLimits, 'five_hour')
    const sevenDay = windowOf(usage.rateLimits, 'seven_day')
    const gatewayLimit = windowOf(usage.rateLimits, 'spend_limit')
    let spendLimit: Spend | null = gatewayLimit && { ...gatewayLimit, usedUsd: null, limitUsd: null }
    // Only a metered account that has answered once: before the first response
    // a subscription has no windows either.
    if (!fiveHour && !sevenDay && !spendLimit && (usage.cost?.usd ?? 0) > 0) {
      fetchSpend($, now)
      spendLimit = spendCache?.window ?? null
    }
    const next: Snapshot = {
      model,
      contextPercent: usage.context.percent ?? null,
      contextTokens: usage.context.tokens ?? null,
      contextWindow: usage.context.window,
      fiveHour,
      sevenDay,
      spendLimit,
      costUsd: usage.cost?.usd ?? null,
      cwd,
      home: home ?? '',
      git,
      at: now,
    }
    await update($, snapshot, () => next)
  } finally {
    isRefreshing = false
  }
}

/**
 * Refreshes once, SETTLE_MS after the first event of a burst. Never throws:
 * the hooks call it after `next(e)`, where a throw would fail a tool call or
 * a model response that already ran.
 */
function schedule($: Engine): void {
  if (settle) return
  try {
    settle = $.clock.after(SETTLE_MS, () => {
      settle = null
      void refresh($).catch(() => {})
    })
  } catch {
    settle = null
  }
}

function stop(): void {
  ticker?.cancel()
  settle?.cancel()
  ticker = null
  settle = null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    stop()
    ticker = $.clock.every(TICK_MS, () => schedule($))
    schedule($)
    return result
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const name = String((e as { skill?: unknown }).skill ?? '')
    try {
      if (name) await update($, lastSkill, () => name)
    } catch {
      // the row keeps the skill before
    }
    return next(e)
  })

  on('tool.call', { tool: GIT_TOOLS }, async ($, e, next) => {
    const result = await next(e)
    isGitStale = true // a checkout, a cd or an edit can change the branch or the diff
    schedule($)
    return result
  })

  // Only the main loop's requests: a subagent can run at another effort.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? null : String(e.effort)
      try {
        await update($, lastEffort, () => effort)
      } catch {
        // the row keeps the effort before
      }
    }
    try {
      return yield* next(e)
    } finally {
      schedule($) // after each model response the usage figures are new
    }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const engine = await next(e)
    const s = await read($, snapshot)
    if (s === null) return engine
    const [skill, effort] = await Promise.all([read($, lastSkill), read($, lastEffort)])
    const { Box, Text, Link, Button } = $.ui.resolve(e)
    const columns = Math.max(20, e.viewport?.columns ?? 120)
    const rows = [usageParts(s, effort), placeParts(s, skill)].map(parts => fit(parts, columns))
    const drawPart = (part: Part, i: number) => {
      const copy = part.copy
      if (copy !== undefined)
        return (
          <Button
            key="worktree"
            plain
            onPress={press => {
              void $.ui
                .copy({ text: copy, surface: press.surface })
                .then(r => $.ui.toast(r.isCopied ? `Copied ${copy}` : `Copy failed: ${r.reason}`))
                .catch(() => {})
            }}
          >
            <Text color={part.color}>{part.text}</Text>
          </Button>
        )
      return (
        <Text key={`part-${i}`} color={part.color} wrap="truncate">
          {part.href ? <Link href={part.href}>{part.text}</Link> : part.text}
        </Text>
      )
    }
    return (
      <Box flexDirection="column">
        {rows.map((parts, row) => (
          <Box key={`row-${row}`} flexDirection="row">
            {parts.flatMap((part, i) => [
              ...(i > 0 ? [<Text key={`sep-${i}`} dimColor>{part.isJoined ? JOINER : SEPARATOR}</Text>] : []),
              drawPart(part, i),
            ])}
          </Box>
        ))}
        {engine}
      </Box>
    )
  })

  on('session.end', async ($, e, next) => {
    stop()
    return next(e)
  })
}
