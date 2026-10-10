#!/usr/bin/env bash
# scripts/arch-check.sh — deterministic pre-pass for the architecture-reviewer agent.
#
# Greps the mechanically checkable boundary rules (rule ids match
# .claude/agents/architecture-reviewer.md) so the agent only has to confirm and
# judge hits instead of reading every file. Read-only; never edits anything.
#
# Usage (from the repo root):
#   scripts/arch-check.sh                 # diff mode: merge-base(main) vs working tree + untracked
#   scripts/arch-check.sh --base <ref>    # diff mode against another base
#   scripts/arch-check.sh -- <paths...>   # audit mode: every line of the named files/dirs
#
# Output, one hit per line:   <NEW|OLD> <rule> <file>:<line>: <source line>
#   NEW = the line is added/changed by the diff (a finding candidate)
#   OLD = pre-existing line in a touched file (context only, never a finding)
#   In audit mode every hit is NEW.
# Not covered (needs judgment, the agent checks these by reading): A5, F1–F4, X3 nuances.
# Exit code: 0 always (hits are evidence, not a verdict).

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE=main; AUDIT=0; TARGETS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --) shift; AUDIT=1; TARGETS=("$@"); break ;;
    *) echo "arch-check.sh: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FILES="$TMP/files"; ADDED="$TMP/added"
: > "$ADDED"

if [ "$AUDIT" = 1 ]; then
  git ls-files -co --exclude-standard -- "${TARGETS[@]}" > "$FILES"
else
  MB="$(git merge-base "$BASE" HEAD)" || { echo "arch-check.sh: no merge-base with $BASE" >&2; exit 2; }
  echo "# scope: diff vs merge-base $MB ($BASE) + uncommitted + untracked"
  { git diff --name-only --diff-filter=d "$MB" 2>/dev/null; git ls-files -o --exclude-standard; } | sort -u > "$FILES"
  # Added line numbers per tracked file: "<file>:<line>"
  git diff -U0 --diff-filter=d "$MB" 2>/dev/null | awk '
    /^\+\+\+ b\// { f = substr($0, 7); next }
    /^@@/ {
      split($3, a, ","); start = substr(a[1], 2); n = (a[2] == "" ? 1 : a[2]);
      for (i = 0; i < n; i++) print f ":" (start + i)
    }' > "$ADDED"
  # Untracked files: every line is new.
  git ls-files -o --exclude-standard | while read -r f; do
    [ -f "$f" ] && awk -v f="$f" '{ print f ":" NR }' "$f" >> "$ADDED"
  done
fi

mark() { # rule, then grep -Hn lines on stdin
  local rule="$1"
  while IFS= read -r hit; do
    local loc="${hit%%:*}"; local rest="${hit#*:}"; local ln="${rest%%:*}"; local src="${rest#*:}"
    local tag=NEW
    if [ "$AUDIT" = 0 ] && ! grep -qxF "$loc:$ln" "$ADDED"; then tag=OLD; fi
    printf '%s %s %s:%s: %s\n' "$tag" "$rule" "$loc" "$ln" "$(echo "$src" | sed 's/^[[:space:]]*//')"
  done
}
only() { grep -E "$1" "$FILES" | grep -vE '^server/src/db/migrations/' || true; }
scan() { # rule, file-regex, line-regex
  local list; list="$(only "$2")"
  [ -z "$list" ] && return
  # shellcheck disable=SC2086
  echo "$list" | tr '\n' '\0' | xargs -0 grep -HnE "$3" 2>/dev/null | mark "$1"
}

IMPORT="(from|import\(|require\()[[:space:]]*['\"]"

scan A1 '^server/src/modules/[^/]+/routes\.ts$'     "${IMPORT}(drizzle-orm|postgres)['\"/]"
scan A2 '^server/src/modules/[^/]+/service\.ts$'    "${IMPORT}(octokit|@octokit/[a-z-]+|openai|@anthropic-ai/sdk|simple-git)['\"/]"
scan A3 '^server/src/modules/[^/]+/(service|routes|helpers)\.ts$' "${IMPORT}[^'\"]*db/(client|schema)"
scan A4 '^server/src/modules/[^/]+/service\.ts$'    '\$infer(Select|Insert)'
scan A6 '^server/src/modules/[^/]+/(service|routes)\.ts$' 'new[[:space:]]+(Octokit|OpenAI|Anthropic|SimpleGit)\b'
scan A6 '^server/src/vendor/shared/contracts/.*\.ts$' "${IMPORT}[^'\"]*(server/|client/|/modules/|/db/|/platform/)"
scan X1 '^reviewer-core/src/.*\.ts$'                "${IMPORT}(drizzle-orm|postgres|octokit|@octokit/[a-z-]+|simple-git|node:fs|fs|fs/promises|node:fs/promises)['\"/]"
scan X2 '^(server|client|reviewer-core|e2e|mcp)/.*\.(ts|tsx)$' "${IMPORT}(\.\./)+(server|client|reviewer-core|e2e|mcp)/"
scan X3 '^server/src/vendor/shared/.*\.ts$'         "${IMPORT}[^'\"]*(/modules/|/db/|/platform/|/adapters/|client/)"

# B1: module files must be role-named.
only '^server/src/modules/[^/]+/[^/]+\.ts$' \
  | grep -vE '^server/src/modules/_shared/|\.test\.ts$|/(routes|service|repository|helpers|constants)\.ts$' \
  | while read -r f; do echo "NEW B1 $f:1: file is not role-named (routes|service|repository|helpers|constants)"; done

if [ "$AUDIT" = 0 ]; then
  # D1: modified/deleted existing migrations (added ones are fine).
  git diff --name-status "$MB" 2>/dev/null -- server/src/db/migrations | awk '$1 ~ /^[MDR]/ { print "NEW D1 " $NF ":1: existing migration " ($1 ~ /^D/ ? "deleted" : "modified") }'
  # D2: lock file changed without its package.json.
  for pair in server/pnpm-lock.yaml:server client/pnpm-lock.yaml:client reviewer-core/package-lock.json:reviewer-core e2e/package-lock.json:e2e; do
    lock="${pair%%:*}"; pkg="${pair##*:}"
    if grep -qxF "$lock" "$FILES" && ! grep -qxF "$pkg/package.json" "$FILES"; then
      echo "NEW D2 $lock:1: lock file changed without $pkg/package.json"
    fi
  done
fi

if [ -f server/.dependency-cruiser.js ]; then
  echo "# server/.dependency-cruiser.js exists — also run: cd server && pnpm exec depcruise src --validate .dependency-cruiser.js"
fi
echo "# done: $(wc -l < "$FILES" | tr -d ' ') file(s) in scope"
