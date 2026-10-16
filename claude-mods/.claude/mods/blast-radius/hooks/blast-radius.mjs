// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0
//
// Blast Radius: holds a risky Bash command and shows what it would change.
//
// tool.call (Bash): if the command is risky, work out its blast radius, open a
// pane with Proceed and Cancel, and hold the call until one is pressed.
// ui.render (Pane): draws the report. If the surface won't place the pane (a
// narrow terminal), the same report is drawn in the AbovePrompt band instead.
//
// Holding: a hook has 10 s of its own time, but time spent inside a `$` call is
// free. So the hold loop waits on a short `$.process.run(["sleep", ...])` until
// a button's onPress sets the decision.
//
// The host reads `on(...)` and `$.noun.method(...)` from source, so they are
// spelled literally, and helpers that take `$` are top-level functions.

const PANE_ID = "blast-radius";
const POLL_SECONDS = "0.25";
const HOLD_LIMIT_MS = 10 * 60 * 1000;
const LIST_MAX = 10;

// The call being held, or null. One at a time: Bash calls in a turn run in order.
let held = null;

export function register(on) {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const risks = classifyAll(String(e.command ?? ""));
    if (risks.length === 0) {
      return next(e);
    }
    const sessionCwd = await $.session.cwd();
    const risk = await firstHeldRisk($, risks, sessionCwd);
    if (risk === null) {
      return next(e);
    }
    // One hold at a time. If another risky call is already held (a subagent's,
    // say), wait until it is answered. `held` is claimed with no await between
    // the check and the claim, so two waiting calls can't both get through.
    while (held !== null) {
      if (next.signal.aborted) {
        return { deny: "Blast Radius held this command and did not run it: the turn was interrupted. Do not retry it unless the user asks you to." };
      }
      await $.process.run(["sleep", POLL_SECONDS], { timeoutMs: 5000 });
    }
    const mine = { command: String(e.command), risk, report: null, decision: null, where: "pane" };
    held = mine;

    let opened = { isPlaced: false };
    let decision;
    let summary = risk.label;
    try {
      // Measure where the command will run: the session folder, moved by any
      // `cd dir &&` or `git -C dir` earlier in the same command line.
      const cwd = risk.dir ? await resolveDir($, sessionCwd, risk.dir) : sessionCwd;
      mine.report = clipReport(cwd === null
        ? { summary: `${risk.label} in ${risk.dir}`, lines: [], note: `Couldn't find the folder ${risk.dir}, so I couldn't measure what this would change.` }
        : await measure($, risk, cwd));
      summary = mine.report.summary;

      opened = await $.ui.open({ id: PANE_ID, title: "Blast Radius", focus: true, rows: paneRows(mine) });
      if (!opened.isPlaced) {
        mine.where = "band";
      }
      $.ui.invalidate("ui.render");

      const startedAt = await $.clock.now();
      while (mine.decision === null) {
        if (next.signal.aborted) {
          mine.decision = "interrupted";
          break;
        }
        if ((await $.clock.now()) - startedAt > HOLD_LIMIT_MS) {
          mine.decision = "timeout";
          break;
        }
        await $.process.run(["sleep", POLL_SECONDS], { timeoutMs: 5000 });
      }
    } catch {
      mine.decision = "error"; // anything unexpected refuses the command
    } finally {
      decision = mine.decision;
      // Close this call's pane before releasing the hold, so the next call's
      // pane can't be the one that gets closed.
      try {
        if (opened.isPlaced) {
          await $.ui.close({ id: PANE_ID });
        }
      } catch {
        // the pane is already gone
      }
      if (held === mine) {
        held = null;
      }
      $.ui.invalidate("ui.render");
    }

    if (decision === "proceed") {
      $.ui.toast("Blast Radius: running it");
      return next(e);
    }
    const why = {
      cancel: "the user pressed Cancel",
      timeout: "no answer within 10 minutes",
      interrupted: "the turn was interrupted",
      error: "Blast Radius hit an error while holding it",
    }[decision] ?? "no answer was recorded";
    return {
      deny: `Blast Radius held this command and did not run it: ${why}. It would have: ${summary}. Do not retry it unless the user asks you to.`,
    };
  });

  on("ui.render", { component: "Pane" }, ($, e, next) => {
    if (e.requestId !== PANE_ID || held === null || held.report === null) {
      return next(e);
    }
    return draw($.ui.resolve(e), held);
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    if (held === null || held.report === null || held.where !== "band") {
      return next(e);
    }
    return draw($.ui.resolve(e), held);
  });
}

// ---- What counts as risky -------------------------------------------------

// sudo options that take a value, so the value isn't read as the command.
const SUDO_VALUE_OPTIONS = new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-T", "-U"]);
// Commands that only read, so a bare word "migrate" in them isn't a migration.
const READ_ONLY = new Set(["ls", "cat", "echo", "printf", "grep", "rg", "find", "less", "head", "tail", "cd", "git"]);

/** A folder a later `cd arg` moves to, given the folder so far (null = the session folder). */
function joinDir(dir, arg) {
  if (arg === undefined || arg === "~" || arg.startsWith("/") || arg.startsWith("~/")) {
    return arg ?? "~";
  }
  return dir ? `${dir}/${arg}` : arg;
}

/** The first risky segment of a shell command, or null. */
export function classify(command) {
  return classifyAll(command)[0] ?? null;
}

/** Every risky segment of a shell command, in order. */
export function classifyAll(command) {
  const risks = [];
  let dir = null; // where a `cd` earlier on the line moved to; null means the session folder
  const scopes = []; // dir to restore when a ( subshell ) closes
  const pushed = []; // pushd stack, for popd
  for (const raw of stripHeredocs(command).split(/&&|\|\||;|\||\n/)) {
    const opens = (raw.match(/^\s*\(+/)?.[0].trim().length) ?? 0;
    // Trailing redirects and & don't hide a closing ) : `(cd sub && make) > log`.
    const tail = raw.replace(/(?:\s*(?:\d*>>?|&>>?|<)\s*\S+|\s*&)+\s*$/, "");
    const closes = (tail.match(/\)+\s*$/)?.[0].trim().length) ?? 0;
    for (let k = 0; k < opens; k += 1) {
      scopes.push(dir);
    }
    const risk = classifySegment(raw, dir, pushed);
    if (risk !== null && risk.cd === undefined) {
      risks.push({ ...risk, segment: raw.trim() });
    } else if (risk !== null) {
      dir = risk.cd; // a cd, pushd or popd moved the folder
    }
    for (let k = 0; k < closes && scopes.length > 0; k += 1) {
      dir = scopes.pop(); // a cd inside ( ... ) doesn't outlive it
    }
  }
  return risks;
}

// `<<EOF`, `<<-EOF`, `<< 'EOF'`, `<<"EOF"`; not the here-string `<<<`.
const HEREDOC_START = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g;

/** The command without heredoc bodies: their lines are data, not commands. */
export function stripHeredocs(command) {
  const kept = [];
  const ends = []; // delimiters still open, in order
  for (const line of command.split("\n")) {
    if (ends.length > 0) {
      if (line.replace(/^\t+/, "") === ends[0]) {
        ends.shift();
      }
      continue;
    }
    kept.push(line);
    ends.push(...[...line.matchAll(HEREDOC_START)].map((m) => m[2]));
  }
  return kept.join("\n");
}

// Words that can come before the real command without changing what it does.
const PREFIXES = new Set(["command", "exec", "env", "nohup", "time", "then", "do", "else", "!"]);

/** One segment: a risk, { cd } for a folder change, or null. */
function classifySegment(segment, dir, pushed) {
  {
    const words = tokenize(segment.trim().replace(/^[({]+\s*/, "").replace(/\s*[)}]+$/, ""));
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
      words.shift(); // leading VAR=value
    }
    if (words[0] === "sudo") {
      words.shift();
      while (words.length > 0 && words[0].startsWith("-")) {
        const option = words.shift();
        if (SUDO_VALUE_OPTIONS.has(option)) {
          words.shift();
        }
      }
    }
    while (words.length > 0 && (PREFIXES.has(words[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))) {
      words.shift();
    }
    if (words[0] === "nice") {
      words.shift();
      if (words[0] === "-n") {
        words.splice(0, 2);
      } else if (/^-\d+$/.test(words[0] ?? "")) {
        words.shift();
      }
    }
    const [first, ...args] = words;
    if (first === undefined) {
      return null;
    }
    const cmd = first.replace(/^\\/, ""); // \rm skips aliases; it's still rm
    if (cmd === "cd") {
      return { cd: args[0] === "-" ? "-" : joinDir(dir, args[0]) };
    }
    if (cmd === "pushd") {
      pushed.push(dir);
      return { cd: joinDir(dir, args[0]) };
    }
    if (cmd === "popd") {
      return { cd: pushed.length > 0 ? pushed.pop() : "-" };
    }
    if (cmd === "rm" || cmd.endsWith("/rm")) {
      // After `--`, every word is a path, even one that starts with "-".
      const end = args.indexOf("--");
      const options = end === -1 ? args : args.slice(0, end);
      const flags = options.filter((a) => a.startsWith("-") && a !== "-");
      const recursive = flags.some((f) => f === "--recursive" || (/^-[^-]/.test(f) && /[rR]/.test(f)));
      const force = flags.some((f) => f === "--force" || (/^-[^-]/.test(f) && f.includes("f")));
      if (recursive || force) {
        const targets = [...options.filter((a) => !flags.includes(a)), ...(end === -1 ? [] : args.slice(end + 1))];
        return { kind: "rm", label: `rm ${flags.join(" ")}`.trim(), targets, dir };
      }
    }
    if (cmd === "git") {
      // Git's own options come before the subcommand; -C moves where it runs.
      let gitDir = dir;
      let i = 0;
      while (i < args.length && args[i].startsWith("-")) {
        if (args[i] === "-C" && i + 1 < args.length) {
          gitDir = joinDir(gitDir, args[i + 1]);
          i += 2;
        } else if (args[i] === "-c" && i + 1 < args.length) {
          i += 2;
        } else {
          i += 1;
        }
      }
      const sub = args[i];
      const rest = args.slice(i + 1);
      if (sub === "reset" && rest.includes("--hard")) {
        return { kind: "git-reset", label: "git reset --hard", args: rest, dir: gitDir };
      }
      if (sub === "clean") {
        return { kind: "git-clean", label: "git clean", args: rest, dir: gitDir };
      }
      if (sub === "push") {
        return classifyPush(rest, gitDir);
      }
      if (sub === "branch") {
        return classifyBranchDelete(rest, gitDir);
      }
      const stagedOnly = sub === "restore" && rest.includes("--staged") && !rest.includes("--worktree") && !rest.includes("-W");
      if ((sub === "checkout" || sub === "restore") && rest.includes(".") && !stagedOnly) {
        return { kind: "git-checkout", label: `git ${sub} -- .`, args: rest, dir: gitDir };
      }
    }
    const toolRisk = TOOL_CLASSIFIERS.get(cmd)?.(cmd, args, dir) ?? null;
    if (toolRisk !== null) {
      return toolRisk;
    }
    const joined = words.join(" ");
    if (/\balembic\s+upgrade\b/.test(joined)) {
      return { kind: "migrate", tool: "alembic", label: "alembic upgrade", dir };
    }
    if (/\bdb:migrate(?!:status\b)/.test(joined)) {
      return { kind: "migrate", tool: "rails", label: "db:migrate", dir };
    }
    if (/\bprisma\s+migrate\b/.test(joined)) {
      return { kind: "migrate", tool: "prisma", label: "prisma migrate", dir };
    }
    if (/\bmanage\.py\s+migrate\b/.test(joined)) {
      return { kind: "migrate", tool: "django", label: "manage.py migrate", dir };
    }
    if (!READ_ONLY.has(cmd) && args.includes("migrate")) {
      return { kind: "migrate", tool: "unknown", label: "migrate", dir };
    }
  }
  return null;
}

// ---- Protected branches -----------------------------------------------------
//
// Only a delete or a force push of a protected branch is held. A force push
// with no refspec goes to the current branch, which only the repo knows, so
// the hook resolves it (see firstHeldRisk).

const PROTECTED_BRANCHES = new Set(["main", "master"]);
const PUSH_VALUE_OPTIONS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

function isProtected(branch) {
  return PROTECTED_BRANCHES.has(branch.replace(/^refs\/heads\//, ""));
}

/** The remote and refspecs of `git push` args. */
function pushTargets(args) {
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    if (PUSH_VALUE_OPTIONS.has(args[i])) {
      i += 1;
    } else if (!args[i].startsWith("-")) {
      positionals.push(args[i]);
    }
  }
  const [remote, ...refspecs] = positionals;
  return { remote, refspecs };
}

function classifyPush(args, dir) {
  const { remote, refspecs } = pushTargets(args);
  const deletes = args.includes("--delete") || args.includes("-d");
  // `:main` deletes main; with --delete, each refspec is a branch to delete.
  const deleted = deletes ? refspecs : refspecs.filter((r) => r.startsWith(":")).map((r) => r.slice(1));
  const deletedProtected = deleted.filter(isProtected);
  if (deletedProtected.length > 0) {
    return { kind: "git-branch-delete", label: "git push --delete", remote: remote ?? "origin", branches: deletedProtected, dir };
  }
  const forced = args.some((a) => a === "--force" || a === "-f" || a.startsWith("--force-with-lease") || a === "--mirror")
    || refspecs.some((r) => r.startsWith("+"));
  if (!forced || deletes) {
    return null;
  }
  const label = "git push --force";
  if (args.includes("--all") || args.includes("--mirror")) {
    return { kind: "git-push-force", label, args, dir };
  }
  // The destination of `src:dst` is dst; of `src` alone, src. HEAD is the current branch.
  const destinations = refspecs.map((r) => r.replace(/^\+/, "").split(":").pop());
  if (destinations.length === 0 || destinations.includes("HEAD")) {
    return { kind: "git-push-force", label, args, dir, isCurrentBranch: true };
  }
  return destinations.some(isProtected) ? { kind: "git-push-force", label, args, dir } : null;
}

function classifyBranchDelete(args, dir) {
  const deletes = args.some((a) => a === "--delete" || /^-[a-zA-Z]*[dD]/.test(a));
  const branches = args.filter((a) => !a.startsWith("-") && isProtected(a));
  if (!deletes || branches.length === 0) {
    return null;
  }
  return { kind: "git-branch-delete", label: "git branch --delete", branches, dir };
}

/** The branch a push with no refspec goes to: its push target, else the current branch. */
async function currentPushBranch($, cwd) {
  const pushRef = await $.process.run(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{push}"], { cwd, timeoutMs: 10000 });
  if (pushRef.exitCode === 0 && pushRef.stdout.trim() !== "") {
    return pushRef.stdout.trim().replace(/^[^/]+\//, ""); // drop the remote name
  }
  const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeoutMs: 10000 });
  return head.stdout.trim();
}

// Resolves a `cd` target to an absolute folder, or null if it doesn't exist.
// The target is passed as an argument, never as source.
const CD_SCRIPT = `unset CDPATH; d="$1"; case "$d" in "~") d="$HOME";; "~/"*) d="$HOME/\${d#\\~/}";; esac; cd -- "$d" 2>/dev/null && pwd -P`;

async function resolveDir($, sessionCwd, dir) {
  if (dir === "-") {
    return null; // `cd -` depends on the shell's history
  }
  const run = await $.process.run(["bash", "-c", CD_SCRIPT, "blast-radius", dir], { cwd: sessionCwd, timeoutMs: 5000 });
  const out = run.stdout.trim();
  return run.exitCode === 0 && out !== "" ? out : null;
}

// ---- Allowed rm -------------------------------------------------------------
//
// An rm runs without a hold if each path it removes is inside /tmp, or is a
// linked worktree inside the main worktree of the repo. The parent folder is
// resolved, not the path itself, so a symlink is judged where it is, as rm
// removes the link and not its target. A path that ends in "/" is resolved in
// full, as rm then follows the link. A path that can't be resolved is held.
const SAFE_RM_SCRIPT = `
shopt -s nullglob dotglob
canon() { (cd -P -- "$1" 2>/dev/null && pwd -P); }
# True if $1 is a linked worktree inside the main worktree. Git runs in the
# parent folder, so the session folder can be outside the repo.
is_inner_worktree() {
  local line w main=""
  while IFS= read -r line; do
    case "$line" in "worktree "*)
      w=$(canon "\${line#worktree }") || continue
      if [[ -z "$main" ]]; then
        main="$w"
      elif [[ "$1" == "$w" && "$w" == "$main"/* ]]; then
        return 0
      fi;;
    esac
  done < <(git -C "$(dirname -- "$1")" worktree list --porcelain 2>/dev/null)
  return 1
}
allowed() {
  case "$1" in /tmp/?*|/private/tmp/?*) return 0;; esac
  is_inner_worktree "$1"
}
(( $# > 0 )) || exit 1
for t in "$@"; do
  case "$t" in "~"|"~/"*) t="$HOME\${t#\\~}";; esac
  if [[ "$t" == *[*?[]* ]]; then
    matches=()
    while IFS= read -r m; do matches+=("$m"); done < <(compgen -G "$t")
  else
    matches=("$t")
  fi
  for m in "\${matches[@]}"; do
    p=""
    case "$m" in
      */|.|..|*/.|*/..) p=$(canon "$m");;
      *) d=$(canon "$(dirname -- "$m")") && p="$d/$(basename -- "$m")";;
    esac
    [[ -n "$p" ]] && allowed "$p" || exit 1
  done
done
echo allowed
`;

/** The first risk that must be held, or null if each one is allowed. */
async function firstHeldRisk($, risks, sessionCwd) {
  for (const risk of risks) {
    if (!(await isAllowed($, risk, sessionCwd))) {
      return risk;
    }
  }
  return null;
}

/** True for an rm of allowed paths, or a force push to a branch that is not protected. */
async function isAllowed($, risk, sessionCwd) {
  if (risk.kind !== "rm" && !risk.isCurrentBranch) {
    return false;
  }
  try {
    const cwd = risk.dir ? await resolveDir($, sessionCwd, risk.dir) : sessionCwd;
    if (cwd === null) {
      return false;
    }
    if (risk.isCurrentBranch) {
      const branch = await currentPushBranch($, cwd);
      return branch !== "" && branch !== "HEAD" && !isProtected(branch);
    }
    const run = await $.process.run(["bash", "-c", SAFE_RM_SCRIPT, "blast-radius", ...risk.targets], { cwd, timeoutMs: 10000 });
    return run.exitCode === 0 && run.stdout.trim() === "allowed";
  } catch {
    return false; // anything unexpected holds the command
  }
}

/** Splits one segment into words, honouring quotes. Good enough to read flags and paths. */
function tokenize(text) {
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    words.push(m[1] ?? m[2] ?? m[3]);
  }
  return words;
}

// ---- Infrastructure tools (local additions) -------------------------------
//
// To hold another tool: add a classifier to TOOL_CLASSIFIERS that returns
// { kind, label, dir, ... } or null. Then add a branch for that kind to measure().
// The host reads $ calls from source, so measure() must call each measurer by name.

const TERRAFORM_VALUE_FLAGS = new Set(["-var", "-var-file", "-target", "-exclude"]);
const KUBECTL_VALUE_FLAGS = new Set([
  "-n", "--namespace", "--context", "--cluster", "--kubeconfig", "--user", "-s", "--server",
  "-l", "--selector", "--field-selector", "-f", "--filename", "-k", "--kustomize",
  "-o", "--output", "--grace-period", "--timeout", "--as", "--token", "--request-timeout",
]);
// kubectl delete flags that kubectl get does not take, or that change its output.
const KUBECTL_DELETE_ONLY = new Set([
  "--grace-period", "--force", "--now", "--wait", "--cascade", "--timeout", "--dry-run",
  "-i", "--interactive", "--raw", "-o", "--output",
]);
const HELM_VALUE_FLAGS = new Set(["-n", "--namespace", "--kube-context", "--kubeconfig", "--timeout", "--cascade", "--description"]);
const HELM_SCOPE_FLAGS = new Set(["-n", "--namespace", "--kube-context", "--kubeconfig"]);
const HELM_UNINSTALL = new Set(["uninstall", "delete", "del", "un"]);
const KUBE_NAMESPACE_KINDS = new Set(["ns", "namespace", "namespaces"]);

/** Splits CLI args into flags, each with its value tokens, and positionals. */
function parseArgs(args, valueFlags) {
  const flags = [];
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith("-") || a === "-") {
      positionals.push(a);
      continue;
    }
    const name = a.split("=")[0];
    const takesNext = !a.includes("=") && valueFlags.has(name) && i + 1 < args.length;
    flags.push({ name, tokens: takesNext ? [a, args[i + 1]] : [a] });
    if (takesNext) {
      i += 1;
    }
  }
  return { flags, positionals };
}

/** The tokens of the flags that the predicate keeps, in order. */
function flagTokens(flags, keep) {
  return flags.filter((f) => keep(f.name)).flatMap((f) => f.tokens);
}

/** True if a --dry-run flag makes the command change nothing. */
function isDryRun(flags) {
  return flags.some((f) => f.name === "--dry-run" && f.tokens.join("=") !== "--dry-run=none");
}

function classifyTerraform(cmd, args, dir) {
  const { flags, positionals } = parseArgs(args, TERRAFORM_VALUE_FLAGS);
  const sub = positionals[0];
  const destroys = sub === "destroy" || (sub === "apply" && flags.some((f) => f.name === "-destroy" || f.name === "--destroy"));
  if (!destroys) {
    return null;
  }
  return { kind: "terraform-destroy", tool: cmd, label: `${cmd} ${sub === "apply" ? "apply -destroy" : "destroy"}`, flags, dir };
}

function classifyKubectl(cmd, args, dir) {
  const { flags, positionals } = parseArgs(args, KUBECTL_VALUE_FLAGS);
  if (positionals[0] !== "delete" || isDryRun(flags)) {
    return null;
  }
  return { kind: "kubectl-delete", tool: cmd, label: "kubectl delete", flags, targets: positionals.slice(1), dir };
}

function classifyHelm(cmd, args, dir) {
  const { flags, positionals } = parseArgs(args, HELM_VALUE_FLAGS);
  if (!HELM_UNINSTALL.has(positionals[0]) || isDryRun(flags)) {
    return null;
  }
  return { kind: "helm-uninstall", tool: cmd, label: "helm uninstall", flags, releases: positionals.slice(1), dir };
}

// A Map, so a command named like an Object method ("constructor") can't match.
const TOOL_CLASSIFIERS = new Map([
  ["terraform", classifyTerraform],
  ["tofu", classifyTerraform],
  ["kubectl", classifyKubectl],
  ["helm", classifyHelm],
]);

// ---- Measuring the blast radius -------------------------------------------

/** { summary, lines, note } for the pane. Never throws: a failed read is said, not hidden. */
async function measure($, risk, cwd) {
  try {
    if (risk.kind === "rm") {
      return await measureRm($, risk, cwd);
    }
    if (risk.kind === "migrate") {
      return await measureMigrations($, risk, cwd);
    }
    if (risk.kind === "terraform-destroy") {
      return await measureTerraform($, risk, cwd);
    }
    if (risk.kind === "kubectl-delete") {
      return await measureKubectl($, risk, cwd);
    }
    if (risk.kind === "helm-uninstall") {
      return await measureHelm($, risk, cwd);
    }
    return await measureGit($, risk, cwd);
  } catch (error) {
    return { summary: `${risk.label} (could not measure it)`, lines: [], note: `Could not measure: ${String(error?.message ?? error).slice(0, 200)}` };
  }
}

// The paths are passed to bash as arguments, never as source, so nothing in
// them runs. compgen -G expands a glob without command substitution.
const RM_SCRIPT = `
shopt -s nullglob dotglob
paths=()
for p in "$@"; do
  case "$p" in "~"|"~/"*) p="$HOME\${p#\\~}";; esac
  if [[ "$p" == *[*?[]* ]]; then
    while IFS= read -r m; do paths+=("$m"); done < <(compgen -G "$p")
  elif [[ -e "$p" || -L "$p" ]]; then
    paths+=("$p")
  fi
done
if (( \${#paths[@]} == 0 )); then echo "0 0 0"; exit 0; fi
# A relative path gets ./ in front, so find never reads a name like -delete as an action.
for i in "\${!paths[@]}"; do case "\${paths[$i]}" in /*) ;; *) paths[$i]="./\${paths[$i]}";; esac; done
files=$(find "\${paths[@]}" \\( -type f -o -type l \\) 2>/dev/null | wc -l | tr -d ' ')
kb=$(du -skc "\${paths[@]}" 2>/dev/null | tail -n1 | cut -f1)
echo "$files $(( \${kb:-0} * 1024 )) \${#paths[@]}"
find "\${paths[@]}" \\( -type f -o -type l \\) 2>/dev/null | head -n ${LIST_MAX}
`;

async function measureRm($, risk, cwd) {
  if (risk.targets.length === 0) {
    return { summary: "rm with no paths", lines: [], note: "No paths to expand." };
  }
  const run = await $.process.run(["bash", "-c", RM_SCRIPT, "blast-radius", ...risk.targets], { cwd, timeoutMs: 15000 });
  const [head, ...rest] = run.stdout.split("\n").filter((l) => l !== "");
  const [files, bytes, found] = (head ?? "0 0 0").split(" ").map(Number);
  if (!found) {
    const what = risk.targets.length === 1 ? risk.targets[0] : `the ${risk.targets.length} paths`;
    return { summary: `delete nothing: no file matches ${what}`, lines: [], note: "The paths don't exist, so rm has nothing to remove." };
  }
  if (!files) {
    return { summary: `delete ${found} ${found === 1 ? "path" : "paths"} with no files in ${found === 1 ? "it" : "them"}`, lines: [], note: `Paths: ${risk.targets.join(" ")}` };
  }
  return {
    summary: `delete ${files} ${files === 1 ? "file" : "files"} (about ${size(bytes)})`,
    lines: rest.map((l) => l.replace(/^\.\//, "")),
    more: Math.max(0, files - rest.length),
    note: `Paths: ${risk.targets.join(" ")}`,
  };
}

async function measureGit($, risk, cwd) {
  if (risk.kind === "git-push-force") {
    return await measurePush($, risk, cwd);
  }
  if (risk.kind === "git-branch-delete") {
    return await measureBranchDelete($, risk, cwd);
  }
  if (risk.kind === "git-clean") {
    const flags = [];
    const paths = [];
    for (let i = 0; i < risk.args.length; i += 1) {
      const a = risk.args[i];
      if (a === "--") {
        paths.push(...risk.args.slice(i + 1));
        break;
      }
      if (a === "-e" || a === "--exclude") {
        flags.push(a, risk.args[i + 1] ?? "");
        i += 1;
      } else if (a.startsWith("--exclude=") || /^-e./.test(a)) {
        flags.push(a);
      } else if (/^-[a-zA-Z]+$/.test(a)) {
        const kept = a.replace(/[finq]/g, ""); // -n is added below; -f, -i and -q would change the dry run
        if (kept !== "-") {
          flags.push(kept);
        }
      } else if (!a.startsWith("-")) {
        paths.push(a);
      }
    }
    const run = await $.process.run(["git", "clean", "-n", ...flags, "--", ...paths], { cwd, timeoutMs: 15000 });
    if (run.exitCode !== 0) {
      return { summary: "git clean (could not dry-run it)", lines: [], note: run.stderr.trim().slice(0, 200) };
    }
    const gone = run.stdout.split("\n").filter((l) => l.startsWith("Would remove ")).map((l) => l.slice(13));
    return {
      summary: gone.length === 0 ? "remove nothing: no untracked files match" : `remove ${gone.length} untracked ${gone.length === 1 ? "path" : "paths"}`,
      lines: gone.slice(0, LIST_MAX),
      more: Math.max(0, gone.length - LIST_MAX),
      note: "From git clean -n. Untracked files are not in git, so they can't be recovered.",
    };
  }
  const status = await $.process.run(["git", "status", "--porcelain"], { cwd, timeoutMs: 15000 });
  if (status.exitCode !== 0) {
    return { summary: `${risk.label} (not a git repo here?)`, lines: [], note: status.stderr.trim().slice(0, 200) };
  }
  const rows = status.stdout.split("\n").filter((l) => l.length > 3 && !l.startsWith("??"));
  // reset --hard drops staged and unstaged changes; checkout -- . drops unstaged ones.
  const lost = risk.kind === "git-reset" ? rows : rows.filter((l) => l[1] !== " ");
  const stat = await $.process.run(["git", "diff", "--shortstat", risk.kind === "git-reset" ? "HEAD" : "--"], { cwd, timeoutMs: 15000 });
  return {
    summary: lost.length === 0 ? "discard nothing: no uncommitted changes" : `discard uncommitted changes in ${lost.length} ${lost.length === 1 ? "file" : "files"}`,
    lines: lost.slice(0, LIST_MAX).map((l) => `${l.slice(0, 2)} ${l.slice(3)}`),
    more: Math.max(0, lost.length - LIST_MAX),
    note: stat.stdout.trim() !== "" ? `${stat.stdout.trim()}. Uncommitted changes can't be recovered.` : "From git status --porcelain.",
  };
}

async function measureBranchDelete($, risk, cwd) {
  const refs = risk.remote ? risk.branches.map((b) => `${risk.remote}/${b}`) : risk.branches;
  const lines = [];
  for (const ref of refs) {
    const tip = await $.process.run(["git", "log", "-1", "--oneline", "--no-decorate", ref], { cwd, timeoutMs: 10000 });
    lines.push(tip.exitCode === 0 ? `${ref}: ${tip.stdout.trim()}` : `${ref}: no local copy`);
  }
  return {
    summary: `delete the protected ${refs.length === 1 ? "branch" : "branches"} ${refs.join(" ")}`,
    lines,
    note: risk.remote ? "The remote branch goes for every clone." : "Commits only on this branch are lost.",
  };
}

async function measurePush($, risk, cwd) {
  const positional = risk.args.filter((a) => !a.startsWith("-"));
  const remote = positional[0] ?? "origin";
  // A refspec is src:dst. With no colon, the local branch of the same name is pushed.
  const spec = (positional[1] ?? "").replace(/^\+/, "");
  let [source, branch] = spec.includes(":") ? spec.split(":") : [spec, spec];
  branch = (branch ?? "").replace(/^refs\/heads\//, "");
  if (!branch) {
    const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeoutMs: 10000 });
    branch = head.stdout.trim();
    source = "HEAD";
  } else if (branch === "HEAD") {
    // `git push origin HEAD` pushes the current branch to its namesake.
    const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeoutMs: 10000 });
    branch = head.stdout.trim();
    source = "HEAD";
  }
  source = source || "HEAD";
  const ref = `${remote}/${branch}`;
  const known = await $.process.run(["git", "rev-parse", "--verify", "--quiet", ref], { cwd, timeoutMs: 10000 });
  if (known.exitCode !== 0) {
    return { summary: `force-push to ${ref}`, lines: [], note: `No local copy of ${ref}, so I can't tell which commits the push would drop. Run git fetch first.` };
  }
  const log = await $.process.run(["git", "log", "--oneline", "--no-decorate", `${source}..${ref}`], { cwd, timeoutMs: 15000 });
  const dropped = log.stdout.split("\n").filter((l) => l !== "");
  return {
    summary: dropped.length === 0 ? `force-push to ${ref}: drops no commits` : `force-push to ${ref}: drops ${dropped.length} ${dropped.length === 1 ? "commit" : "commits"}`,
    lines: dropped.slice(0, LIST_MAX),
    more: Math.max(0, dropped.length - LIST_MAX),
    note: `Commits on ${ref} that ${source} doesn't have, as of the last fetch.`,
  };
}

// terraform plan refreshes state against the provider, which can take a while.
const PLAN_TIMEOUT_MS = 180000;
const KUBE_TIMEOUT_MS = 30000;

async function measureTerraform($, risk, cwd) {
  const chdir = flagTokens(risk.flags, (name) => name === "-chdir");
  const inputs = flagTokens(risk.flags, (name) => TERRAFORM_VALUE_FLAGS.has(name));
  const argv = [risk.tool, ...chdir, "plan", "-destroy", "-no-color", "-input=false", "-lock=false", ...inputs];
  const run = await $.process.run(argv, { cwd, timeoutMs: PLAN_TIMEOUT_MS });
  if (run.exitCode !== 0) {
    return { summary: `${risk.label} (could not plan it)`, lines: [], note: `${risk.tool} plan -destroy failed: ${lastLine(run.stderr || run.stdout)}` };
  }
  const gone = [...run.stdout.matchAll(/^\s*# (\S+) will be destroyed/gm)].map((m) => m[1]);
  const plan = run.stdout.match(/^Plan: .*$/m)?.[0] ?? "No changes.";
  return {
    summary: gone.length === 0 ? `${risk.label}: destroys nothing` : `destroy ${gone.length} ${gone.length === 1 ? "resource" : "resources"}`,
    lines: gone.slice(0, LIST_MAX),
    more: Math.max(0, gone.length - LIST_MAX),
    note: `From ${risk.tool} plan -destroy. ${plan}`,
  };
}

async function measureKubectl($, risk, cwd) {
  const scope = flagTokens(risk.flags, (name) => !KUBECTL_DELETE_ONLY.has(name));
  const argv = [risk.tool, "get", ...risk.targets, ...scope, "-o", "name"];
  const run = await $.process.run(argv, { cwd, timeoutMs: KUBE_TIMEOUT_MS });
  if (run.exitCode !== 0) {
    return { summary: `${risk.label} (could not list it)`, lines: [], note: `kubectl get failed: ${lastLine(run.stderr)}` };
  }
  const gone = run.stdout.split("\n").filter((l) => l !== "");
  const cascades = KUBE_NAMESPACE_KINDS.has(risk.targets[0]) || gone.some((l) => l.startsWith("namespace/"));
  return {
    summary: gone.length === 0 ? "delete nothing: no resource matches" : `delete ${gone.length} ${gone.length === 1 ? "resource" : "resources"}`,
    lines: gone.slice(0, LIST_MAX),
    more: Math.max(0, gone.length - LIST_MAX),
    note: cascades ? "A namespace delete also deletes every resource in it." : `From ${argv.join(" ")}.`,
  };
}

async function measureHelm($, risk, cwd) {
  if (risk.releases.length === 0) {
    return { summary: "helm uninstall with no release", lines: [], note: "No release names to look up." };
  }
  const scope = flagTokens(risk.flags, (name) => HELM_SCOPE_FLAGS.has(name));
  const gone = [];
  const missing = [];
  for (const release of risk.releases) {
    const run = await $.process.run([risk.tool, "get", "manifest", release, ...scope], { cwd, timeoutMs: KUBE_TIMEOUT_MS });
    if (run.exitCode === 0) {
      gone.push(...manifestResources(run.stdout));
    } else {
      missing.push(release);
    }
  }
  return {
    summary: `delete ${gone.length} ${gone.length === 1 ? "resource" : "resources"} in ${risk.releases.length - missing.length} ${risk.releases.length - missing.length === 1 ? "release" : "releases"}`,
    lines: gone.slice(0, LIST_MAX),
    more: Math.max(0, gone.length - LIST_MAX),
    note: missing.length > 0 ? `Couldn't read the manifest of: ${missing.join(" ")}.` : "From helm get manifest. Resources with helm.sh/resource-policy: keep stay.",
  };
}

/** kind/name for each document of a rendered Kubernetes manifest. */
export function manifestResources(manifest) {
  return manifest.split(/^---\s*$/m).flatMap((doc) => {
    const kind = doc.match(/^kind:\s*(\S+)/m)?.[1];
    const name = doc.match(/^metadata:\s*\n(?:[ \t]+.*\n)*?[ \t]+name:\s*["']?([^"'\s]+)/m)?.[1];
    return kind && name ? [`${kind.toLowerCase()}/${name}`] : [];
  });
}

function lastLine(text) {
  return text.trim().split("\n").pop()?.slice(0, 200) ?? "";
}

const MIGRATION_LISTERS = {
  django: { argv: ["python3", "manage.py", "showmigrations", "--plan"], pending: (l) => l.startsWith("[ ]"), strip: (l) => l.slice(4) },
  alembic: { argv: ["alembic", "history", "-r", "current:head"], pending: (l) => l.includes("->"), strip: (l) => l },
  rails: { argv: ["bin/rails", "db:migrate:status"], pending: (l) => /^\s*down\b/.test(l), strip: (l) => l.trim() },
  prisma: { argv: ["npx", "--no-install", "prisma", "migrate", "status"], pending: (l) => /^\s{2}\S/.test(l), strip: (l) => l.trim() },
};

async function measureMigrations($, risk, cwd) {
  const lister = MIGRATION_LISTERS[risk.tool];
  if (lister === undefined) {
    return { summary: "run migrations", lines: [], note: "I can't list the pending migrations for this tool, so the list is not shown." };
  }
  let run;
  try {
    run = await $.process.run(lister.argv, { cwd, timeoutMs: 20000 });
  } catch (error) {
    run = { exitCode: -1, stdout: "", stderr: String(error?.message ?? error) };
  }
  if (run.exitCode !== 0) {
    return { summary: `run ${risk.label}`, lines: [], note: `Couldn't list pending migrations (${lister.argv.join(" ")} failed).` };
  }
  const pending = run.stdout.split("\n").filter(lister.pending).map(lister.strip);
  return {
    summary: pending.length === 0 ? `run ${risk.label}: nothing pending` : `apply ${pending.length} pending ${pending.length === 1 ? "migration" : "migrations"}`,
    lines: pending.slice(0, LIST_MAX),
    more: Math.max(0, pending.length - LIST_MAX),
    note: `From ${lister.argv.join(" ")}.`,
  };
}

function size(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${bytes || 0} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = -1;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

// ---- Drawing --------------------------------------------------------------

// The pane shows the risky segment, not the whole command, and caps each text.
// A pane taller than its rows scrolls, and then ↑/↓ scroll instead of moving
// between the buttons. The pane width is not known here, so wrapped text gets
// a row for each TEXT_ROW_CHARS characters.
const SEGMENT_CHARS_MAX = 240;
const SUMMARY_CHARS_MAX = 120;
const NOTE_CHARS_MAX = 240;
const TEXT_ROW_CHARS = 80;
const FIXED_ROWS = 11; // border, title, labels, gaps, buttons, hint
const PANE_ROWS_MAX = 30;

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The report with its summary and note cut, so neither the pane nor the deny message grows. */
function clipReport(report) {
  return { ...report, summary: clip(report.summary, SUMMARY_CHARS_MAX), note: report.note && clip(report.note, NOTE_CHARS_MAX) };
}

function textRows(text) {
  return text ? Math.ceil(text.length / TEXT_ROW_CHARS) : 0;
}

function shownSegment(state) {
  return clip(state.risk.segment ?? state.command, SEGMENT_CHARS_MAX);
}

/** A line that says the segment is part of a longer command, or null. */
function commandContext(state) {
  const lineCount = state.command.split("\n").length;
  if (state.command.trim() === shownSegment(state)) {
    return null;
  }
  return lineCount > 1 ? `Part of a ${lineCount}-line command` : "Part of a longer command";
}

function paneRows(state) {
  const { report } = state;
  const textRowCount = textRows(shownSegment(state)) + textRows(report.summary) + textRows(report.note);
  return Math.min(PANE_ROWS_MAX, FIXED_ROWS + textRowCount + report.lines.length + (report.more ? 1 : 0));
}

function draw(t, state) {
  const { Box, Text, Button } = t;
  const { report } = state;
  const list = report.lines.map((line, i) => Text({ key: `l${i}`, children: `  ${line}`, wrap: "truncate-end" }));
  if (report.more) {
    list.push(Text({ key: "more", dimColor: true, children: `  + ${report.more} more` }));
  }
  // The buttons answer the call this pane was drawn for, never whichever one is held now.
  const decide = (choice) => () => {
    if (state.decision === null) {
      state.decision = choice;
    }
  };
  return Box({
    flexDirection: "column",
    borderStyle: "round",
    borderColor: "yellow",
    paddingX: 1,
    children: [
      Text({ key: "title", bold: true, color: "yellow", children: `⚠ Blast Radius · ${state.risk.label}` }),
      Text({ key: "cmd", dimColor: true, children: commandContext(state) ?? "Command" }),
      Text({ key: "cmd-text", bold: true, children: shownSegment(state), wrap: "wrap" }),
      Text({ key: "sum", children: [Text({ dimColor: true, children: "Would    " }), Text({ color: "red", bold: true, children: report.summary })], wrap: "wrap" }),
      Box({ key: "list", flexDirection: "column", marginTop: 1, children: list }),
      report.note ? Text({ key: "note", dimColor: true, italic: true, children: report.note, wrap: "wrap" }) : null,
      // One button per row, so ↑/↓ move between them; ←/→ belong to the engine.
      Box({
        key: "buttons",
        flexDirection: "column",
        marginTop: 1,
        children: [
          Button({ key: "proceed", label: "Proceed", hotkey: "1", plain: true, onPress: decide("proceed") }),
          Button({ key: "cancel", label: "Cancel", hotkey: "2", plain: true, autoFocus: true, onPress: decide("cancel") }),
        ],
      }),
      Text({ key: "hint", dimColor: true, children: "Claude is waiting on your answer · ↑/↓ and Enter, or 1/2" }),
    ],
  });
}
