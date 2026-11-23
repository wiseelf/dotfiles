#!/usr/bin/env bash
# List each handoff topic, each child, and the state of its report.
# Usage: handoff-status.sh [topic]
set -euo pipefail

readonly HANDOFF_ROOT="$HOME/.local/state/claude-handoffs"

report_state() {
  local report=$1
  [[ -f $report ]] || { echo "no report"; return; }
  head -n 1 "$report" | sed -n 's/^status: *//p' | grep . || echo "report has no status line"
}

show_topic() {
  local dir=$1 handoff slug
  echo "== $(basename "$dir")"
  for handoff in "$dir"/handoff-*.md; do
    [[ -e $handoff ]] || continue
    slug=$(basename "$handoff" .md)
    slug=${slug#handoff-}
    printf '  %-40s %s\n' "$slug" "$(report_state "$dir/report-$slug.md")"
  done
  [[ -f $dir/next-session.md ]] && echo "  next-session.md: $dir/next-session.md"
  return 0
}

main() {
  [[ $# -le 1 ]] || { echo "Usage: $0 [topic]" >&2; exit 2; }
  [[ -d $HANDOFF_ROOT ]] || { echo "No handoffs in $HANDOFF_ROOT."; exit 0; }
  if [[ $# -eq 1 ]]; then
    [[ -d $HANDOFF_ROOT/$1 ]] || { echo "Error: topic not found: $1" >&2; exit 1; }
    show_topic "$HANDOFF_ROOT/$1"
    return
  fi
  local dir
  for dir in "$HANDOFF_ROOT"/*/; do
    [[ -d $dir ]] && show_topic "${dir%/}"
  done
}

main "$@"
