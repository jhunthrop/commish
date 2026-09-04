# Plan: quilt roster pass (worktree-quilt-roster)

Spec: `docs/superpowers/specs/2026-09-03-quilt-roster-design.md`. Gates: tsc 0, eslint
clean, quilt + draft-room + design vitest suites green, geometry e2e updated for the
four-round window. TDD for every state-model change (collapse, board, heights, lens).

## Task 1 — state models (tests first)

- `state/collapse.ts`: `DRAWER_TABS` gains `roster` (pool, sheet, roster, byes, picks);
  the `spine` surface kind and `TOGGLE_SPINE` event are deleted. `collapse.test.ts`
  updated first.
- `state/board.ts`: full window = active round + prior `QUILT_CONFIG.fullRoundsBehind`
  (new, 3), clamped at 1; tracks/micro unchanged. Window tests in `board.test.ts` first.
- `state/heights.ts`: new row constants (full 36/28/56, track 14/4/48, micro 14/4/28),
  `cellCaptionMinPx 30`, `cellFaceMinPx 34`; ladder order untouched. `heights.test.ts`
  recomputed from the new constants + the 800/900/1050 fit test, first.
- `state/lens.ts`: private `fractionsFor(slotConfig, roster, positions)` feeds both
  `needFractions` (QB/RB/WR/TE, unchanged) and new `unfilledStartingPositions`
  (QB/RB/WR/TE/K/DEF). `lens.test.ts` additions first.

## Task 2 — the Roster tab + the spine's deletion

- New `components/drawer-roster-tab.tsx` over `rosterFillRows`: filled rows (SlotChip,
  PlayerFace sm, peek-button name, PositionBadge, pick place), dashed open rows.
  `drawer-roster-tab.test.tsx`.
- `drawer-handles.tsx`: `roster: "Roster"` label; `hasRoster` gating like `hasByes`.
- `pool-drawer.tsx`: renders the tab; passes `hasRoster={myTeamId !== null}`.
- DELETE `roster-spine.tsx` + `roster-spine.test.tsx`; `quilt-room.tsx` drops the spine
  column and its docblock mention; `draft-room.test.tsx` spine assertions become
  Roster-tab assertions; repo-wide spine grep for leftovers.

## Task 3 — the needs line + mobile

- `clock-strip.tsx`: amber branch only — one quiet `Still need X · Y` line from
  `unfilledStartingPositions`; absent when satisfied; never on the resting strip.
- `mobile-room.tsx`: ROSTER tab (same component) between SHEET and BOARD; hidden for a
  teamless caller; five-tab fit verified by arithmetic (spec, mobile section).

## Task 4 — cells and the geometry e2e

- `quilt-cell.tsx`: thresholds ride the new constants (no markup change; the tighter
  lockup is the 36px row); docblock updated.
- `e2e/quilt-board-compaction.spec.ts`: readable-minimum + one-height checks over ALL
  full rows (1..4), plus a fifth audited stage after drafting once (rounds 1+2 full).

## Task 5 — screenshots + gates

- Dev server + `mint-dev-session` + `drive-dev-draft` (parks round 3, your turn);
  scratchpad playwright script for the drawer-on-Roster and resting frames; both themes
  into `.superpowers/screenshots/`.
- tsc, eslint, vitest suites; run the geometry e2e if the lane is cheap, else selector
  math recorded in the report.
