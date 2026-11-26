import type { EngineInterface, Register } from 'claude-code'

// Rule Guard: denies a Bash command that breaks a setup rule, with the fix in the reason.
//
// The host reads `on(...)` and `$.noun.method(...)` from source, so they are
// spelled literally, and helpers that take `$` are top-level functions.

const MAX_SLEEP_SECONDS = 5
const MAX_NESTING = 3
const GIT_TIMEOUT_MS = 5000
// A command without one of these words skips the parser, so a parser bug can only affect these commands.
const GUARDED_WORD = /\b(?:git|sed|gsed|perl|sleep)\b/

const REASONS = {
  sleep:
    'do not use sleep to wait for an event. Use a watch command (gh pr checks --watch, kubectl wait), a background task with .timeout(), or Monitor. A sleep of 5 s or less inside a retry loop is allowed.',
  'edit-in-place':
    'do not edit files in place with sed -i or perl -i. Read the file, then use the Edit tool.',
} as const

export type Finding = keyof typeof REASONS
export type GitCall = { kind: 'commit' | 'push'; args: string[]; dirs: string[] }
export type Analysis = { findings: Finding[]; git: GitCall[] }

// ---- Lexer: split a command line into simple commands (word lists) ----

type Heredoc = { delimiter: string; isIndented: boolean }
type Lexer = { text: string; i: number; out: string[][]; words: string[]; word: string | null; heredocs: Heredoc[] }

const SEPARATORS = new Set([';', '&', '|', '(', ')', '`', '\n'])

/** The simple commands of a line, quotes removed. Heredoc bodies and comments are dropped. */
export function splitCommands(text: string): string[][] {
  const lx: Lexer = { text, i: 0, out: [], words: [], word: null, heredocs: [] }
  while (lx.i < text.length) {
    step(lx)
  }
  endCommand(lx)
  return lx.out
}

function step(lx: Lexer): void {
  const c = lx.text[lx.i] ?? ''
  if (c === "'") return readSingleQuoted(lx)
  if (c === '"') return readDoubleQuoted(lx)
  if (c === '\\') return readEscape(lx)
  if (c === '#' && lx.word === null) return skipComment(lx)
  if (lx.text.startsWith('<<', lx.i) && !lx.text.startsWith('<<<', lx.i)) return readHeredocStart(lx)
  if (c === '$' && lx.text[lx.i + 1] === '(') {
    endCommand(lx)
    lx.i += 2
    return
  }
  lx.i += 1
  if (SEPARATORS.has(c)) {
    endCommand(lx)
    if (c === '\n') skipHeredocBodies(lx)
    return
  }
  if (c === ' ' || c === '\t') return endWord(lx)
  append(lx, c)
}

function append(lx: Lexer, text: string): void {
  lx.word = (lx.word ?? '') + text
}

function endWord(lx: Lexer): void {
  if (lx.word !== null) lx.words.push(lx.word)
  lx.word = null
}

function endCommand(lx: Lexer): void {
  endWord(lx)
  if (lx.words.length > 0) lx.out.push(lx.words)
  lx.words = []
}

function readSingleQuoted(lx: Lexer): void {
  const end = lx.text.indexOf("'", lx.i + 1)
  const stop = end === -1 ? lx.text.length : end
  append(lx, lx.text.slice(lx.i + 1, stop))
  lx.i = stop + 1
}

function readDoubleQuoted(lx: Lexer): void {
  let i = lx.i + 1
  let text = ''
  while (i < lx.text.length && lx.text[i] !== '"') {
    const isEscape = lx.text[i] === '\\' && '"\\$`'.includes(lx.text[i + 1] ?? '')
    text += isEscape ? lx.text[i + 1] : lx.text[i]
    i += isEscape ? 2 : 1
  }
  append(lx, text)
  lx.i = i + 1
}

function readEscape(lx: Lexer): void {
  const next = lx.text[lx.i + 1] ?? ''
  if (next !== '\n') append(lx, next)
  lx.i += 2
}

function skipComment(lx: Lexer): void {
  const end = lx.text.indexOf('\n', lx.i)
  lx.i = end === -1 ? lx.text.length : end
}

function readHeredocStart(lx: Lexer): void {
  endWord(lx)
  lx.i += 2
  const isIndented = lx.text[lx.i] === '-'
  if (isIndented) lx.i += 1
  while (lx.text[lx.i] === ' ' || lx.text[lx.i] === '\t') lx.i += 1
  const match = /^[^\s;&|()<>]+/.exec(lx.text.slice(lx.i))
  const raw = match?.[0] ?? ''
  lx.i += raw.length
  lx.heredocs.push({ delimiter: raw.replace(/['"\\]/g, ''), isIndented })
}

function skipHeredocBodies(lx: Lexer): void {
  for (const heredoc of lx.heredocs) {
    while (lx.i < lx.text.length) {
      const end = lx.text.indexOf('\n', lx.i)
      const stop = end === -1 ? lx.text.length : end
      const line = lx.text.slice(lx.i, stop)
      lx.i = stop + 1
      if ((heredoc.isIndented ? line.replace(/^\t+/, '') : line) === heredoc.delimiter) break
    }
  }
  lx.heredocs = []
}

// ---- Commands: remove prefixes and wrappers, then find the rule breaks ----

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', '}'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
// A wrapper runs the command after its options. The set names the options that take a separate value.
const WRAPPERS = new Map<string, ReadonlySet<string>>([
  ['sudo', new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U'])],
  ['env', new Set(['-u', '-C', '-S'])],
  ['nice', new Set(['-n'])],
  ['nohup', new Set()],
  ['time', new Set()],
  ['command', new Set()],
  ['builtin', new Set()],
  ['exec', new Set(['-a'])],
  ['xargs', new Set(['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a', '-J', '-R', '-S'])],
  ['timeout', new Set(['-s', '-k', '--signal', '--kill-after'])],
])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir'])
const GIT_VALUED = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix'])

const basename = (word: string): string => word.slice(word.lastIndexOf('/') + 1)

function skipOptions(words: string[], start: number, valued: ReadonlySet<string>): number {
  let i = start
  for (let word = words[i]; word !== undefined && word.startsWith('-') && word !== '-'; word = words[i]) {
    if (word === '--') return i + 1
    i += valued.has(word) ? 2 : 1
  }
  return i
}

/** The argv that runs: keywords, assignments and wrappers like sudo, env and xargs removed. */
export function commandArgv(words: string[]): string[] {
  let i = 0
  for (let word = words[i]; word !== undefined; word = words[i]) {
    if (KEYWORDS.has(word) || ASSIGNMENT.test(word)) {
      i += 1
      continue
    }
    const valued = WRAPPERS.get(word)
    if (valued === undefined) break
    i = skipOptions(words, i + 1, valued)
    if (word === 'timeout') i += 1 // the duration
  }
  return words.slice(i)
}

type Context = { isFirst: boolean; dirs: string[]; depth: number }

/** The rule breaks in a command line, and its git commit and push calls with their directories. */
export function analyze(command: string, dirs: string[] = [], depth = 0): Analysis {
  const result: Analysis = { findings: [], git: [] }
  if (depth > MAX_NESTING) return result
  let currentDirs = dirs
  splitCommands(command).forEach((words, index) => {
    const argv = commandArgv(words)
    const name = basename(argv[0] ?? '')
    if (name === '') return
    if (name === 'cd' || name === 'pushd') {
      currentDirs = [...currentDirs, argv[1] ?? '~']
      return
    }
    analyzeArgv(argv, { isFirst: index === 0, dirs: currentDirs, depth }, result)
  })
  return result
}

function analyzeArgv(argv: string[], ctx: Context, result: Analysis): void {
  const name = basename(argv[0] ?? '')
  const args = argv.slice(1)
  if (name === 'sleep' && isLongSleep(args, ctx.isFirst)) result.findings.push('sleep')
  if ((name === 'sed' || name === 'gsed') && sedEditsInPlace(args)) result.findings.push('edit-in-place')
  if (name === 'perl' && perlEditsInPlace(args)) result.findings.push('edit-in-place')
  if (name === 'git') {
    const call = gitCall(args, ctx.dirs)
    if (call !== null) result.git.push(call)
  }
  const nested = nestedScript(name, args)
  if (nested !== null) merge(result, analyze(nested, ctx.dirs, ctx.depth + 1))
  if (name === 'find') {
    for (const sub of findExecCommands(args)) analyzeArgv(sub, { ...ctx, isFirst: false }, result)
  }
}

function merge(into: Analysis, from: Analysis): void {
  into.findings.push(...from.findings)
  into.git.push(...from.git)
}

function nestedScript(name: string, args: string[]): string | null {
  if (name === 'eval') return args.join(' ')
  if (!SHELLS.has(name)) return null
  const flag = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a))
  return flag === -1 ? null : (args[flag + 1] ?? null)
}

function findExecCommands(args: string[]): string[][] {
  const commands: string[][] = []
  args.forEach((arg, i) => {
    if (!FIND_EXEC.has(arg)) return
    const end = args.findIndex((a, j) => j > i && (a === ';' || a === '+'))
    const sub = commandArgv(args.slice(i + 1, end === -1 ? args.length : end))
    if (sub.length > 0) commands.push(sub)
  })
  return commands
}

const SLEEP_UNITS: Record<string, number> = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }

/** True for a sleep that starts the line, is longer than the limit, or has a value that is not known. */
export function isLongSleep(args: string[], isFirst: boolean): boolean {
  if (isFirst) return true
  let seconds = 0
  for (const arg of args) {
    const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(arg)
    if (match === null) return true
    seconds += Number(match[1]) * (SLEEP_UNITS[match[2] ?? ''] ?? 1)
  }
  return seconds > MAX_SLEEP_SECONDS
}

type FlagScan = 'in-place' | 'takes-value' | 'none'

/** Scans one cluster of short flags (`-Ei`). It stops at a flag that takes the rest of the word or the next word. */
function scanFlags(flags: string, inPlace: string, valued: string, attached: string): FlagScan {
  for (const [k, c] of [...flags].entries()) {
    if (inPlace.includes(c)) return 'in-place'
    if (valued.includes(c)) return k === flags.length - 1 ? 'takes-value' : 'none'
    if (attached.includes(c)) return 'none'
  }
  return 'none'
}

/** GNU and BSD sed: -i, -i.bak, -I, --in-place, also inside a cluster like -Ei. Options can follow the script. */
export function sedEditsInPlace(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ''
    if (arg === '--') return false
    if (arg === '--in-place' || arg.startsWith('--in-place=')) return true
    if (arg === '--expression' || arg === '--file') {
      i += 1
      continue
    }
    if (!arg.startsWith('-') || arg.startsWith('--') || arg === '-') continue
    const scan = scanFlags(arg.slice(1), 'iI', 'efl', '')
    if (scan === 'in-place') return true
    if (scan === 'takes-value') i += 1
  }
  return false
}

/** perl -i, -pi, -i.bak. Switches end at the first word that is not a switch (the program file). */
export function perlEditsInPlace(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ''
    if (arg === '--' || arg === '-' || !arg.startsWith('-')) return false
    const scan = scanFlags(arg.slice(1), 'i', 'eE', 'MmIxdDC')
    if (scan === 'in-place') return true
    if (scan === 'takes-value') i += 1
  }
  return false
}

function gitCall(args: string[], dirs: string[]): GitCall | null {
  const callDirs = [...dirs]
  let i = 0
  for (let arg = args[i]; arg !== undefined && arg.startsWith('-'); arg = args[i]) {
    if (arg === '-C') callDirs.push(args[i + 1] ?? '')
    if (arg.startsWith('--work-tree=')) callDirs.push(arg.slice('--work-tree='.length))
    i += arg === '-C' || GIT_VALUED.has(arg) ? 2 : 1
  }
  const sub = args[i]
  const rest = args.slice(i + 1)
  if (rest.includes('-h') || rest.includes('--help')) return null
  return sub === 'commit' || sub === 'push' ? { kind: sub, args: rest, dirs: callDirs } : null
}

// ---- git push: which branches a push writes ----

const PUSH_VALUED = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])
const PUSH_ALL = new Set(['--all', '--branches', '--mirror'])

export type PushPlan = { isAll: boolean; isTagsOnly: boolean; refspecs: string[] }

/** The parts of git push args that select the target branches. */
export function pushPlan(args: string[]): PushPlan {
  const positional: string[] = []
  let isAll = false
  let hasTags = false
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ''
    if (PUSH_ALL.has(arg)) isAll = true
    if (arg === '--tags') hasTags = true
    if (PUSH_VALUED.has(arg)) i += 1
    else if (!arg.startsWith('-')) positional.push(arg)
  }
  const refspecs = positional.slice(1)
  return { isAll, isTagsOnly: hasTags && refspecs.length === 0, refspecs }
}

/** The branch a refspec writes: `+a:b` is b, `a` is a, HEAD is the current branch. Null when it is not known. */
export function refspecTarget(refspec: string, current: string | null): string | null {
  const spec = refspec.replace(/^\+/, '')
  const colon = spec.indexOf(':')
  const target = colon === -1 || colon === spec.length - 1 ? spec.replace(/:$/, '') : spec.slice(colon + 1)
  const branch = target === 'HEAD' ? current : target.replace(/^refs\/heads\//, '')
  if (branch === null || /[*$`]/.test(branch)) return null
  return branch
}

// ---- Repo state, through $.process.run ----

type RepoState = { defaultBranch: string; current: string | null }

async function git($: EngineInterface, dir: string, args: string[]): Promise<string | null> {
  const ran = await $.process.run(['git', '-C', dir, ...args], { timeoutMs: GIT_TIMEOUT_MS })
  return ran.exitCode === 0 ? String(ran.stdout).trim() : null
}

async function repoState($: EngineInterface, dir: string): Promise<RepoState | null> {
  if ((await git($, dir, ['remote', 'get-url', 'origin'])) === null) return null
  const head = await git($, dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  const hasMain = head === null && (await git($, dir, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])) !== null
  const defaultBranch = head?.replace(/^origin\//, '') ?? (hasMain ? 'main' : 'master')
  const current = await git($, dir, ['symbolic-ref', '--short', '-q', 'HEAD'])
  return { defaultBranch, current }
}

async function homeDir($: EngineInterface): Promise<string | null> {
  const ran = await $.process.run(['printenv', 'HOME'], { timeoutMs: GIT_TIMEOUT_MS })
  return ran.exitCode === 0 ? String(ran.stdout).trim() : null
}

/** The directory after each cd and -C, or null when a part holds a variable or ~ cannot be found. */
async function resolveDir($: EngineInterface, cwd: string, dirs: string[]): Promise<string | null> {
  let dir = cwd
  for (const part of dirs) {
    if (/[$`]/.test(part) || part === '-' || part === '') return null
    let path = part
    if (part === '~' || part.startsWith('~/')) {
      const home = await homeDir($)
      if (home === null) return null
      path = home + part.slice(1)
    }
    dir = path.startsWith('/') ? path : `${dir.replace(/\/+$/, '')}/${path}`
  }
  return dir
}

async function pushTargets($: EngineInterface, dir: string, args: string[], state: RepoState): Promise<(string | null)[]> {
  const plan = pushPlan(args)
  if (plan.isAll) return [null]
  if (plan.isTagsOnly) return []
  if (plan.refspecs.length > 0) return plan.refspecs.map(spec => refspecTarget(spec, state.current))
  const upstream = await git($, dir, ['rev-parse', '--abbrev-ref', '@{push}'])
  return [upstream === null ? state.current : upstream.slice(upstream.indexOf('/') + 1)]
}

/** The reason to deny a git commit or push, or null to allow it. */
async function gitDenial($: EngineInterface, call: GitCall, cwd: string): Promise<string | null> {
  const dir = await resolveDir($, cwd, call.dirs)
  if (dir === null) {
    return `cannot find the repo of this git ${call.kind}: its directory holds a variable. Use a literal path.`
  }
  const state = await repoState($, dir)
  if (state === null) return null
  const fix = `Make a worktree and a branch: git -C <repo> worktree add .worktrees/<slug> -b <type>/<slug> origin/${state.defaultBranch}.`
  if (call.kind === 'commit') {
    return state.current === state.defaultBranch ? `do not commit on the default branch "${state.defaultBranch}" of ${dir}. ${fix}` : null
  }
  const targets = await pushTargets($, dir, call.args, state)
  const isDefault = targets.some(target => target === null || target === state.defaultBranch)
  return isDefault ? `do not push to the default branch "${state.defaultBranch}" of ${dir}, or a branch that is not known. ${fix}` : null
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = String(e.command ?? '')
    if (!GUARDED_WORD.test(command)) return next(e)
    const analysis = analyze(command)
    const finding = analysis.findings[0]
    if (finding !== undefined) return { deny: `${$.plugin.name}: ${REASONS[finding]}` }
    if (analysis.git.length === 0) return next(e)
    const cwd = await $.session.cwd()
    for (const call of analysis.git) {
      const denial = await gitDenial($, call, cwd)
      if (denial !== null) return { deny: `${$.plugin.name}: ${denial}` }
    }
    return next(e)
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: the guard failed, so the command did not run.` },
  )
}
