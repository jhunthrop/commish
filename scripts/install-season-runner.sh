#!/bin/bash
# install-season-runner.sh -- puts the durable job runner under launchd and retires the crontab.
#
# Run: ./scripts/install-season-runner.sh              (installs for real)
#      ./scripts/install-season-runner.sh --print-only (prints what WOULD happen; writes nothing)
#
# REPLACES scripts/install-season-cron.sh. The three crontab entries became three code-defined
# schedules inside the job system (src/jobs/schedules.ts); what the machine needs now is ONE
# always-on process -- `npm run jobs:runner` -- which ticks those schedules with catch-up and
# works the queue. launchd, not cron, because launchd is what fixes the laptop-asleep hole at the
# process level: KeepAlive restarts the runner if it dies, RunAtLoad starts it at login, and the
# runner's own schedule cursors compute every fire sleep swallowed the moment it is back.
#
# TWO WRITES, BOTH GUARDED, in the old installer's corruption-proof discipline:
#
#   1. THE PLIST (~/Library/LaunchAgents/com.commish.jobs-runner.plist). Written fresh each
#      install, but NEVER over a file this script did not write: the managed-by marker below is
#      checked first, and a foreign file at that exact path refuses loudly. Nobody else has any
#      business at a path namespaced `com.commish.*`, so a foreign file there is a real anomaly
#      worth a human look, not something to silently replace.
#   2. THE CRONTAB (removal ONLY -- this script never adds cron lines). The old installer's
#      marker block is located with the SAME validation gate it had: exactly zero markers (fresh
#      machine, nothing to remove) or one balanced BEGIN/END pair is accepted; any other shape
#      refuses and writes NOTHING, because an unbalanced marker would make the strip eat
#      unrelated cron jobs. The belt-and-suspenders line count survives too.
#
# THE CHECKOUT THIS RUNS AGAINST IS THE MAIN ONE. Same reasoning as the old installer: launchd
# has no notion of a git worktree, and a runner pointed at a worktree dies when the worktree does.
# Until the job-system branch merges to main, `npm run jobs:runner` does not exist there and the
# agent will crash-loop under KeepAlive (throttled by launchd to one start per ThrottleInterval);
# that is expected and self-correcting the moment the branch lands -- do not install before then.
set -euo pipefail

MAIN_CHECKOUT="/Users/jh/code/fantasy"
LOG_DIR="$HOME/.commish/job-logs"
LABEL="com.commish.jobs-runner"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
PLIST_MARKER="managed by scripts/install-season-runner.sh -- do not edit by hand"

# The OLD cron installer's exact markers -- what this script removes.
MARKER_BEGIN="# BEGIN commish season-week cron (managed by scripts/install-season-cron.sh -- do not edit by hand)"
MARKER_END="# END commish season-week cron"

PRINT_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --print-only) PRINT_ONLY=true ;;
    *)
      echo "install-season-runner.sh: unknown flag '$arg' (only --print-only is recognised)" >&2
      exit 1
      ;;
  esac
done

# The plist. A login shell (-l) so npm resolves through the user's own profile (nvm and friends),
# exec so launchd tracks the real node process rather than a wrapper shell. AbandonProcessGroup
# stays unset: on stop, launchd tears the whole group down, tsx and node included.
PLIST_CONTENT=$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- $PLIST_MARKER -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-l</string>
    <string>-c</string>
    <string>cd $MAIN_CHECKOUT &amp;&amp; exec npm run jobs:runner</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$MAIN_CHECKOUT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/runner.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/runner.err.log</string>
</dict>
</plist>
EOF
)

# ---------- guard 1: the plist path must be ours or absent ----------
if [ -e "$PLIST_PATH" ] && ! grep -q -F "$PLIST_MARKER" "$PLIST_PATH"; then
  echo "install-season-runner.sh: REFUSING -- $PLIST_PATH exists and does not carry this" >&2
  echo "script's managed-by marker. It was not written by this installer; inspect it by hand," >&2
  echo "move it aside if it is stale, then re-run. Nothing was written." >&2
  exit 1
fi

# ---------- guard 2: the old crontab block, validated exactly as the old installer did ----------
EXISTING="$(crontab -l 2>/dev/null || true)"

line_count() {
  if [ -z "$1" ]; then
    printf '0\n'
  else
    printf '%s\n' "$1" | wc -l | tr -d ' '
  fi
}

refuse_crontab() {
  echo "install-season-runner.sh: REFUSING -- $1" >&2
  echo "" >&2
  echo "Found in the existing crontab (via \`crontab -l\`):" >&2
  echo "  $BEGIN_COUNT occurrence(s) of the BEGIN marker" >&2
  echo "  $END_COUNT occurrence(s) of the END marker" >&2
  echo "" >&2
  echo "Nothing was written. Fix or remove the stray marker line(s) so exactly zero or one" >&2
  echo "balanced BEGIN/END pair remains, then re-run. This refusal exists because an unbalanced" >&2
  echo "marker would make the strip silently drop unrelated cron jobs." >&2
  exit 1
}

BEGIN_COUNT="$(printf '%s\n' "$EXISTING" | grep -c -x -F "$MARKER_BEGIN" || true)"
END_COUNT="$(printf '%s\n' "$EXISTING" | grep -c -x -F "$MARKER_END" || true)"

CRON_ACTION="none"
if [ "$BEGIN_COUNT" -eq 0 ] && [ "$END_COUNT" -eq 0 ]; then
  CRON_ACTION="none" # fresh machine, or already migrated -- nothing to remove
elif [ "$BEGIN_COUNT" -eq 1 ] && [ "$END_COUNT" -eq 1 ]; then
  BEGIN_LINE="$(printf '%s\n' "$EXISTING" | grep -n -x -F "$MARKER_BEGIN" | head -1 | cut -d: -f1)"
  END_LINE="$(printf '%s\n' "$EXISTING" | grep -n -x -F "$MARKER_END" | head -1 | cut -d: -f1)"
  if [ "$BEGIN_LINE" -ge "$END_LINE" ]; then
    refuse_crontab "found one BEGIN and one END marker, but END (line $END_LINE) does not come after BEGIN (line $BEGIN_LINE) -- not a balanced pair."
  fi
  CRON_ACTION="strip"
else
  refuse_crontab "expected zero markers or exactly one balanced BEGIN/END pair, found $BEGIN_COUNT BEGIN marker(s) and $END_COUNT END marker(s)."
fi

STRIPPED="$EXISTING"
if [ "$CRON_ACTION" = "strip" ]; then
  ORIGINAL_TOTAL="$(line_count "$EXISTING")"
  ORIGINAL_NON_MARKER=$((ORIGINAL_TOTAL - (END_LINE - BEGIN_LINE + 1)))
  STRIPPED="$(printf '%s\n' "$EXISTING" | awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    skip { next }
    { print }
  ')"
  # Belt to the gate's suspenders (inherited from the old installer): the stripped non-marker
  # line count must never be lower than the original's.
  STRIPPED_NON_MARKER="$(line_count "$STRIPPED")"
  if [ "$STRIPPED_NON_MARKER" -lt "$ORIGINAL_NON_MARKER" ]; then
    echo "install-season-runner.sh: REFUSING -- the stripped crontab has fewer non-marker lines" >&2
    echo "($STRIPPED_NON_MARKER) than the original ($ORIGINAL_NON_MARKER). Something ate a line" >&2
    echo "that was not part of the old installer's marker block. Nothing was written." >&2
    exit 1
  fi
fi

# ---------- print-only ----------
if [ "$PRINT_ONLY" = true ]; then
  echo "install-season-runner.sh --print-only: nothing was written."
  echo ""
  echo "== plist that WOULD be written to $PLIST_PATH =="
  printf '%s\n' "$PLIST_CONTENT"
  echo ""
  if [ "$CRON_ACTION" = "strip" ]; then
    echo "== crontab AFTER removing the old season-week block (lines $BEGIN_LINE-$END_LINE) =="
    printf '%s\n' "$STRIPPED" | sed '/./,$!d'
  else
    echo "== crontab: no old season-week block found; it would be left untouched =="
  fi
  exit 0
fi

# ---------- install for real ----------
mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

# Stop a previous install of this same agent before rewriting its plist. bootout is idempotent
# in effect: a not-loaded agent just errors, which the `|| true` absorbs.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

printf '%s\n' "$PLIST_CONTENT" > "$PLIST_PATH"
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

if [ "$CRON_ACTION" = "strip" ]; then
  printf '%s\n' "$STRIPPED" | sed '/./,$!d' | crontab -
  echo "install-season-runner.sh: removed the old season-week cron block (verify with \`crontab -l\`)."
else
  echo "install-season-runner.sh: no old season-week cron block found; crontab untouched."
fi

echo "install-season-runner.sh: installed and started $LABEL."
echo "  status: launchctl print gui/$(id -u)/$LABEL | head -20"
echo "  logs:   tail -f $LOG_DIR/runner.log"
echo "  stop:   launchctl bootout gui/$(id -u)/$LABEL"
