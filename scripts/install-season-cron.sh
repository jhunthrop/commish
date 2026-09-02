#!/bin/bash
# install-season-cron.sh -- installs the weekly cadence's three crontab entries.
#
# Run: ./scripts/install-season-cron.sh            (installs for real)
#      ./scripts/install-season-cron.sh --print-only (prints what WOULD be installed; writes nothing)
#
# IDEMPOTENT BY MARKER BLOCK. Every entry this script writes sits between BEGIN/END marker
# comments; a re-run finds and replaces ONLY that block, leaving every other line already in the
# user's crontab (their own cron jobs, anything else's) untouched. A naive `crontab file` install
# would instead need to be the one true source of the whole crontab, which this repo has no
# business being.
#
# THREE PASSES, NOT ONE, because the register's own freeze/grade cadence has three different
# things it needs a chance to catch, and one weekly run cannot catch all three:
#
#   1. TUESDAY MORNING (08:00, assumed America/New_York) -- the data pass that follows a full
#      week of games. Sunday's late/SNF/MNF-adjacent corrections and Monday Night Football's own
#      final stats are both settled by Tuesday morning, so this is the first `npm run season:week`
#      that can grade the week just played (`stats-ingest` catches nflverse's newly published
#      file; `grade` catches every ungraded frozen week that now has outcomes).
#   2. WEDNESDAY EVENING (18:00) -- a second data pass, primarily for the props snapshot: lines
#      firm up over the week as books post more markets and move off preseason-style openers, so a
#      mid-week refresh catches props week 1's Thursday freeze would otherwise have missed if it
#      only ever ran once, right before kickoff.
#   3. THURSDAY AFTERNOON (14:00) -- the pass sized to land the week's freeze. Every kickoff this
#      season's schedule carries lands late Thursday (the store's own `kickoffInstantsByWeek`
#      rows are consistently ~00:20Z, i.e. Thursday evening Eastern), so 14:00 leaves several
#      hours of margin before the week's first game -- comfortably clear of the strictly-before-
#      kickoff refusal `takeFreeze` enforces, while late enough that Wednesday evening's own props
#      refresh has already landed.
#
# All three run the SAME command (`npm run season:week`, no flags): every step it runs is already
# idempotent-or-skip (stats-ingest and the props snapshot are naturally idempotent; grade skips
# anything already graded; freeze skips anything already frozen for the week). Running it three
# times a week costs nothing extra on a week where the first pass already caught everything, and
# costs exactly one real freeze on the week it has not been taken yet -- whichever of the three
# passes gets there first.
#
# THE CHECKOUT THIS RUNS AGAINST IS THE MAIN ONE, NOT THIS WORKTREE. `MAIN_CHECKOUT` below is
# hardcoded to /Users/jh/code/fantasy, the repository's main working copy -- crontab has no notion
# of a git worktree, and a cron job pointed at this worktree would stop working the moment the
# worktree is removed after this branch merges. Until Task 2 merges to main, `npm run season:week`
# does not exist there yet, and the installed cron entries WILL FAIL (exit 127, "missing script:
# season:week") every time they fire -- that is expected and self-correcting the moment this
# branch lands on main; it is not a sign the install itself is broken.
#
# TIMES ASSUME THE CRONTAB RUNS IN AMERICA/NEW_YORK. Vixie cron (what ships on macOS, and most
# Linux distributions) has no per-line CRON_TZ, unlike some newer cron implementations -- the
# whole crontab runs in one timezone, normally the system's own. If this host's system timezone is
# not America/New_York, or the clock crosses a DST boundary that matters to the exact minute (it
# does not here -- every window above carries hours of slack), adjust the hours below by hand.
set -euo pipefail

MAIN_CHECKOUT="/Users/jh/code/fantasy"
LOG_DIR="$HOME/.commish/season-logs"
MARKER_BEGIN="# BEGIN commish season-week cron (managed by scripts/install-season-cron.sh -- do not edit by hand)"
MARKER_END="# END commish season-week cron"

PRINT_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --print-only)
      PRINT_ONLY=true
      ;;
    *)
      echo "install-season-cron.sh: unknown flag '$arg' (only --print-only is recognised)" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$LOG_DIR"

# Unquoted heredoc: $MAIN_CHECKOUT and $LOG_DIR expand NOW, at install time. The two escaped forms
# -- \$(date ...) and \% -- must NOT expand now; they are cron's own syntax, evaluated fresh every
# time each entry fires, and have to reach the installed crontab file literally.
NEW_BLOCK=$(cat <<EOF
$MARKER_BEGIN
0 8 * * 2 cd $MAIN_CHECKOUT && npm run season:week >> $LOG_DIR/\$(date +\%Y-\%m-\%d)-tue-data.log 2>&1
0 18 * * 3 cd $MAIN_CHECKOUT && npm run season:week >> $LOG_DIR/\$(date +\%Y-\%m-\%d)-wed-data.log 2>&1
0 14 * * 4 cd $MAIN_CHECKOUT && npm run season:week >> $LOG_DIR/\$(date +\%Y-\%m-\%d)-thu-freeze.log 2>&1
$MARKER_END
EOF
)

EXISTING="$(crontab -l 2>/dev/null || true)"

# Lines in a string, treating an empty string as ZERO lines (a bare `wc -l` on `printf '%s\n' ""`
# would otherwise count the one blank line printf itself produces -- this is what lets every count
# below agree with "the crontab has nothing in it" rather than off-by-one on the empty case).
line_count() {
  if [ -z "$1" ]; then
    printf '0\n'
  else
    printf '%s\n' "$1" | wc -l | tr -d ' '
  fi
}

refuse() {
  echo "install-season-cron.sh: REFUSING -- $1" >&2
  echo "" >&2
  echo "Found in the existing crontab (via \`crontab -l\`):" >&2
  echo "  $BEGIN_COUNT occurrence(s) of the BEGIN marker" >&2
  echo "  $END_COUNT occurrence(s) of the END marker" >&2
  echo "" >&2
  echo "The markers are:" >&2
  echo "  BEGIN: $MARKER_BEGIN" >&2
  echo "  END:   $MARKER_END" >&2
  echo "" >&2
  echo "Nothing was written. Inspect the crontab by hand (\`crontab -l\`), fix or remove the stray" >&2
  echo "marker line(s) so exactly zero or one balanced BEGIN/END pair remains, then re-run this" >&2
  echo "script. This refusal exists because an unbalanced marker would otherwise make the strip" >&2
  echo "logic below silently drop every line after a BEGIN with no matching END -- including any" >&2
  echo "unrelated cron jobs already installed." >&2
  exit 1
}

# THE VALIDATION GATE (fix round 1, HIGH). Before anything below touches $EXISTING, the marker
# structure it carries must be one of exactly two shapes: no markers at all (a fresh install), or
# one balanced BEGIN-then-END pair (a prior install of this same script, safe to replace). Every
# other shape -- a BEGIN with no END, an END with no BEGIN, two BEGINs, or a pair in the wrong
# order -- refuses LOUDLY and writes NOTHING, rather than feeding an awk strip that has no way to
# tell "no matching END yet" apart from "matching END never comes" and would skip-and-drop every
# line for the rest of the file, unrelated cron jobs included.
BEGIN_COUNT="$(printf '%s\n' "$EXISTING" | grep -c -x -F "$MARKER_BEGIN" || true)"
END_COUNT="$(printf '%s\n' "$EXISTING" | grep -c -x -F "$MARKER_END" || true)"

if [ "$BEGIN_COUNT" -eq 0 ] && [ "$END_COUNT" -eq 0 ]; then
  : # no prior install -- nothing to validate further, proceed
elif [ "$BEGIN_COUNT" -eq 1 ] && [ "$END_COUNT" -eq 1 ]; then
  BEGIN_LINE="$(printf '%s\n' "$EXISTING" | grep -n -x -F "$MARKER_BEGIN" | head -1 | cut -d: -f1)"
  END_LINE="$(printf '%s\n' "$EXISTING" | grep -n -x -F "$MARKER_END" | head -1 | cut -d: -f1)"
  if [ "$BEGIN_LINE" -ge "$END_LINE" ]; then
    refuse "found one BEGIN and one END marker, but END (line $END_LINE) does not come after BEGIN (line $BEGIN_LINE) -- not a balanced pair."
  fi
else
  refuse "expected zero markers or exactly one balanced BEGIN/END pair, found $BEGIN_COUNT BEGIN marker(s) and $END_COUNT END marker(s)."
fi

# Original non-marker-block line count, computed from the VALIDATED structure above (so this is
# exact, not a guess): every line outside the one balanced pair, if there is one, else every line.
ORIGINAL_TOTAL="$(line_count "$EXISTING")"
if [ "$BEGIN_COUNT" -eq 1 ] && [ "$END_COUNT" -eq 1 ]; then
  ORIGINAL_NON_MARKER=$((ORIGINAL_TOTAL - (END_LINE - BEGIN_LINE + 1)))
else
  ORIGINAL_NON_MARKER="$ORIGINAL_TOTAL"
fi

# Strips any prior install of this script's own block (between the markers, inclusive), leaving
# every other line of the user's crontab exactly as it was. Safe now: the gate above guarantees at
# most one BEGIN and at most one END, in order, so `skip` turns on at most once and off at most
# once -- it can no longer run to the end of the file stuck on.
STRIPPED="$(printf '%s\n' "$EXISTING" | awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  skip { next }
  { print }
')"

# THE BELT TO THE GATE'S SUSPENDERS (fix round 1, HIGH, part b). Even though the gate above proves
# the strip is safe, this checks its actual OUTPUT rather than trusting the proof: the stripped
# non-marker line count must be at least the original's. It can go up (a fresh install adds
# nothing here, but nothing stops one that legitimately does), it must never go down -- a drop
# would mean some non-marker line got eaten, and that is refused rather than installed.
STRIPPED_NON_MARKER="$(line_count "$STRIPPED")"
if [ "$STRIPPED_NON_MARKER" -lt "$ORIGINAL_NON_MARKER" ]; then
  echo "install-season-cron.sh: REFUSING -- the stripped crontab has fewer non-marker lines" >&2
  echo "($STRIPPED_NON_MARKER) than the original ($ORIGINAL_NON_MARKER). Something ate a line that" >&2
  echo "was not part of this script's own marker block. Nothing was written." >&2
  exit 1
fi

FINAL="$(printf '%s\n\n%s\n' "$STRIPPED" "$NEW_BLOCK" | sed '/./,$!d')"

if [ "$PRINT_ONLY" = true ]; then
  echo "install-season-cron.sh --print-only: this is the crontab that WOULD be installed (nothing was written):"
  echo ""
  printf '%s\n' "$FINAL"
  exit 0
fi

printf '%s\n' "$FINAL" | crontab -
echo "install-season-cron.sh: installed. Verify with \`crontab -l\`."
