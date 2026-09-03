# The Quilt: task plan

Spec: `docs/superpowers/specs/2026-09-02-draft-room-quilt-design.md`.
Branch: `worktree-draft-room`. Verification cadence per the founder's UX-campaign
ruling: `tsc` + `eslint` + targeted vitest per task; screenshots and the broader
suite reconciled at the end. Conventional commits per task.

- [x] 1. **Byes on the wire.** `byeWeeksByTeam` in
      `src/league-service/nfl-schedule.ts` (a team with no `nfl_games` fixture
      in a week 1..18 is on bye), `DraftPlayersBody.byeWeeks?`, set it in
      `GET /api/drafts/[draftId]/players`, thread through `useDraftRoom`.
- [x] 2. **Collapse machine.** `quilt/state/collapse.ts` pure reducer + tests
      (one expanded surface at a time; space/slash/esc transitions).
- [x] 3. **Pending pick.** `quilt/state/pending-pick.ts` (window model, clock
      squeeze rule) + `quilt/hooks/use-pending-pick.ts` + tests.
- [x] 4. **Cheat sheet.** `quilt/state/sheet.ts` (immutable ops, localStorage
      codec, board reconciliation) + `quilt/hooks/use-sheet.ts` + tests.
- [x] 5. **Lenses.** `quilt/state/lens.ts` (needs per team, value verdicts,
      bye coloring) + tests.
- [x] 6. **Quilt board.** `quilt-board.tsx` + `quilt-cell.tsx` + `lens-chips.tsx`;
      compaction rule; cell click opens peek. Component test for compaction +
      lens recolor-not-move.
- [x] 7. **Clock strip.** `clock-strip.tsx` slim/expanded states, queue top 3,
      one-tap draft, amber grow motion. Component test for the two states.
- [x] 8. **Drawer.** `pool-drawer.tsx` + four tab components; heights; search
      and position filters; DRAFT verbs through the pending-pick path.
- [x] 9. **Peek, spine, undo pill.** `peek-sheet.tsx`, `roster-spine.tsx`,
      `undo-pill.tsx`.
- [x] 10. **Composition.** `quilt-room.tsx` + `use-room-keys.ts`; `SnakeRoom`
      renders it; keep auction on `RoomShell`. Fix `snake-room` tests.
- [x] 11. **Mobile.** `mobile-room.tsx` + `mobile-confirm-sheet.tsx`, bottom
      tabs, two-step pick.
- [x] 12. **Reconcile.** Full `tsc` + `eslint` + `vitest run` over
      `src/draft-room`; screenshots of resting / your-turn / drawer / peek /
      mobile states into `.superpowers/mocks/screenshots/` if the app can boot.

## Close-out (2026-09-02)

All twelve tasks done. Verification state at close:

- `tsc`: 43 errors, ALL pre-existing stale test files on the deferred UX ledger
  (`helpLevel`, `formatPickFact`, join/league-room fixtures) — none in production
  code, none introduced by this branch. Count identical before and after.
- `eslint`: clean over every touched file.
- `vitest src/draft-room`: 414 passing. The 8 still-failing files
  (auction-room, draft-board, mock-results, room-dock, room-rail, tv-board,
  tiers, format) are the SAME pre-existing stale suites — they assert v4-era
  DOM (`ring-negative`, `dock-your-turn`) and copy against components this
  branch never modified, per the founder's tests-deferred ruling.
- Design source sweeps: the quilt is clean under the accent budget (two earned
  allowlist entries, reasons recorded in the test), the caps charter
  (`MICRO_LABEL` throughout) and the weight cap. The 10 remaining sweep
  failures are pre-existing, in league-room/ui files untouched here.
- Screenshots: `.superpowers/mocks/screenshots/` (untracked — `.superpowers/`
  is gitignored, like the mocks themselves): your-turn, drawer-half, peek,
  undo-pill, mobile-pool, mobile-board. The RESTING desktop state could not be
  photographed in a solo mock — the bots chain their picks in under a second,
  so the room is effectively always on the human's clock; the state is covered
  by component tests (`snake-room.test.tsx`) instead.

## Fix round (2026-09-02, whole-branch review APPROVE-WITH-NOTES)

- [x] HIGH 1 — pick loss on navigation: unmount FLUSHES the pending pick,
      `beforeunload` earns the native prompt while one pends, `pagehide`
      flushes with `keepalive: true` on the actions POST (cheap: the option
      rides the existing fetch init; bodies are tiny). Tests flipped to the
      flush contract plus beforeunload/pagehide coverage.
- [x] MEDIUM 2 — swap feedback: `PendingPick.swappedFromPlayerId`; the pill's
      sub-line reads "swapped from <name>" for the window's remainder. Other
      DRAFT buttons stay enabled; last word wins.
- [x] MEDIUM 3 — rejection words: the quilt submits picks through
      `room.submit` itself and toasts "<name> did not land. <reason> You are
      still on the clock." at the window's own submit, never the generic act
      wrapper.
- [x] MEDIUM 4 — Esc mid-note saves the draft note and exits editing
      (stopPropagation keeps the room's collapse out of that keystroke); the
      next Esc collapses as always.
- [x] LOW 5 — sheet codec dedupes order on decode (first wins) and caps notes
      at `QUILT_CONFIG.sheetNoteMaxChars`, on decode and on write.
- [x] DESIGN 6 — the dense card returns from the REAL stores:
      `GET /api/drafts/[draftId]/players/[playerId]/history`
      (`playerHistory` in draft-service) reads `player_week_observations`
      through the league's own scoring, ranks the positional finish over the
      stored population, respects the derived-season live-admission seam, and
      the store's `observationsAsOf` gained an additive `playerIds` filter so
      one card never pays for a league-season. Client: `usePlayerHistory`
      (lazy, room-lifetime cache shared by both trees) + `PeekHistory`
      (seasons table + consistency strip; skeleton loading; absence renders
      nothing). Probed against the dev store: Gibbs answers 2025 RB3, 17
      weekly bars, 311ms cold.

Test deltas this round: +14 (pending-pick hook/model rewrites and additions,
swap pill, rejection toast, Esc-saves-note, codec dedupe/cap, store player
filter, 3 real-store route tests, 5 PeekHistory rendering tests). All targeted
suites green; the pre-existing stale-ledger failures are unchanged.
