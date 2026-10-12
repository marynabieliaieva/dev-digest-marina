#!/usr/bin/env bash
# scripts/check.sh — token-cheap typecheck + test runner for agents.
#
# Runs typecheck first (cheap, fails fast), then vitest with the `dot` reporter.
# The full output goes to .claude/tmp/check-<pkg>.log; stdout gets only the
# summary (and, on failure, the first errors). The exit code is preserved, so a
# Done-condition can be just this command.
#
# Usage (from the repo root):
#   scripts/check.sh <pkg> [options] [paths...]
#     pkg              client | server | reviewer-core | mcp
#     paths            test files/filters (relative to the package or to the
#                      repo root — a leading "<pkg>/" is stripped). Empty = the
#                      whole suite.
#   options
#     --related        treat paths as SOURCE files: `vitest related` runs only
#                      the tests that import them (0 tests = pass)
#     --it             server only: run the integration lane (*.it.test.ts)
#                      instead of the unit lane (needs Docker). Files run one at
#                      a time: in parallel the Docker probe times out and every
#                      suite skips silently. Exits 3 if zero tests executed or
#                      everything was skipped, so a skipped run never reads as green.
#     --no-typecheck   skip typecheck
#     --typecheck-only skip tests
#     --full           print the whole log instead of the summary
#
# Examples:
#   scripts/check.sh client src/lib/hooks/blast.test.ts
#   scripts/check.sh client --related src/lib/hooks/blast.ts
#   scripts/check.sh server test/blast-radius.test.ts
#   scripts/check.sh server --it test/blast-radius.it.test.ts
#   scripts/check.sh reviewer-core

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="${1:-}"
if [ -z "$PKG" ]; then
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
fi
shift

case "$PKG" in
  client|server) PM=pnpm; VITEST=(pnpm exec vitest) ;;
  reviewer-core|mcp) PM=npm; VITEST=(npx --no-install vitest) ;;
  *) echo "check.sh: unknown package '$PKG' (client | server | reviewer-core | mcp)" >&2; exit 2 ;;
esac

RELATED=0; IT=0; TYPECHECK=1; TESTS=1; FULL=0; PATHS=()
for arg in "$@"; do
  case "$arg" in
    --related) RELATED=1 ;;
    --it) IT=1 ;;
    --no-typecheck) TYPECHECK=0 ;;
    --typecheck-only) TESTS=0 ;;
    --full) FULL=1 ;;
    -*) echo "check.sh: unknown option '$arg'" >&2; exit 2 ;;
    *) PATHS+=("${arg#"$PKG"/}") ;;
  esac
done
if [ "$IT" = 1 ] && [ "$PKG" != server ]; then
  echo "check.sh: --it is only valid for server" >&2; exit 2
fi

LOG_DIR="$ROOT/.claude/tmp"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/check-$PKG.log"
: > "$LOG"
export NO_COLOR=1 FORCE_COLOR=0 CI=1

cd "$ROOT/$PKG" || { echo "check.sh: no such package dir $ROOT/$PKG" >&2; exit 2; }

# ---------- typecheck ----------
if [ "$TYPECHECK" = 1 ]; then
  echo "=== typecheck ($PKG) ===" >> "$LOG"
  "$PM" run typecheck >> "$LOG" 2>&1
  TC=$?
  if [ "$TC" != 0 ]; then
    COUNT="$(grep -c 'error TS' "$LOG" || true)"
    echo "TYPECHECK FAILED ($PKG): exit $TC, $COUNT error(s). First errors:"
    grep 'error TS' "$LOG" | head -n 30
    [ "$COUNT" = 0 ] && tail -n 30 "$LOG"
    echo "Full log: .claude/tmp/check-$PKG.log"
    exit "$TC"
  fi
  echo "typecheck ($PKG): ok"
fi

# ---------- tests ----------
if [ "$TESTS" = 1 ]; then
  ARGS=()
  if [ "$RELATED" = 1 ]; then
    [ "${#PATHS[@]}" = 0 ] && { echo "check.sh: --related needs source paths" >&2; exit 2; }
    ARGS=(related --run --passWithNoTests "${PATHS[@]}")
  else
    ARGS=(run "${PATHS[@]}")
  fi
  ARGS+=(--reporter=dot)
  if [ "$PKG" = server ]; then
    if [ "$IT" = 1 ]; then
      [ "${#PATHS[@]}" = 0 ] && ARGS+=(.it.test)
      ARGS+=(--no-file-parallelism)
    else
      ARGS+=(--exclude '**/*.it.test.ts')
    fi
  fi

  echo "=== vitest ${ARGS[*]} ===" >> "$LOG"
  "${VITEST[@]}" "${ARGS[@]}" >> "$LOG" 2>&1
  TS=$?

  # Integration lane: a green exit with nothing executed means the suites
  # skipped (Docker unreachable / probe timeout) — never report that as a pass.
  if [ "$IT" = 1 ] && [ "$TS" = 0 ]; then
    TESTS_LINE="$(grep -E '^[[:space:]]*Tests[[:space:]]' "$LOG" | tail -n 1)"
    PASSED="$(printf '%s' "$TESTS_LINE" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || true)"
    if [ -z "$PASSED" ] || [ "$PASSED" = 0 ]; then
      echo "INTEGRATION NOT RUN ($PKG): 0 tests executed — suites skipped (is Docker up?)"
      echo "  ${TESTS_LINE:-no Tests line in log}"
      echo "Full log: .claude/tmp/check-$PKG.log"
      exit 3
    fi
    SKIPPED="$(printf '%s' "$TESTS_LINE" | grep -oE '[0-9]+ skipped' | grep -oE '[0-9]+' || true)"
    [ -n "$SKIPPED" ] && [ "$SKIPPED" != 0 ] && \
      echo "WARNING ($PKG): $SKIPPED integration test(s) skipped — check whether Docker-dependent suites ran"
  fi

  if [ "$FULL" = 1 ]; then
    cat "$LOG"
  else
    if [ "$TS" != 0 ]; then
      echo "TESTS FAILED ($PKG): exit $TS"
      # vitest prints a "Failed Tests" block at the end; show it, capped.
      if grep -q 'Failed Tests\|FAIL ' "$LOG"; then
        sed -n '/Failed Tests\|FAIL /,$p' "$LOG" | head -n 80
      else
        tail -n 60 "$LOG"
      fi
    else
      grep -E '^[[:space:]]*(Test Files|Tests|Duration)[[:space:]]' "$LOG" | tail -n 3
    fi
  fi
  echo "Full log: .claude/tmp/check-$PKG.log"
  exit "$TS"
fi
exit 0
