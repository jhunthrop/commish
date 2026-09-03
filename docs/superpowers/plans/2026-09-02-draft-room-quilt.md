# The Quilt: task plan

Spec: `docs/superpowers/specs/2026-09-02-draft-room-quilt-design.md`.
Branch: `worktree-draft-room`. Verification cadence per the founder's UX-campaign
ruling: `tsc` + `eslint` + targeted vitest per task; screenshots and the broader
suite reconciled at the end. Conventional commits per task.

- [ ] 1. **Byes on the wire.** `byeWeeksByTeam` in
      `src/league-service/nfl-schedule.ts` (a team with no `nfl_games` fixture
      in a week 1..18 is on bye), `DraftPlayersBody.byeWeeks?`, set it in
      `GET /api/drafts/[draftId]/players`, thread through `useDraftRoom`.
- [ ] 2. **Collapse machine.** `quilt/state/collapse.ts` pure reducer + tests
      (one expanded surface at a time; space/slash/esc transitions).
- [ ] 3. **Pending pick.** `quilt/state/pending-pick.ts` (window model, clock
      squeeze rule) + `quilt/hooks/use-pending-pick.ts` + tests.
- [ ] 4. **Cheat sheet.** `quilt/state/sheet.ts` (immutable ops, localStorage
      codec, board reconciliation) + `quilt/hooks/use-sheet.ts` + tests.
- [ ] 5. **Lenses.** `quilt/state/lens.ts` (needs per team, value verdicts,
      bye coloring) + tests.
- [ ] 6. **Quilt board.** `quilt-board.tsx` + `quilt-cell.tsx` + `lens-chips.tsx`;
      compaction rule; cell click opens peek. Component test for compaction +
      lens recolor-not-move.
- [ ] 7. **Clock strip.** `clock-strip.tsx` slim/expanded states, queue top 3,
      one-tap draft, amber grow motion. Component test for the two states.
- [ ] 8. **Drawer.** `pool-drawer.tsx` + four tab components; heights; search
      and position filters; DRAFT verbs through the pending-pick path.
- [ ] 9. **Peek, spine, undo pill.** `peek-sheet.tsx`, `roster-spine.tsx`,
      `undo-pill.tsx`.
- [ ] 10. **Composition.** `quilt-room.tsx` + `use-room-keys.ts`; `SnakeRoom`
      renders it; keep auction on `RoomShell`. Fix `snake-room` tests.
- [ ] 11. **Mobile.** `mobile-room.tsx` + `mobile-confirm-sheet.tsx`, bottom
      tabs, two-step pick.
- [ ] 12. **Reconcile.** Full `tsc` + `eslint` + `vitest run` over
      `src/draft-room`; screenshots of resting / your-turn / drawer / peek /
      mobile states into `.superpowers/mocks/screenshots/` if the app can boot.
