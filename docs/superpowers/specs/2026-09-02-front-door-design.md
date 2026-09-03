# The Front Door, the Workflow Pass (2026-09-02)

The founder-approved blueprint lives in `.superpowers/mocks/` (Main, JoinSheet, CreateSheet,
MobileDoor, plus canvas.json's annotation). This spec maps the four mocks onto the real reads,
names what of the current page survives and what each deletion supersedes, and states both money
states for every surface that renders a dollar.

## The two doors, one page

The lobby shelf IS the landing. Find-a-seat leads; bring-your-crew is never hidden — its own band
directly under the shelf, outline verb. The approved hero ("There is always a seat.") stays,
compressed: headline, sub, the derived money sentence, and (live only) the state-eligibility
line. The hero's verb row is gone — see "Superseded" below.

## Kept vs superseded (current `src/app/page.tsx`)

KEPT, with the finding each one honors:
- `PublicBar` with the conditional Reviews nav entry (D3: never advertise an empty room) and the
  quiet/loud nav pill arithmetic (E2: the pill steps back the instant a room genuinely fills).
- The hero band's ground (`floodlight` + `yard-lines`, Task 7/Task 2 carry) and the headline,
  sub and derived money sentence (`moneyIsLive()`, never a fixed claim — the absolutism sweep).
- `OpenLeagueShelf` as the one real shelf — the same `listPublicLeagues` read `/browse` renders,
  capped at `UI_CONFIG.frontDoor.shelfCap` (D3: the capped teaser; `/browse` is the lobby).
- The one-`now` discipline: one instant, threaded to every reader.
- `proofStats` through `getProofCache()` (P4 CARRY), floors intact: null is an absent cell,
  never a zero (law 7).
- The wire read (`listWireItems`) — request-time truth, coarse timestamps, actor-free (D4, S9).
- Full-width bands, `sm:px-10` gutter (E2).
- The `signedIn` threading — the signed-in variant of the page keeps working.

SUPERSEDED, and what each deletion supersedes:
1. **The hero verb row** (featured `OpenLeagueCta` + `PracticeEntryLink`). The blueprint's law:
   only the fullest genuinely-filling ROW gets the solid amber verb and row wash; everything
   else outlines. The hero repeating the featured room's verb was law 6's earlier answer (the
   2026-08-25 hero-module ruling, already repointed once into the lower third); the row itself
   is now that room's one loud rendering. The practice entry moves into the "Never played?"
   trust card, which is the blueprint's own place for it. When nothing is genuinely filling, the
   nav pill stays loud (existing E2 behavior, unchanged).
2. **`FrontDoorLowerThird`** is retired. Its subject cell duplicated the featured row (the shelf
   is the landing now); its earned proof numbers move to the trust band's quiet proof line, same
   floors, same null-is-absent law. Law 6's "the screen ends in a strip" is now the wire band.
3. **The "Start your own league" closing band** (Gameday 2026-08-28) is replaced by the CREW
   BAND directly under the shelf — the blueprint's law 1 says bring-your-crew is never hidden,
   and a band at the page's foot was the old defect ("the last thing a stranger reads was the
   quietest thing on the page") wearing new copy. The outline verb opens the CREATE SHEET;
   signed out, the sheet's submit rides sign-in to `/app#create-league` (the auth-gated create
   surface that already exists).
4. **The wire moves from under-nav to the page's bottom band** — the blueprint's "lobby pulse"
   position. Everything about WHAT it renders (D4 request-time truth, `minItems` quiet gate,
   coarse durations) is unchanged; only the mount point moves.
5. **The "See every open league" pill** joins the sorting-sentence row: "Sorted by soonest draft
   you can still join · N more rooms in the full lobby" beside the quiet browse-all pill. D3's
   capped teaser survives; the doorway just sits on the shelf's own foot line.

## The joiner's laws

**Every row carries the whole decision.** lg+ columns: position · league · format · seats ·
(buy-in · the pot — live money only) · drafts · verb. Column heads, tabular numerals — both
already the board's idiom (`LeagueRowsHeader`, `tabular-nums`). Below lg the ledger card stays
the form that fits 360px (founder rows ruling, untouched); its Entry row already renders the
real fee.

**Money columns render only under `moneyIsLive()`** (injectable `live` prop, the
`FrontDoorHero` idiom, tested by injection in both states). Free season: no buy-in/pot columns
at all — a column with zero variance carries no information (the ruling that deleted the Entry
column stands), and the derived free-season sentence under the board says the money fact once.
Live: buy-in is `entryFeeLabel` (the real `entryFeeCents`), the pot is the real payout table's
sum with its split ("$600 · pays $300 / $200 / $100"), or "Bragging rights" for a free league.

**Sorted by soonest draft you can still join.** New pure comparator
(`src/matchmaking/shelf-order.ts`): seats-remaining ascending first — a joinable room fires when
it fills: structurally for `when_full`, effectively for `scheduled` too, since an unfilled
scheduled room rolls (the "roll until full" ruling) — then a chosen kickoff breaks ties
(sooner first; a chosen instant beats none), then stable input order. The founder's
Filling/Fresh chapters survive; the comparator orders within each. Unit-tested.

**Only the fullest genuinely-filling room gets the solid amber verb and row wash.**
`featuredLeagueId`/`featuredFillingLeague` survive as the one selector; the featured row wears
the leader rail + wash and its verb fills; every other verb outlines.

**Tapping a row opens the JOIN SHEET.** The row's verb and the row surface both open the sheet
(`BottomSheet`, the founder's own drawer pattern — no new primitive). The sheet:
- Header: league name + format chips (teams, format, scoring — real fields only; the mock's
  "15 ROUNDS" chip is `rosterSummary`'s slot count).
- The four facts: BUY-IN and THE POT (live only, from `entryFeeCents`/`payoutTable`), THE
  DRAFT (viewer's timezone — see below; `when_full` reads "When the room fills"), SEATS
  (`filledTeams`/`heldSeats`-honest, `SeatMeter`'s counting rule).
- The three-line contract, derived, never typed twice:
  1. the hold: "Your seat holds for {SEAT_HOLD.minutes} minutes while you sign in" (signed out;
     the REAL hold duration, never a made-up one) / the signed-in line has no hold to claim.
  2. the draft: `when_full` derives from `SIT_AND_GO_GRACE_MINUTES`; `scheduled` names the time;
     the miss-it half reuses the queue-safety sentence the hold page already carries.
  3. the season runs itself; "the pot pays the podium" rides only a live, paid league.
- The verb is `OpenLeagueCta` (ink): signed out it IS the existing holds machinery —
  `/join/[leagueId]/hold` claims the hold and sign-in rides it; signed in it is the real join.
  The practice link is the sheet's quiet second act.
- The mock's "· 90 min" draft duration is DROPPED: no draft-duration fact is stored anywhere in
  this product, and a made-up number is exactly what the honesty rules forbid.

**Draft times in the viewer's timezone.** `formatAbsoluteTime`/`formatDraftTime` are
deliberately UTC-fixed (no per-visitor timezone exists server-side — a recorded sibling ruling).
The sheet and rows keep the server's UTC-labelled sentence as the SSR truth and upgrade to the
viewer's own zone post-hydration from `draftAtIso` via a small client formatter
(`LocalDraftTime`) — the same post-hydration-upgrade contract `useCountdown` already holds, so
server and hydration renders agree and the browser's `Intl` zone is the only new input.

## The invite convergence

`/app/join/[code]`'s open state renders the SAME join-sheet body the lobby uses:
`JoinSheetBody` (facts grid + contract lines) is a presentational component fed by a normalized
`JoinDecisionFacts`, built from `PublicLeagueSummary` on the lobby door and from `LeagueTerms`
on the invite door. The invite door's ACTION stays its own (`JoinForm` / the sign-in strip) and
its contract line 1 never claims a hold — the invite path takes no seat hold by controller
ruling (F15), and the sheet says what is true on each door. The seven terminal invite states
are untouched. `LeagueTermsPanel` stays below the sheet body as the deep terms.

## The creator's law

The CREW BAND: "Bringing your own crew?" + the pitch + outline "Start a league" verb. The pitch
is "Be the commissioner without the job" with the three automations — the two money automations
(buy-ins collected before the draft, the pot pays the podium) render behind `moneyIsLive()`;
the free season pitches what is true today (the draft, the schedule, the scoring, trades
refereed on deadlines). Recorded as a judgment call: the blueprint's pitch copy meets the
honest-capability rule by deriving, not by asserting.

The CREATE SHEET (opens from the band; `BottomSheet`):
- Asks ONLY: name, team count, scoring, buy-in (live only — free season states the free
  sentence), draft night. Deep settings stay in the league room (the sheet says so).
- Defaults ARE the service's: the server page threads `LEAGUE_CONFIG.defaults` (team count,
  scoring preset) down as props — the client-boundary rule bans `@/league` value imports, so
  threading the one constant from the server render is what "never a second copy" means here.
  The POST body omits every unasked field so `createLeagueSchema`'s own defaults govern.
- Draft night is a real time input (optional). Blank: the league drafts
  `draftDaysFromCreation` days out (the service's own default, said in the hint) and stays
  editable in the league room. Chosen: after create succeeds the sheet writes it through the
  EXISTING `PUT /api/leagues/[id]/draft-schedule` — never a parallel scheduling path. The
  mock's TONIGHT/FRI/SAT quick chips are dropped: computing "Friday 8 PM" server-blind invites
  timezone dishonesty; the picker plus the honest default sentence carries the question.
- Buy-in, live only: FREE plus fee choices. A paid crew league needs a balanced prize table
  (`prizeTableInvariant`), so the sheet derives a zero-rake podium split
  (`defaultPodiumPrizeTable`, new pure helper beside the invariant, tested against it) — "the
  pot pays the podium" is the blueprint's own pitch, and zero rake invents no economics.
- After create: the sheet mints the invite through the EXISTING `POST
  /api/leagues/[id]/invites` and shows the real shareable URL (`InviteBody.url`) with a copy
  action and the league-room door. The invite link opens `/app/join/[code]` — the same join
  sheet the lobby uses, per the convergence above.
- Signed out: the sheet renders (the questions are the pitch) and the submit verb is a
  `SignInLink` riding intent `/app#create-league`. Choices do not pretend to survive sign-in.
- "Everything editable until the first invite is accepted" (mock copy) is NOT a fact this
  product enforces (league settings edit rules live in the league room service); the sheet says
  "Deeper settings live in your league room" and no more.

## Trust is facts

Three fact cards under the crew band:
1. WHO RUNS IT — the house runs every house league end to end; crew leagues keep the house
   doing the chores (draft, schedule, scoring, trade deadlines).
2. WHERE MONEY LIVES — live: the wallet sentence (buy-in sits in your wallet until the draft
   fires; withdraw anything unspent — the wallet and withdrawal routes exist). Free season: the
   derived free sentence; no fabricated dollar figures.
3. NEVER PLAYED? — the practice-draft card, pointing at the real practice lobby
   (`PracticeEntryLink`'s own honest signed-out label).
Below the cards: the earned proof numbers as one quiet line (`proofStats` floors, null absent).

## Contract extensions (each an honest read of stored config)

- `PublicLeagueSummary.payoutTable?: PrizeTable | null` — `leagues.payout_table`, straight
  through, the same disclosure reasoning `entryFeeCents` carried (Phase 4 Task 13): the prize
  table is a fact about the league being advertised, already public on the invite terms for a
  paid league, and non-null only for paid leagues (impossible while money is dark).
  `PUBLIC_LEAGUE_FIELDS`, both query projections, `SummarizableRow` and `summarizeRow` extend.
- `prizePotCents(table)` — pure sum, beside `prizeTableInvariant`.
- `defaultPodiumPrizeTable(entryFeeCents, seats)` — zero-rake contiguous podium split that
  `prizeTableInvariant` accepts by construction.
- `stateEligibilityLine(config)` (`src/money/states.ts`) — null unless live; else derived from
  the enabled list and its own minimum ages. The front door's eligibility line renders from
  this, only when money is live.
- Draft duration: no stored fact exists; the copy is simplified rather than a figure invented.

## Both money states, everywhere a dollar could render

| Surface | Free season (ships today) | Live (`moneyIsLive()`, by injection in tests) |
|---|---|---|
| Hero money line | "Every league is free this season." | "Play free everywhere…" + eligibility line from `MONEY_STATES` |
| Row columns | no money columns; free sentence under board | Buy-in + The pot columns, real figures |
| Join sheet facts | no buy-in/pot cards; FREE chip | Buy-in + pot cards; verb price suffix |
| Join sheet contract | no wallet clause | "…and pay the buy-in from your wallet"; pot-pays-podium line on paid leagues |
| Crew band pitch | non-money automations | three automations |
| Create sheet buy-in | free sentence, no control | FREE + fee chips, podium split shown |
| Trust card 2 | free sentence | wallet sentence |

## Component map

- `src/matchmaking/shelf-order.ts` (+test) — the sort.
- `src/money/prize-table.ts` — `prizePotCents`, `defaultPodiumPrizeTable` (+tests).
- `src/money/states.ts` — `stateEligibilityLine` (+test).
- `src/matchmaking/contract.ts`, `src/league-service/browse.ts` (+tests) — `payoutTable`.
- `src/league-room/components/`:
  - `open-league-shared.tsx` — money sentences move here (one source for hero + sheet), pot
    label helper, open-sheet CTA naming (existing `ctaAccessibleName` semantics kept).
  - `league-row.tsx` — money columns (live), row-tap/verb open the sheet.
  - `open-league-card.tsx` — card verb opens the sheet.
  - `public-league-list.tsx` — client now; owns the sheet state, chapter sort, sorting-sentence
    row slot.
  - `join-sheet.tsx` (+test) — `JoinSheetBody` + lobby `JoinSheet` overlay.
  - `local-draft-time.tsx` (+test) — the viewer-timezone upgrade.
  - `crew-door.tsx` + `create-sheet.tsx` (+tests) — the band and the create sheet.
  - `trust-facts.tsx` (+test) — three cards + quiet proof line.
  - `front-door-hero.tsx` — verb row out, eligibility line in.
  - `invite-landing.tsx` — open state renders `JoinSheetBody`.
  - `front-door-lower-third.tsx` — deleted (superseded, §Kept vs superseded 2).
- `src/app/page.tsx` — the reassembled door; `front-door.test.tsx` follows.
- `/browse` — inherits the sheet through the shelf; its own filters/sort pills unchanged.

## Hard constraints carried

Sunday v5 tokens only, both themes (token classes only — no new hex). Saira faces (already the
loaded faces). No em-dashes in user-facing copy. No tooltips — words instead. One solid amber
verb per surface (page: the featured row or the loud nav pill, never both; sheet: its own verb).
Immutable patterns; files under 800 lines; strict tsc (zero errors in touched files against the
43-error baseline) and eslint clean. The signed-in page variant keeps working.

## Implementation amendments (2026-09-02, recorded at close)

1. **Pure modules for server-called vocabulary.** `public-league-list.tsx` becoming a client
   component (it owns the join sheet's state) made every export a client reference, and both
   server pages CALL `featuredFillingLeague`/interpolate `HOUSE_SHELF_SENTENCE` — a live RSC
   error the jsdom suites cannot see. The featured selectors and the house sentence moved to
   `src/matchmaking/shelf-order.ts` (re-exported from the shelf for client/test importers), and
   the money sentences to `src/money/copy.ts` (the SERVER hero reads them too).
2. **The solid and the wash ride only a genuinely filling room.** Seen on the live dev render:
   with every filling room rolled, the shelf's old `featuredLeagueId` fallback inked the
   tightest row while the nav pill, deciding off `featuredFillingLeague`, stayed loud — two
   solids on one surface. The shelf's ink AND the leader wash now key off
   `featuredFillingLeague` alone; when nothing genuinely fills, every row outlines and the nav
   pill is the page's one loud verb.
3. **Sub-lg cards keep house-first order** (the founder-approved mobile form); the ranked
   soonest-joinable order governs the lg+ board, where the column comparison lives.
