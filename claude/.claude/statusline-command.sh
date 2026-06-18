#!/usr/bin/env bash
# Claude Code status line — mirrors the Starship prompt from ~/.config/starship.toml
# (catppuccin_mocha palette, dimmed-terminal friendly)

input=$(cat)

cwd=$(echo "$input"       | jq -r '.workspace.current_dir // .cwd // empty')
git_worktree=$(echo "$input" | jq -r '.workspace.git_worktree // empty')
repo_owner=$(echo "$input"   | jq -r '.workspace.repo.owner // empty')
repo_name=$(echo "$input"    | jq -r '.workspace.repo.name // empty')
model_name=$(echo "$input"   | jq -r '.model.display_name // empty')
used_pct=$(echo "$input"     | jq -r '.context_window.used_percentage // empty')
ctx_size=$(echo "$input"     | jq -r '.context_window.context_window_size // 0')
cur_input=$(echo "$input"    | jq -r '.context_window.current_usage.input_tokens // 0')
five_pct=$(echo "$input"     | jq -r '.rate_limits.five_hour.used_percentage // empty')
week_pct=$(echo "$input"     | jq -r '.rate_limits.seven_day.used_percentage // empty')

# --- catppuccin_mocha ANSI approximations ---
BLUE='\033[38;2;137;180;250m'    # blue   #89b4fa
GREEN='\033[38;2;166;227;161m'   # green  #a6e3a1
YELLOW='\033[38;2;249;226;175m'  # yellow #f9e2af
MAUVE='\033[38;2;203;166;247m'   # mauve  #cba6f7
OVERLAY='\033[38;2;127;132;156m' # overlay1 #7f849c
TEAL='\033[38;2;148;226;213m'    # teal   #94e2d5
DIM='\033[2m'
RESET='\033[0m'

parts=()

# --- Directory (truncation_length=15, truncation_symbol=".../"") ---
if [ -n "$cwd" ]; then
  home_replaced="${cwd/#$HOME/\~}"
  IFS='/' read -ra parts_path <<< "$home_replaced"
  total=${#parts_path[@]}
  if [ "$total" -gt 15 ]; then
    dir_display=".../"
    start=$((total - 15))
    for (( i=start; i<total; i++ )); do
      dir_display="${dir_display}${parts_path[$i]}"
      [ "$i" -lt $((total - 1)) ] && dir_display="${dir_display}/"
    done
  else
    dir_display="$home_replaced"
  fi
  parts+=("$(printf "${BLUE}%s${RESET}" "$dir_display")")
fi

# --- Git branch (worktree name takes precedence; otherwise live git query) ---
# Starship ignores master/main per [git_branch] ignore_branches config
branch_display=""
if [ -n "$git_worktree" ]; then
  branch_display="$git_worktree"
elif [ -n "$cwd" ]; then
  current_branch=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)
  if [ -n "$current_branch" ] && [ "$current_branch" != "master" ] && [ "$current_branch" != "main" ]; then
    branch_display="$current_branch"
  fi
fi
[ -n "$branch_display" ] && parts+=("$(printf "${GREEN} %s${RESET}" "$branch_display")")

# --- Repo identity owner/name ---
if [ -n "$repo_owner" ] && [ -n "$repo_name" ]; then
  parts+=("$(printf "${OVERLAY}%s/%s${RESET}" "$repo_owner" "$repo_name")")
fi

# --- Model ---
[ -n "$model_name" ] && parts+=("$(printf "${MAUVE}%s${RESET}" "$model_name")")

# --- Context window usage bar ---
fmt_k() { awk "BEGIN { v=$1; if (v >= 1000) printf \"%.0fk\", v/1000; else printf \"%d\", v }"; }

if [ -n "$used_pct" ]; then
  bar_width=8
  filled=$(awk "BEGIN { printf \"%d\", ($used_pct / 100) * $bar_width }")
  empty=$((bar_width - filled))
  bar=""
  for ((i=0; i<filled; i++)); do bar="${bar}█"; done
  for ((i=0; i<empty; i++)); do bar="${bar}░"; done
  if [ "$ctx_size" -gt 0 ] 2>/dev/null; then
    used_k=$(fmt_k "$cur_input")
    total_k=$(fmt_k "$ctx_size")
    parts+=("$(printf "${TEAL}ctx[%s] %.0f%% ${DIM}(%s/%s)${RESET}" "$bar" "$used_pct" "$used_k" "$total_k")")
  else
    parts+=("$(printf "${TEAL}ctx[%s] %.0f%%${RESET}" "$bar" "$used_pct")")
  fi
fi

# --- Claude.ai subscription rate limits (when present) ---
fmt_resets_date() {
  local epoch="$1"
  [ -z "$epoch" ] && return
  date -r "$epoch" "+%b %-d" 2>/dev/null || date -d "@$epoch" "+%b %-d" 2>/dev/null
}

five_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
week_resets=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

if [ -n "$five_pct" ]; then
  resets_label=""
  [ -n "$five_resets" ] && { rd=$(fmt_resets_date "$five_resets"); [ -n "$rd" ] && resets_label=" resets $rd"; }
  parts+=("$(printf "${YELLOW}5h:%.0f%%%s${RESET}" "$five_pct" "$resets_label")")
fi

if [ -n "$week_pct" ]; then
  resets_label=""
  [ -n "$week_resets" ] && { rd=$(fmt_resets_date "$week_resets"); [ -n "$rd" ] && resets_label=" resets $rd"; }
  parts+=("$(printf "${YELLOW}7d:%.0f%%%s${RESET}" "$week_pct" "$resets_label")")
fi

printf '%b' "$(IFS=' | '; echo "${parts[*]}")"
