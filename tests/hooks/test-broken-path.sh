#!/usr/bin/env bash
# Broken-PATH SessionStart regression (upstream superpowers #2310/#2349, v7.0.0):
# Claude Code can spawn SessionStart:startup hooks with a broken/empty PATH
# (anthropics/claude-code#43127). bash itself is invoked by absolute path, so
# hooks/session-start and run-hook.cmd's Unix half must reach the bootstrap
# using builtins only. bd is not on such a PATH, so the beads side is simply
# absent — the bootstrap must still be injected.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$ROOT/hooks/session-start"
WRAPPER="$ROOT/hooks/run-hook.cmd"
BASH_BIN="$(command -v bash)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/home" "$TMP/run"
fails=0
pass() { echo "  [PASS] $1"; }
fail() { echo "  [FAIL] $1"; fails=$((fails + 1)); }

# check DESC PATHVALUE CMD... — hook must exit 0 and emit nested JSON with the bootstrap.
check() {
    local desc="$1" pathv="$2" out rc
    shift 2
    out=$(env -i PATH="$pathv" HOME="$TMP/home" XDG_RUNTIME_DIR="$TMP/run" \
        CLAUDE_PLUGIN_ROOT="$ROOT" "$@" </dev/null 2>/dev/null); rc=$?
    if [ "$rc" -eq 0 ] \
        && [[ "$out" == *'"hookEventName": "SessionStart"'* ]] \
        && [[ "$out" == *'You have beads-superpowers.'* ]] \
        && [[ "$out" == *'name: using-superpowers'* ]] \
        && [[ "$out" != *'skill unreadable'* ]]; then
        pass "$desc"
    else
        fail "$desc (rc=$rc)"; printf '%s\n' "$out" | head -5 | sed 's/^/      /'
    fi
}

echo "SessionStart broken-PATH tests"
check "session-start with empty PATH still injects the bootstrap" "" "$BASH_BIN" "$HOOK"
check "run-hook.cmd with empty PATH still dispatches session-start" "" "$BASH_BIN" "$WRAPPER" session-start
check "session-start run by bare filename from hooks/ resolves the plugin root" "" \
    "$BASH_BIN" -c 'cd "$1" && exec "$2" session-start' _ "$ROOT/hooks" "$BASH_BIN"
check "run-hook.cmd run by bare filename from hooks/ dispatches session-start" "" \
    "$BASH_BIN" -c 'cd "$1" && exec "$2" run-hook.cmd session-start' _ "$ROOT/hooks" "$BASH_BIN"

# run-hook.cmd's Windows half starts bash with a backslash path, so $0 can use \.
bs="$TMP/backslash"; mkdir -p "$bs"
ln -s "$ROOT/hooks" "$bs/hooks"; ln -s "$ROOT/skills" "$bs/skills"
ln -s "$ROOT/hooks/session-start" "$bs/hooks\\session-start"
check "session-start reached through a backslash path still reads the skill" "" \
    "$BASH_BIN" -c 'cd "$1" && exec "$2" "$3"' _ "$bs" "$BASH_BIN" 'hooks\session-start'

# When cat is on PATH the JSON still goes through it (absorbs EPIPE on Windows, #1612).
stub="$TMP/cat-stub"; marker="$TMP/cat-used"; mkdir -p "$stub"
printf '#!%s\n: > "%s"\nexec /bin/cat "$@"\n' "$BASH_BIN" "$marker" > "$stub/cat"; chmod +x "$stub/cat"
check "session-start with only cat on PATH injects the bootstrap" "$stub" "$BASH_BIN" "$HOOK"
if [ -f "$marker" ]; then pass "session-start pipes its JSON through cat when cat is on PATH"
else fail "session-start pipes its JSON through cat when cat is on PATH"; fi

[ "$fails" -eq 0 ] || { echo "STATUS: FAILED ($fails)"; exit 1; }
echo "STATUS: PASSED"
