#!/usr/bin/env bash
# Two-line Claude Code status line, ported from a ccstatusline layout —
# no Node.js/npx required, just bash + jq + git + curl.
#
# Line 1: Model: name | Thinking: effort | <branch icon><branch> | (+ins,-del)
# Line 2: Context: [bar] used/total (pct%) | Budget: [bar] $used/$limit | Cost: $x.xx | Skill: name
#
# The Budget segment shows real dollar figures for the monthly extra-usage
# (overage) budget. Claude Code's own statusLine JSON only exposes a
# used_percentage for that (no raw dollars), so this calls the same
# authenticated endpoint ccstatusline uses (api.anthropic.com/api/oauth/usage)
# with the local OAuth access token, and caches the response for
# CCS_CACHE_MAX_AGE seconds to keep every other render instant.
#
# First run on macOS: `security` will prompt once for Keychain access to the
# "Claude Code-credentials" item — click "Always Allow" so future renders
# don't stall waiting on a GUI prompt that a non-interactive statusline
# render can never answer.

input="$(cat)"

CYAN=$'\033[36m'
MAGENTA=$'\033[35m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
GREEN=$'\033[32m'
RESET=$'\033[0m'
BAR_WIDTH=16

CCS_CACHE_DIR="$HOME/.cache/ccstatusline-bash"
CCS_CACHE_FILE="$CCS_CACHE_DIR/usage.json"
CCS_CACHE_MAX_AGE=180
CCS_KEYCHAIN_TIMEOUT=3
CCS_CURL_TIMEOUT=3

get() { printf '%s' "$input" | jq -r "$1" 2>/dev/null; }

cwd=$(get '.workspace.current_dir // .cwd // empty')
transcript_path=$(get '.transcript_path // empty')
model_name=$(get '.model.display_name // empty')
effort_level=$(get '.effort.level // empty')
thinking_on=$(get '.thinking.enabled // false')
cost_usd=$(get '.cost.total_cost_usd // empty')
used_pct=$(get '.context_window.used_percentage // empty')
ctx_size=$(get '.context_window.context_window_size // 0')
cur_input=$(get '.context_window.current_usage.input_tokens // 0')
cache_create=$(get '.context_window.current_usage.cache_creation_input_tokens // 0')
cache_read=$(get '.context_window.current_usage.cache_read_input_tokens // 0')

make_bar() {
  local percent="${1:-0}" filled empty bar i
  filled=$(awk -v p="$percent" -v w="$BAR_WIDTH" 'BEGIN{v=(p/100)*w; if(v<0)v=0; if(v>w)v=w; printf "%d", v}')
  empty=$((BAR_WIDTH - filled))
  bar=""
  for ((i = 0; i < filled; i++)); do bar+="█"; done
  for ((i = 0; i < empty; i++)); do bar+="░"; done
  printf '%s' "$bar"
}

fmt_k() { awk -v v="${1:-0}" 'BEGIN{ if (v>=1000000) printf "%.1fM", v/1000000; else if (v>=1000) printf "%.0fk", v/1000; else printf "%d", v }'; }

# --- Skill: last Skill-tool invocation from this session's transcript ---
skill_name="none"
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  found=$(tail -n 3000 "$transcript_path" 2>/dev/null | jq -rs '
    [ .[]? | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Skill") | .input.skill ]
    | last // empty
  ' 2>/dev/null)
  [ -n "$found" ] && [ "$found" != "null" ] && skill_name="$found"
fi

# --- Budget: monthly extra-usage (overage) spend, in real dollars ---
security_read_token() {
  local tmp; tmp="$(mktemp)"
  ( security find-generic-password -s "Claude Code-credentials" -w >"$tmp" 2>/dev/null ) &
  local pid=$!
  ( sleep "$CCS_KEYCHAIN_TIMEOUT"; kill -9 "$pid" 2>/dev/null ) &
  local watcher=$!
  wait "$pid" 2>/dev/null
  kill -9 "$watcher" 2>/dev/null
  cat "$tmp" 2>/dev/null
  rm -f "$tmp"
}

get_access_token() {
  local raw=""
  if [ "$(uname)" = "Darwin" ]; then
    raw=$(security_read_token)
  fi
  if [ -z "$raw" ]; then
    local cred_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json"
    [ -f "$cred_file" ] && raw=$(cat "$cred_file" 2>/dev/null)
  fi
  [ -z "$raw" ] && return 1
  printf '%s' "$raw" | jq -r '.claudeAiOauth.accessToken // empty'
}

cache_age_seconds() {
  [ -f "$CCS_CACHE_FILE" ] || { echo 999999; return; }
  local mtime now
  mtime=$(stat -f %m "$CCS_CACHE_FILE" 2>/dev/null || stat -c %Y "$CCS_CACHE_FILE" 2>/dev/null)
  now=$(date +%s)
  echo $((now - mtime))
}

refresh_usage_cache() {
  local token; token=$(get_access_token)
  [ -z "$token" ] && return 1
  local body
  body=$(curl -sS --max-time "$CCS_CURL_TIMEOUT" \
    -H "Authorization: Bearer $token" \
    -H "anthropic-beta: oauth-2025-04-20" \
    "https://api.anthropic.com/api/oauth/usage" 2>/dev/null)
  [ -z "$body" ] && return 1
  printf '%s' "$body" | jq -e '.extra_usage' >/dev/null 2>&1 || return 1
  mkdir -p "$CCS_CACHE_DIR"
  printf '%s' "$body" >"$CCS_CACHE_FILE"
}

if [ "$(cache_age_seconds)" -ge "$CCS_CACHE_MAX_AGE" ]; then
  refresh_usage_cache
fi

budget_enabled="false"
budget_used_cents=""
budget_limit_cents=""
if [ -f "$CCS_CACHE_FILE" ]; then
  usage_json=$(cat "$CCS_CACHE_FILE")
  budget_enabled=$(printf '%s' "$usage_json" | jq -r '.extra_usage.is_enabled // false')
  budget_used_cents=$(printf '%s' "$usage_json" | jq -r '.extra_usage.used_credits // empty')
  budget_limit_cents=$(printf '%s' "$usage_json" | jq -r '.extra_usage.monthly_limit // empty')
fi

line1=()
[ -n "$model_name" ] && line1+=("${CYAN}Model: ${model_name}${RESET}")
if [ -n "$effort_level" ]; then
  line1+=("${CYAN}Thinking: ${effort_level}${RESET}")
elif [ "$thinking_on" = "true" ]; then
  line1+=("${CYAN}Thinking: on${RESET}")
fi

branch=""
insertions=""
deletions=""
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --is-inside-work-tree &>/dev/null; then
  branch=$(git -C "$cwd" branch --show-current 2>/dev/null)
  gitstat=$(git -C "$cwd" diff --shortstat HEAD 2>/dev/null)
  insertions=$(printf '%s' "$gitstat" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+')
  deletions=$(printf '%s' "$gitstat" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+')
fi
[ -n "$branch" ] && line1+=("${MAGENTA}⎇${branch}${RESET}")
[ -n "$branch" ] && line1+=("${YELLOW}(+${insertions:-0},-${deletions:-0})${RESET}")

line2=()
if [ -n "$used_pct" ]; then
  bar=$(make_bar "$used_pct")
  pct_rounded=$(awk -v p="$used_pct" 'BEGIN{printf "%.0f", p}')
  used_k=$(fmt_k "$((cur_input + cache_create + cache_read))")
  total_k=$(fmt_k "$ctx_size")
  line2+=("${BLUE}Context: [${bar}] ${used_k}/${total_k} (${pct_rounded}%)${RESET}")
fi

if [ "$budget_enabled" = "true" ] && [ -n "$budget_used_cents" ] && [ -n "$budget_limit_cents" ] && [ "$budget_limit_cents" != "null" ]; then
  budget_pct=$(awk -v u="$budget_used_cents" -v l="$budget_limit_cents" 'BEGIN{ if (l>0) printf "%.0f", (u/l)*100; else print 0 }')
  bar=$(make_bar "$budget_pct")
  used_dollars=$(awk -v c="$budget_used_cents" 'BEGIN{printf "%.2f", c/100}')
  limit_dollars=$(awk -v c="$budget_limit_cents" 'BEGIN{printf "%.2f", c/100}')
  line2+=("${YELLOW}Budget: [${bar}] \$${used_dollars}/\$${limit_dollars}${RESET}")
fi

[ -n "$cost_usd" ] && line2+=("${GREEN}Cost: $(awk -v c="$cost_usd" 'BEGIN{printf "$%.2f", c}')${RESET}")

line2+=("${MAGENTA}Skill: ${skill_name}${RESET}")

out1=""
for i in "${!line1[@]}"; do
  [ "$i" -gt 0 ] && out1+=" | "
  out1+="${line1[$i]}"
done

out2=""
for i in "${!line2[@]}"; do
  [ "$i" -gt 0 ] && out2+=" | "
  out2+="${line2[$i]}"
done

printf '%s\n%s' "$out1" "$out2"
