#!/usr/bin/env bash
# Print the tmux session name for a project folder. `cs` and the fork-task skill use it.
# The name is the folder name. If a session with that name has a different folder, the parent folder name goes first.
# Usage: session-name.sh <absolute-dir>
set -euo pipefail

[[ $# -eq 1 ]] || { echo "Usage: $0 <absolute-dir>" >&2; exit 2; }
dir=$1

# tmux does not accept '.' or ':' in a session name.
sanitize() { local value=$1; echo "${value//[.:]/_}"; }

name=$(sanitize "$(basename "$dir")")
existing_path=$(tmux display-message -p -t "=$name:" '#{session_path}' 2>/dev/null || true)
if [[ -n $existing_path && $existing_path != "$dir" ]]; then
  name="$(sanitize "$(basename "$(dirname "$dir")")")-$name"
fi
echo "$name"
