/** One rate-limit window: the percent used and when it resets, in ms. */
export type Window = { percent: number; resetsAt: number | null }

/** The monthly spend limit: a window, and its dollars when the usage endpoint gave them. */
export type Spend = Window & { usedUsd: number | null; limitUsd: number | null }

/** What `git rev-parse` said about the session's directory. */
export type GitInfo = {
  /** The basename of the working tree's top folder. */
  root: string
  /** The working tree's top folder, absolute: what the worktree icon copies. */
  top: string
  /** The `origin` remote as a browser URL; null with no remote or one that is not a web host's. */
  webUrl: string | null
  /** The branch, or `HEAD` when detached. */
  branch: string
  /** The linked worktree's name; null in the main checkout. */
  worktree: string | null
  /** Lines added and removed in the working tree against `HEAD` (`git diff --shortstat HEAD`). */
  added: number
  removed: number
}

/** The figures the row draws, read at one moment. */
export type Snapshot = {
  model: string
  contextPercent: number | null
  /** Input tokens of the last response; null before the first response. */
  contextTokens: number | null
  /** The context window of the model, in tokens. */
  contextWindow: number
  fiveHour: Window | null
  sevenDay: Window | null
  /** A gateway's or an organization's monthly spend limit, as metered (enterprise) accounts report it. */
  spendLimit: Spend | null
  /** What the session has cost so far, in US dollars; null where the host keeps no ledger. */
  costUsd: number | null
  cwd: string
  home: string
  git: GitInfo | null
  /** When the figures were read, in `$.clock.now()` ms. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    statusline: {
      snapshot: Snapshot | null
      skill: string | null
      /** The effort of the last main-loop request; null for a model without effort. */
      effort: string | null
    }
  }
}
