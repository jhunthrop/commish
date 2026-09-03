# Plan: v6 quilt flagship pass (worktree-quilt-warm)

Spec: `docs/superpowers/specs/2026-09-03-quilt-warm-design.md`. Green gates per task: tsc 0,
eslint clean on touched files, the quilt + design vitest suites.

## Task 1 — the manager row
- New `src/draft-room/quilt/components/manager-row.tsx`: avatar + short-name column heads on
  the board's own grid columns; ring states live/you/quiet; `Avatar` for a stored ref,
  circular-clipped `Crest` monogram fallback.
- `QuiltBoard` renders it in place of the text-code header when not `microOnly`; the
  micro-quilt keeps text initials (mobile judgment).
- Test: `manager-row.test.tsx` — ring per state, YOU label, crest fallback, abbr full names.

## Task 2 — drawer handles + need fractions
- New `src/draft-room/quilt/components/drawer-handles.tsx`: tab handles + grabber pill,
  rendered by `PoolDrawer` at every height; collapsed body loses the best-available chip row.
  Tap semantics: inactive tab `SET_TAB`, active tab `TOGGLE_DRAWER`, grabber tap
  `TOGGLE_DRAWER`, grabber drag one step up/down. Chevron flips open/closed.
- `needFractions` derivation beside `positionNeeds` in `state/lens.ts`; chips rendered in the
  desktop drawer's filter row (prop into `DrawerPoolTab`).
- Tests: `drawer-handles.test.tsx` (dispatch table, chevron), `lens.test.ts` additions
  (fractions: filled / unfilled / check).

## Task 3 — the roster toggle
- `RosterSpine`: explicit chevron head button labeled ROSTER, flip on expand, rotated
  micro-text retired; reduced-motion branch on the flip.
- Test: `roster-spine.test.tsx` — open/close via the button, aria-expanded, chevron flip.

## Task 4 — faces in cells + real screenshots
- `QuiltCellView` gains `withFace`; `QuiltBoard` passes `row.kind === "full"`; `PlayerFace`
  sm beside the condensed name; micro rows untouched.
- Test: quilt-cell face renders only when `withFace`.
- New `e2e/quilt-warm-shots.spec.ts` (QUILT_SHOTS-style, env-gated): solo mock a few picks
  in, photograph resting / your-turn / drawer-half-via-handles, dark and light, into
  `.superpowers/screenshots/`.
