# Commish — Mock Drafts (Phase 4.5)

Read this with `docs/draft-engine.md` (the reducer and the action log), `docs/draft-room.md` (the
room every mock renders in — the SAME room), and `docs/decisions/mock-drafts.md` (why each of the
calls below was made) before touching `src/mock-draft/**`, `src/mock-draft-service/**`, the
`isMock` branches in `src/draft-service/store.ts`, or the `/api/mock-drafts` routes.

## What a mock IS

A mock draft: the real draft room, the real engine, the real clock, against named bot
opponents — free, sign-in-first, and gone after a day. It exists so a first-timer rehearses the
room before their real draft, and so the front door has something a visitor can DO. Two founder
requirements shaped it (2026-08-25): live-against-others practice (a lobby, plus a shareable
link), and bots that are varied and non-repeating without being absurd.

A mock is a **`leagues` row** (`is_mock = true`) plus a **`mock_rooms` sidecar** — never a
parallel table set. The room the founder ordered showcased is welded to
`drafts`/`leagues`/`teams` at six seams (config load, start, replay, SSE channel, chat, the
moderator), and a parallel set would fork every one of them into a second implementation that
drifts. The heavyweight parts of a real league (audit chains, notices, money, seasons) are not
table weight — they are WRITER behavior, and the mock lane turns each off at its one writer
(see "The exclusion architecture" below).

`mock_rooms` (`src/db/schema.ts`) carries the mock-only facts: `mode`, `pickSeconds`, `botSeed`
(the replay root — see below), `shareCode` (UNIQUE — the claimable address for `lobby`/`link`
rooms), and `startsAt` (the fill-window deadline the ticker's due scan fires on;
`mock_rooms_starts_at_idx` serves both the due scan and the sweep).

## The three modes

`MOCK_CONFIG.modes` (`src/mock-draft/config.ts`) — a closed vocabulary of exactly three:

| Mode | Who fills the seats | When it starts |
|---|---|---|
| `solo` | Bots seated at creation | Immediately — `startsAt` stamps `now` and `createMockRoom` starts it in the same call; if that start fails, the ticker's due scan retries it (nothing special-cases recovery) |
| `lobby` | Strangers from `/app/mock-drafts`' open-room shelf; bots top up the rest | `MOCK_CONFIG.fillWindowSeconds` (180s) after creation — or `earlyStartGraceSeconds` (10s) after the last human seat fills |
| `link` | Whoever the host shares `/app/mock-drafts/<shareCode>` with; bots top up | Same fill window as `lobby` |

Everything else about a room comes from the REAL creation vocabulary (team count, scoring
preset, roster shape, snake) plus the one mock-only knob: the practice clock
(`pickClockSecondsOptions`: 30/60/90 — 90 matches the real floor for a true dress rehearsal).
Sign-in-first: every route under `/api/mock-drafts` requires a session; the front-door CTA
carries intent through the existing `returnTo` machinery instead of a guest-identity subsystem
(`docs/decisions/mock-drafts.md`, ruling 4).

## The lifecycle

1. **Create** — `createMockRoom` (`src/mock-draft-service/creation.ts`): one transaction
   writing the `leagues` row (`is_mock`, `is_public_matchmade = false`, named
   `MOCK_COPY.roomName`), the `mock_rooms` sidecar, the host's team, and — for `solo` — the bot
   seats, having first called `ensureMockBotRoster` (`src/data/seed/bot-roster.ts`, a
   production-safe idempotent upsert) inside the same transaction. `writeLeagueInTx` is the
   shared league writer; the mock lane passes `MOCK_NOOP_AUDIT` (see below).
2. **Claim** — `claimMockSeat` (`claim.ts`): one guarded insert under the league lock. No seat
   hold, no tier gate, no money gate — losing the last-seat race answers
   `MOCK_REFUSALS.full`, a sentence with a next step, not a held-seat ceremony. The last human
   seat pulls `startsAt` forward to `now + earlyStartGraceSeconds`.
3. **Start** — the ticker's due scan (`dueMockRoomsQuery`, `driver.ts`) finds
   `starts_at <= now`, `topUpBots` fills the remaining seats from `MOCK_CONFIG.botRoster`
   (24 named bot `users` rows — `is_bot = true`, unroutable reserved emails, no sessions), and
   the room starts through the real `startDraft`. Bot team ids are sorted deterministically
   before `assignArchetypes` so a restart cannot re-deal the brains.
4. **Draft** — bots pick through `store.applyAction` like any caller (never `TIMER_EXPIRE` —
   the safety net stays the safety net, unchanged and still live for humans). The moderator
   nudges humans only: `nudge.ts`'s `isBotCache` makes bot turns structurally unreachable.
5. **Complete** — on replayed completion the driver settles `drafts.status = 'complete'` via a
   guarded `is_mock`-only UPDATE (the Task 6 ruling: the Task 4 invariant blocks audit/season
   EFFECTS, not a bare status column), freeing `liveDraftsQuery` scan slots. The results panel
   (`MockResults`) shows facts from the draft's own log — roster by slot, pick-versus-board
   deltas — never a grade (ruling 5: no invented authority).
6. **Sweep** — `sweepExpiredMocks` (`sweep.ts`) deletes, it does not archive:
   `MOCK_CONFIG.retention` gives a completed room 24h (the results page's lifetime, and the
   sentence `MOCK_COPY.resultsRetentionSentence` tells the member up front), an unstarted room
   2h, an abandoned in-progress room 6h. `DELETE FROM leagues` and the FK cascade clears all
   seven dependent tables; the sweep asserts zero orphans and drops the ranking and store
   caches per deletion. `deleteMockLeagueRow` re-checks `is_mock` inside the writer (belt) on
   top of the scan's join (suspenders), so a corrupted sidecar row cannot aim the DELETE at a
   real league.

**The sweep's legality clause (load-bearing, verified per task since pre-flight):** the DELETE
is legal ONLY because the mock lane never writes a trigger-protected row — no `audit_events`,
no money entries, no season trace — so migration 0019's append-only `BEFORE DELETE` triggers
never have a row to refuse. "No permanent rows" and "mocks are audited" are jointly
unsatisfiable; the carve-out chose retention (ruling 2), and the statement-spy test is what
keeps the choice true rather than conventional.

## The bot brain — an honest description

The bots are **rankings plus seeded heuristics**. Not machine learning, not "AI opponents", not
anything that learns — and the copy rulebook enforces that description: `copyViolations`
(`@/integrity/copy-rules`) grew a Phase 4.5 forbidden-vocabulary set (`"ai opponent"`,
`"smart ai"`, `"learns from"`, `"machine learning"`) swept over `MOCK_COPY` value by value and
over every rendered surface. A bot's seat shows `MOCK_COPY.botBadge` ("Bot") with the
accessible `botMarkerLabel` ("practice opponent") — a named practice opponent and nothing more.
Bots that learn from real drafts are explicitly deferred to Phase 6 (D3).

One shared sampler (`chooseBotPick`, `src/mock-draft/bots.ts`): rank-weighted softmax-ish
sampling over the top `reachDepth` (8) eligible players at `temperature` 3.0, tilted by
positional need read from the ROSTER (open dedicated starting slots raise a position, filled
starters damp it — never a memory), warmed by a run-reaction (`window` 4 picks back,
`threshold` 3 at one position: every brain gets the mild `baseBoost`, the run-follower gets the
full `needBoost`). A hard reach cap keeps variety from ever becoming absurdity (the founder's
own bound). `null` from the sampler means roster-full, not an error.

Seven **archetypes** (`src/mock-draft/archetypes.ts`) are weight tweaks over that one sampler —
never a second pick path (D9):

| Archetype | Character |
|---|---|
| `best_available` | trusts the board |
| `rb_heavy` | hammers RB early (RB ×1.6) |
| `zero_rb` | fades RB (×0.4), feasts WR (×1.5) |
| `qb_early` | takes the QB the room scoffs at (×1.8) |
| `te_premium` | pays up at TE (×1.7) |
| `need_filler` | drafts the roster sheet (need ×2.0) |
| `run_follower` | panics with the room (full `needBoost` on a run) |

Archetypes are DEALT per draft (seeded shuffle, round-robin) rather than drawn independently, so
seven or fewer bots are structurally all-distinct. Proven variety: 20 seeds produce 20 distinct
full pick logs; two identical-settings solo drafts overlapped on 13% of pick positions,
divergent from pick 1 (the Task 10 founder-acceptance check).

## Bot identity — opponents, not labels (founder directive, 2026-08-26)

A bot seat carries three names, each with one job: the TEAM name (what the board shows — a
seeded draw off `MOCK_BOT_TEAM_NAME_POOL` via `pickBotTeamNames`, distinct within the room,
excluding any name an existing team already carries, so a host who names their team off the pool
never gets a twin); the OWNER handle (`MOCK_CONFIG.botRoster[].name` — coach-style, playful,
never a real-person-plausible full name, never "bot"/"AI" as a word, never a strategy word); and
the honest marker (`MOCK_COPY.botBadge`/`botMarkerLabel`, unconditional on every bot seat — the
badge is the truth, the names are flavor). Names never leak the archetype: the deal is a separate
seeded draw, so no fixed name could describe it anyway, and the vocabulary rules are pinned by
`config.test.ts`. Bot USER ids are byte-identical forever — `rngFor` streams key off them, so
they are load-bearing for replay; `ensureMockBotRoster` upserts display names so a rename
reaches existing databases.

## Seeded replay — the debugging recipe

Every random draw in the mock path routes through `rngFor(seed, key)`
(`src/mock-draft/rng.ts` — a thirty-line mulberry32 behind the `Rng` interface; `Math.random`
is banned from the path by review AND by the determinism property test). The seed is
`mock_rooms.bot_seed`, drawn once at creation and stored. Stream keys are load-bearing replay
identity: one pick stream per bot for the draft's life (keyed by team id), a separate per-pick
delay stream (`${teamId}:delay:${pickNumber}`), and the archetype deal's own `"archetypes"`
stream — renaming a `botRoster` id or a stream key re-deals every in-flight seeded room.

**Given `bot_seed` off any bug report, `runFullMockDraft({ seed })`
(`src/mock-draft/bots.test.ts`'s harness) reproduces every bot decision.** Mid-draft restart
replays byte-identically too: the driver derives each bot's stream cursor from the action log
itself (the non-auto pick count — exactly one draw per sampled pick), never from memory, and
human picks never advance a bot's stream.

Bot cadence is ONE lane for every room, a lone human's included (founder report 2026-09-08,
which retired the older one-human "sim to next pick" lane after a live mock landed every bot
pick in one burst and two drivers raced the same stretch):

- **Paced, one pick per call.** Each bot pick falls due a seeded think-delay after the previous
  pick — `MOCK_CONFIG.botDelay { baseMs: 700, jitterMs: 250 }`, uniform 450–950 ms, drawn from
  the pick's own rng stream (`botThinkDelayMs`, `src/mock-draft/bots.ts`), so the board
  animates pick by pick and the draft still replays exactly. A drive (`driveBotPick`) or an
  advance call (`applyDueWork`, `src/draft-service/advance.ts`) lands at most the one pick that
  is due, stamped at its due instant, so the next bot's delay chains from the landed pick and
  never from a driver's tick. Measured after the change: consecutive bot picks 527–947 ms
  apart across a full 12-team mock, never two in one call.
- **Nothing rides the pick request.** The actions route answers the human's own pick and
  returns; the room's SSE advance loop (woken by that pick's frame) and advance-on-read land the
  bots at their due instants. The room's "your turn" ETA prices every bot turn at the delay
  draw's midpoint (`expectedBotThinkDelaySeconds`), carried over the wire as
  `MockRoomInfo.expectedBotPickSeconds`.

## The exclusion architecture — "a rehearsal never counts"

Exclusion is MECHANISM, not a promise, enforced at three layers:

1. **By construction:** every mock ships `is_public_matchmade = false`, so
   `ENFORCED_LEAGUE_SQL` already keeps mocks off browse, the wire's per-league queries and the
   proof strip. The `leagues_mock_private_ck` CHECK constraint
   (`drizzle/0043_mock_leagues_private_ck.sql`: `NOT is_mock OR is_public_matchmade = false`)
   makes the invariant Postgres-enforced rather than conventional — a mock CANNOT become
   public-matchmade, so the by-construction exclusion cannot be un-constructed by a bug.
2. **By predicate, at the two reads construction cannot cover:** `leaguesFilledQuery`
   (`@/league-service/proof` — the one aggregate that deliberately counts private leagues)
   gains `NOT is_mock`; `myLeaguesOverview` (`@/league-service/read` — scoped by membership,
   not by `is_public_matchmade`) excludes `isMock` at the id-set boundary, keeping the locker
   room a room of real leagues.
3. **By writer behavior, proven differentially:** `store.applyAction` guards every consequence
   site behind one `isMock` read per transaction — autopick/skip notices, the audit append
   (`MOCK_NOOP_AUDIT`, `src/mock-draft-service/creation.ts`, is the one named, docblocked
   no-op), `draft_completed` notices, season commit (`commitDraftState`), and the auto-start
   announcement — while append/locks/cache/broadcast stay identical. The statement-spy test
   (`recordStatements`) proves BOTH directions: a driven mock writes zero
   audit/notice/money/season statements; the identical real-league drive writes all of them,
   byte-identically to the pre-phase snapshot. `commitDraftResults` (an uncalled second commit
   entry point) is NOT guarded — whoever wires a route to it must add the guard or the law has
   a hole (ledgered carry).

The reverse direction is guarded too: bot accounts are structurally refused from real-league
joins (403 at both doors), and mock results feed no proof stat, no wire frame, no acquisition
number, permanently (D8).

## Boundaries

`@/mock-draft` is pure but **BLOCKED** (the `src/integrity` precedent — see
`docs/conventions.md`'s client-boundary section): `MOCK_CONFIG.strategy` is a bot's playbook
and must not ship into the client bundle, and `MOCK_COPY` reaches the room pre-rendered as
data. The ONE wire field `DraftSnapshotBody.mock: MockRoomInfo | null` carries every mock
string into the room; `route.ts` is the sole value-importer; `PracticeBanner`, the board's bot
marker and `MockResults` all receive copy as props. `@/mock-draft-service` (gate 26) is the
Postgres/Redis half, exactly as blocked as `@/integrity-service` — one boundary, not two. Both
directories carry 100% coverage gates (25 and 26).

## Testing notes

- The exclusion contract IS its tests: the proof/wire/browse/locker exclusion suite
  (`proof.test.ts` + dedicated `is_mock` pins in `wire.test.ts`/`browse.test.ts`), the
  statement spy with its real-league mirror, the sweep-to-zero-rows proof with a surviving
  real league, and `e2e/mock-draft.spec.ts` beside the untouched `money-dark`/`whole-site`
  passes.
- `seedDraftFixture` grew `isMock`/`botTeams`/`mockPickSeconds` for downstream suites.
- **E2E harnesses and the barrel-import hazard (the noted improvement):** `@/draft-service`'s
  barrel (and the mock routes' `_shared.ts`) transitively pull `next/server`, which
  Playwright's Node process cannot resolve — so `e2e/mock-draft.spec.ts` and
  `e2e/mobile-360.spec.ts` build store collaborators directly from the submodules
  (`createDraftStore` from `./store`, `getPublisher()`, a wall clock), mirroring
  `global-setup.ts`'s `cryptoRandom` precedent. Today each harness assembles that trio itself
  and omits optional deps like `onPublishError`; if a third spec needs the same assembly,
  extract ONE shared server-free store factory for e2e harnesses instead of a fourth copy
  (Task 11 review carry).
