# Mock drafts rebuild — implementation plan (2026-09-03)

Spec: `docs/superpowers/specs/2026-09-03-mock-drafts-design.md`. Branch `worktree-mock-drafts`
from `d34014e`. Green gate after every task: `tsc --noEmit` (0 errors), eslint on touched files,
targeted vitest.

## Task 1 — pure derivations (the math the page and the debrief share)

- `src/draft-room/state/debrief.ts`: `debriefCounts(reviews)` (total / best-available /
  reaches), `firstRoundByPosition(picks, playersById, teamId)`,
  `roomFirstRounds(picks, playersById, draftOrder, position)` (per-seat first round, for the
  average clause + its honesty gate), `positionShape(reviews→picks, playersById, teamId,
  shapeRounds)` (counts by position in the early rounds), `byeStackWeek(playerIds, playersById,
  byeWeeks, threshold)`, `formatPickSlot(pickNumber, teamCount)` ("1.08"),
  notable-pick selection (best pick / worst reach).
- `DRAFT_ROOM_CONFIG.debrief`: `{ reachRankedHigher: 5, shapeRounds: 6, byeStackMin: 3 }`.
- Tests: `debrief.test.ts` — every derivation, including the drop-silently gates.

## Task 2 — remembered table + chip sentence (client state)

- `src/league-room/state/mock-table.ts`: `MockTable` type (teamCount, pickSeconds,
  scoringPreset, rosterShape, draftSlot?, teamName?), defaults from threaded props,
  `encode/decodeMockTable` (validated against offered options; anything off-list → default),
  `chipLabels(table)` for the sentence. Storage key `commish.mock-table`.
- Tests: codec roundtrip, malformed store, off-list values, chip sentence text.

## Task 3 — server debrief summaries

- `src/mock-draft-service/debrief.ts`: `completedMockDebriefs(db, userId, {limit})` → per
  completed unswept mock room: draftId, mode, teamCount, seat, endedAgoMs, totals
  (best-available / reaches / picks), shape facts, notable picks, best-available fraction.
  Reads `myMockRooms`-shaped rows (status complete + the caller's teamId), then
  `getDraftStore().getDraftState` + `rankedPlayers` per room; computes via Task 1's functions.
- `mockHabits(summaries)` (pure): 2+ gate; first-TE rounds per mock; early-round
  best-available consistency.
- `tableForMockRoom(db, leagueId, draftId?)`: teamCount + pickSeconds + reverse-matched
  scoringPreset (scoring_settings vs `SCORING_PRESETS`) + roster shape (slots vs
  `ROSTER_SHAPES`); falls back to defaults when no exact match.
- Tests with the existing service-test DB fixtures if cheap, else pure-function tests over
  injected state (follow `lobby.test.ts` pattern).

## Task 4 — the page (laws 1–3)

- Rewrite `src/app/app/(shell)/mock-drafts/page.tsx`: keep `?create=solo`; read open rooms +
  mine + `completedMockDebriefs`; thread options, copy, summaries.
- New `src/league-room/components/mock-drafts-page.tsx` (composition + poll + create/join
  actions), `mock-table-chips.tsx` (sentence + inline editors), `mock-people-door.tsx`
  (two door rows + lobby rows; empty lobby renders nothing), `mock-learning-column.tsx`
  (last mock + earlier mocks; self-omits with none).
- Delete `MockLobby`, `MockSetupForm`, `MockWire` + tests; delete `wire.ts` service,
  `MOCK_CONFIG.wire`, `wire` off `MockLobbyBody`; update `GET /api/mock-drafts`.
- `MOCK_COPY` gains the page's new sentences; retires the orphaned ones.
- Tests: `mock-drafts-page.test.tsx` (chips edit in place, DRAFT NOW posts current chips,
  remembered table read/write, empty lobby renders nothing, learning column self-omits,
  one-verb budget), server `page.test.tsx` update.

## Task 5 — the debrief (law 4)

- Contract: `MockResultsInfo` = copy + `table` (for run-it-back / try-another-seat) +
  `habits` (nullable). Route `GET /api/drafts/[draftId]` composes it (habits via Task 3,
  only when 2+ completed).
- Rebuild `mock-results.tsx`: header + RUN IT BACK (the one verb), stat cards, verdict lane
  rows with fact sentences, THE TEAM YOU BUILT (stickers + shape + bye clause), TAKE IT WITH
  YOU (SEED MY SHEET, TRY ANOTHER SEAT), habits card, board below. `RosterSection` retired.
- `sheet-seed.ts` (quilt/state): seed key + write/read; `use-sheet.ts` imports the seed when a
  draft has no stored sheet.
- Tests: `mock-results.test.tsx` rewrite (verdict lane, cards, habits gating, seed write,
  run-it-back POST body), `use-sheet.test` seed-import case, route test update.

## Task 6 — gates + evidence

- Full `tsc`, eslint, vitest for touched suites + the source sweeps (accent budget, rendered
  copy, no-uppercase). Retry DB-lane flakes once or twice.
- Screenshots via dev server + `scripts/lab-shot.ts` (lab session): page with history, page
  without history, debrief → `.superpowers/screenshots/`.
- Commits per task, conventional messages. No merge.
