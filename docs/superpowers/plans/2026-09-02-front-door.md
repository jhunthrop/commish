# Front Door Build Plan (2026-09-02)

Spec: `docs/superpowers/specs/2026-09-02-front-door-design.md`. Worktree: `worktree-front-door`
off main @ 10d1975. Gates per task: `tsc` (zero errors in touched files against the 43-error
baseline), `eslint` clean on touched files, the named vitest suites green. Conventional commits,
one per task. No merge.

1. **Pure vocabulary.** `src/matchmaking/shelf-order.ts` (soonest-joinable comparator + sort),
   `prizePotCents` + `defaultPodiumPrizeTable` in `src/money/prize-table.ts`,
   `stateEligibilityLine` in `src/money/states.ts`. Unit tests for all four (the sort's tests
   cover: when_full ordering by seats, scheduled kickoff tiebreak, chosen-beats-none, stability).
2. **Contract extension.** `PublicLeagueSummary.payoutTable`; `PUBLIC_LEAGUE_FIELDS`; both
   query projections; `SummarizableRow`/`summarizeRow`; `browse.test.ts` disclosure assertions.
3. **Shared money words.** Move the two money sentences into `open-league-shared.tsx`
   (`moneySentence(live)`), add pot/split label helpers; `front-door-hero.tsx` consumes them,
   drops its verb row, gains the live-only eligibility line. Update `front-door-hero.test.tsx`
   (both states by injection).
4. **The join sheet.** `local-draft-time.tsx`, `join-sheet.tsx` (`JoinSheetBody` + overlay).
   Tests: both money states, hold-flow wiring (signed-out verb → `/join/[id]/hold`, the real
   `SEAT_HOLD.minutes` sentence; signed-in → the real join button), when_full vs scheduled
   contract lines.
5. **Rows and cards open the sheet.** `league-row.tsx` money columns (live, injectable) +
   `onOpen`; `open-league-card.tsx` `onOpen`; `public-league-list.tsx` goes client, owns sheet
   state, chapter sort via task 1, sorting-sentence row. Update `league-row.test.tsx`,
   `league-row.hydration.test.tsx`, `open-league-card.test.tsx`, `public-league-list.test.tsx`
   (featured-row selection stays pinned).
6. **Crew door.** `crew-door.tsx` + `create-sheet.tsx` + tests: defaults threaded from
   `LEAGUE_CONFIG.defaults` equal the schema's own (asserted against the real constant), POST
   omits unasked fields, draft-night write-through, invite mint on success, signed-out sign-in
   verb, both money states for the buy-in row.
7. **Trust facts.** `trust-facts.tsx` + test (both money states; proof line floors: null absent).
8. **The reassembled door.** `src/app/page.tsx` per the spec's kept/superseded table; delete
   `front-door-lower-third.tsx`; wire band moves to the foot. Rewrite `front-door.test.tsx`.
9. **Invite convergence.** `invite-landing.tsx` open state renders `JoinSheetBody`; update
   `invite-landing.test.tsx`; `/app/join/[code]` page untouched except what the component needs.
10. **Sweep.** Full vitest for touched dirs, `tsc`, `eslint`; screenshots (desktop + 390px) via
    Playwright if a running app is cheap, else recorded as skipped; final commit.
