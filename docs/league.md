# Commish — League & Standings

Read this with `docs/conventions.md` and `docs/draft-engine.md` before touching anything under
`src/league/`, `src/league-service/` or `src/league-room/`. The engine/service split here
mirrors the draft's: one pure layer, one Postgres layer, one browser layer that never imports
either directly.

## The two layers

| Layer | Path | Rule |
|---|---|---|
| Engine | `src/league/` | Pure. No I/O, no `Date.now()`, `readonly` everywhere, 100% test coverage enforced: schedule generation (the circle method), standings, clinching, lineup shaping, invite codes, `LEAGUE_CONFIG`. |
| Service | `src/league-service/` | The only part that talks to Postgres: league creation, invites, the schedule write, lineups, and standings assembly. Consumed directly by `/api/leagues/**` route handlers and by `src/app/**` Server Components. Scoring a week's matchups is `src/stats-pipeline/finalize.ts`'s job now, called by the stats-ingestion worker — see "Scoring and standings" below. |

Same rationale as the draft: a schedule, a standings table or a clinch computation is a pure
function of rows already in hand, so it lives where it can be tested exhaustively without a
database. Persisting those rows, and reading them back into the shape a page renders, is the
service layer's job alone.

## Creating a league

`createLeague` (`src/league-service/creation.ts`) writes the whole league in **one
transaction**: the `leagues` row, its `scoring_settings`, the commissioner's own `teams` row,
and a `drafts` row already scheduled. A commissioner left holding a league they have no team
in — or a league with no draft to open — is exactly the dead end this closes; there is no
partial-league state to clean up after.

**A league may have no member commissioner (Phase 3.5 addendum).** `CreateLeagueInput.owner` is a
discriminated union, `{ kind: "member"; userId; teamName }` or `{ kind: "house"; rung }`, and the
shared write body (`writeLeagueInTx`) both `createLeague` and the house catalog's own reconciler
call handles both: a `house` owner gets no `teams` row at all (`teamId` is `null` in the result),
and `leagues.commissioner_user_id` stays `NULL` while `leagues.house_rung` names the catalog rung
instead — the two columns are mutually exclusive by a database CHECK, never by convention alone.
What this changes for a member: nobody is ever the commissioner of a house league, including an
operator — `isCommissionerOf` (`src/league-service/authority.ts`) returns `false` on a house
league before comparing anything. The two doors that assumption used to gate — inviting someone,
and moving the draft's scheduled time — both refuse instead, with their own sentences, rather than
silently doing nothing or erroring generically. See `docs/decisions/house-leagues.md` for the full
reasoning and `docs/decisions/formats-and-lobby.md` for the shelf a house league appears on.

Every field but the name is defaulted from `LEAGUE_CONFIG.defaults` (`src/league/config.ts`):
12 teams, snake format, half-PPR scoring, the standard roster shape, a draft scheduled
`draftDaysFromCreation` (7) days out. Half-PPR, not full PPR, is the founder-decided canon
default (Phase 3.5 Task 1) — the trend consensus across Underdog's own tournament default; full
PPR, standard and TE-premium all stay one select away, and superflex is a roster-shape toggle,
not a separate default. `POST /api/leagues` accepts `{ "name": "…" }` as a
complete request — everything else, including the advanced disclosure's own fields, is
optional. The draft is scheduled a week out rather than immediately so its auto-tightening
clock starts in a slow tier instead of at the 60-second floor (`docs/draft-engine.md`).

**The median game default is not centralized the same way.** `medianGame` defaults to `false` at
two places rather than through `LEAGUE_CONFIG.defaults` — `createLeagueSchema`'s own
`z.boolean().default(false)` (`src/league-service/schemas.ts`) and `createLeague`'s
`input.medianGame ?? false` (`src/league-service/creation.ts`). Both agree, so no league can end
up with a different default depending on which one ran, but it is a real drift from how the
roster-shape default is handled — see `docs/decisions/formats-and-lobby.md`'s cross-cutting
section.

## Roster shapes (Phase 3.5, Task 1)

`ROSTER_SHAPES` (`src/league/roster-shape.ts`) is the lookup from a shape's name to its rows —
the `SCORING_PRESETS` of roster shapes. Two ship: `standard` (`STANDARD_ROSTER_SLOTS`, unchanged)
and `superflex` (`SUPERFLEX_ROSTER_SLOTS`), which adds one `SUPERFLEX` slot — eligible for
`QB`/`RB`/`WR`/`TE` — on top of the standard `FLEX`. `SUPERFLEX` sits after `FLEX` and before `K`
in the row order on purpose: `assignSlot` takes the first eligible slot in config order, so a
running back (eligible for both) fills the narrower `FLEX` first and leaves `SUPERFLEX` open for
the position only it accepts.

The engine change this needed is exactly one row: `assignSlot`, `validateRosterAdd`,
`validateLineup` and `defaultLineup` all already treat `RosterSlotConfig` as data, not a
hardcoded shape, so nothing downstream of the draft has any idea a second shape exists.
`describeRosterShape` names a league's shape from its stored slot rows alone (`leagues.roster_slots`
carries the rows; there is no separate shape-name column) — the same reasoning `describeScoring`
already uses for a commissioner-edited scoring preset: a league whose slots don't match either
shipped preset exactly is "Custom," never a lie about which preset it started from.
`leagueTerms` (`src/league/terms.ts`) renders the result on the invite preview and league home
beside the median-game note, and the create form's roster-shape `<Select>` is generated from
`ROSTER_SHAPE_LABEL`, so a third shape added later is reachable from the form the moment its
label exists — nothing to wire by hand.

## The league median game (Phase 3.5, Tasks 2-3)

`leagues.median_game` (boolean, default `false`) is the toggle; `weeks.median_score` (nullable
`real`) is the value — two different tables for two different questions, chosen over both
folding the toggle into `scoring_settings` (which is fifteen flat weight columns that
`describeScoring` reads verbatim, and a median flag is not a weight) and a dedicated
`median_results` table (which would store one row per team per week to encode a fact the scores
already stored in `matchups` imply on their own). See `docs/decisions/formats-and-lobby.md` §2
for the full reasoning, including why no pseudo-matchup row exists for it.

`leagueMedian` (`src/league/median.ts`) is the middle score among every team that actually played
a given week — never a bye team's absence, never a fabricated zero when nobody played.
`medianResultFor` compares one team's own score to that median: strictly above wins, strictly
below loses, exactly at ties. `computeStandings` folds a second result into `wins`/`losses`/`ties`
for every team in `medianByWeek` — the SAME columns a head-to-head matchup fills — and leaves
`pointsFor`/`pointsAgainst` untouched, because the median is not an opponent a team actually
played against; folding it into the points columns would either describe an opponent that does
not exist or double a team's own score.

`clinchedTeamIds` (`src/league/clinch.ts`) takes `gamesRemaining`, not `weeksRemaining` — renamed
(Task 2, the same correction `maxDraftDaysFromCreation` already got in Plan D) because a caller
with the median toggle on must pass `weeksRemaining * 2`, and a parameter that sometimes holds a
different unit than its name claims is exactly the silent wrongness that earlier rename fixed.
`seasonProgress` and `currentWeekNumber` are deliberately untouched by the median: both answer
"how far into the calendar is this league," and a median game adds no week — the one place the
doubling is real is the clinch ceiling, and that is where the change landed.

**The interaction budget.** `LEAGUE_CONFIG.maxCreateInteractions` (3) is the spec's exit
criterion made testable: signed in → a created, invitable league in a small number of
interactions by accepting every default. `src/league-room/create-league-interactions.test.tsx`
drives the real `CreateLeagueForm`/`CreateLeaguePanel` and counts every click and keystroke
against that ceiling — it fails the moment the happy path grows a step, not just when a field
becomes literally impossible to skip.

## Invites

`league_invites` is the **single** membership mechanism — `leagues.invite_code` was dropped
rather than kept as a second, redundant path, because two ways to join the same league is two
places capacity and expiry logic can disagree. The invite **code is the primary key**, and it
is also the last path segment of the shareable link (`/app/join/<code>`): one artifact to
mint, one to expire, one to revoke, rather than a link and a separately-tracked code that
could drift apart.

- **Expiry** — `LEAGUE_CONFIG.invite.expiryDays` (14) from creation; an accept past that
  returns 410.
- **Use cap** — `LEAGUE_CONFIG.invite.maxUses` (32 by default, overridable per invite); an
  accept once `uses >= maxUses` also returns 410.
- **Capacity under concurrent accepts.** `acceptInvite` (`src/league-service/invites.ts`)
  locks the **league** row `FOR UPDATE` before counting existing teams — not the invite row,
  which would let two people redeeming two *different* codes for the same league both read
  "11 of 12" and both insert a 13th team. Locking the league serializes every accept for that
  league regardless of which code it arrived on. `teams_league_user_idx` (a unique index on
  `(leagueId, userId)`) is the backstop for the narrower race: the same person accepting twice
  concurrently. A violation of that index in the catch block is read as "they're already a
  member" — a success, not an error — never surfaced as a 500.
- **Re-accepting is idempotent and free.** Opening your own invite link again finds your
  existing `teams` row and returns it with `alreadyMember: true`; it costs the invite no use
  and mutates nothing.

### The invite landing's states (Phase 3.6 addendum, Task 20)

`/app/join/[code]` renders `InviteLanding` (`src/league-room/components/invite-landing.tsx`),
one discriminated `state`, eight kinds, nine renders (A5):

| State | How it is reached | What renders |
|---|---|---|
| `open`, signed out | `invitePreview`, server-side | The full terms panel and a plain `SignInLink` where the join button would be — never a join button that assumes an identity. |
| `open`, signed in | same | The terms panel and `JoinForm`'s one accept action ("Join {league}"). |
| `invalid` | `invitePreview` refusal | The refusal sentence and "Browse open leagues" — a closed door with a hand pointing at the open one. |
| `expired` | `invitePreview` refusal (410 class) | Same shape, `invites.ts`'s own expiry sentence. |
| `exhausted` | `invitePreview` refusal (use cap) | Same shape, the use-cap sentence. |
| `already-member` | the accept reporting `alreadyMember: true` upward | Told plainly, handed "Go to {league}" — never a silent redirect. |
| `league-full` | the accept's capacity check | `SeatTakenPanel` — literally the same component a shelf race-loser sees, with invite-path actions (browse; leagues closest to filling). |
| `draft-started` | built and tested; not reachable through the live invite door today (`invitePrecondition` checks only expiry and use count — the docblocks in `join-form.tsx` say so plainly) | `SeatTakenPanel`, same rule. |
| `tier-refused` | same reachability note | The tier refusal, same actions. |

Only what `invitePreview` can honestly answer up front (`open`/`invalid`/`expired`/`exhausted`)
is resolved server-side; the other outcomes are discovered by the accept itself and reported
upward through callbacks. **No seat hold on the invite path**, on purpose: a code is not a
public shelf card, and a member league's commissioner controls who is coming (F15). A code
naming a house league is unreachable and collapses to `invalid` — the non-oracle answer.

Trust is not a one-time disclosure. `leagueTerms` (`src/league/terms.ts`) is the ONE pure function
that turns a league's raw facts — its format, size, scoring weights, roster shape, stake tier and
commissioner — into the `LeagueTerms` a human reads, and it has exactly two callers: `invitePreview`
(`src/league-service/invites.ts`), read by a signed-out prospect before they join, and `leagueHome`
(`src/league-service/read.ts`), read by every member after they have. Both callers render the SAME
`LeagueTermsPanel` (`src/league-room/components/league-terms-panel.tsx`) with the result, so a
prospect deciding whether to join and a member already inside can never be told two different
things about the league they are both looking at — `invites.test.ts` asserts this directly, against
the same seeded league, rather than trusting two independently hand-typed expectations to agree.

`leagueHome` assembles its `LeagueTerms` from rows the read already touches for everything else on
the page — the `leagues` row, `teamRows`/`teamCards` for the filled-team count, and `teamRows` again
to find the commissioner's own team (`createLeague` seats them in one in the same transaction that
creates the league, so this lookup never misses in practice). The one row it did not already hold
is `scoring_settings`, so `leagueHome` now reads it too — `BASELINE_LEAGUE_HOME_QUERIES` (`src/
league-service/read.ts`) pins the resulting bound (eight queries, regardless of team count) so a
later change that grows it further trips a test rather than going unnoticed.

The terms panel is never gated on `isCommissioner`: the terms are what everybody in the league is
playing under, not a commissioner-only fact, and `league-read-routes.test.ts` asserts a non-
commissioner member gets the real scoring label and commissioner name back, not a stripped-down
view. On `LeagueHome` (`src/league-room/components/league-home.tsx`) the panel sits as one more
sibling alongside the members panel and the (commissioner-only) invite panel, in ordinary document
flow — not inside a layout that claims the space between them.

## League members

`LeagueMembersPanel` (`src/league-room/components/league-members-panel.tsx`) is the roster of who
is in a league and who runs it, stated as a fact to every member who opens it rather than
inferred from which controls a particular viewer happens to see — before this panel there was no
members list at all, only names scattered across standings, chat and the invite panel, none of
which said who the commissioner was. It renders `LeagueHomeBody`'s `teams` (each carrying its raw
`ownerUserId`) against the league's `authority: LeagueAuthority` (`src/league-service/
authority.ts`), doing the comparison client-side rather than trusting a server-computed
`isCommissioner` boolean — see `docs/decisions/identity-and-trust.md`'s ruling on why a raw id is
the right shape for this members-only wire. An unfilled seat reports as "N seats still open" (from
`teamCount`), never as an absent row, because a commissioner deciding whether to send another
invite needs that distinction. See `docs/decisions/identity-and-trust.md` for the full audit of
where identity renders across the product, including this panel.

**When `authority.kind === "house"` (Phase 3.5 addendum), no row ever earns the "Commissioner"
badge** — that follows from `isCommissionerOf` returning `false` for every caller, not from a
special case in this component. Left silent, that would read as a bug (where did the commissioner
go?) rather than a fact, so the panel states it instead: a "Run by Commish" line renders above the
roster, with the shield icon this product already uses for "the platform acted on its own," plus an
`InfoTip` opening the `house-league` glossary entry. What this changes for a member: there is no
peer to ask for an invite code (the door refuses instead — see `docs/decisions/house-leagues.md`
§6) and no peer who can move the draft's scheduled time — Commish sets it once, at the league's
creation, on the same stagger every other league on that rung's shelf uses.

## The waiting room: proof stats, the just-seated moment, and one voice for start timing

**Proof stats are real or absent, never estimated (Phase 3.6, Task 4).** `ProofStats` — leagues
filled, drafts starting in the next 48 hours, and a rating with its own review count — are each
computed as a real query and each hide independently the moment their own floor
(`MATCHMAKING_CONFIG.proof.*` — see `docs/decisions/design-v2.md`) is not cleared; there is no
placeholder number and no synthesized rating. The strip is cached, not recomputed per request:
`createProofCache` (`src/stats-pipeline/proof-cache.ts`) sits on the same
`createReferenceCache`/`createScoreCache` seam this pipeline already uses — real field checks on
read, degrade-open to a live query on any Redis failure — but deliberately WITHOUT their
write-through invalidation, because this value has no event that should bust it early. A blind TTL
(`MATCHMAKING_CONFIG.proof.cacheTtlSeconds`, 60 seconds) is the correct, simpler choice for a
single process-wide strapline nobody's own action ever changes out from under them.

**`LEAGUE_CONFIG.season.startedAt` is SETTLED (Task 4; verified under the founder's 2026-08-24
delegated-decision directive).** The plan assumed a season-boundary constant already existed in
this codebase; none did. The implementer chose `"2026-08-01T00:00:00.000Z"` (the platform's own
launch month) and marked the choice in `src/league/config.ts`'s own docblock as a deviation from
the plan, not a value the plan specified. The founder has since verified this boundary: it
captures the draft season and predates every real league on the platform. The marker now records
that verification rather than requesting one; the value still rolls forward when real season
rollover ships.

**The just-seated moment derives from the `member_joined` audit event, not a `teams.created_at`
column — because no such column exists (Task 9, D1).** The plan's own assumption that
`teams.created_at` was available to read was false; `teams` carries exactly four columns (`id`,
`leagueId`, `userId`, `name`), no timestamp. `joinedAtFor` (`src/league-service/draft-schedule.ts`)
instead reads the member's own most recent `member_joined` audit event for that league. `justSeated`
(`src/league-service/read.ts`) compares that timestamp against an INJECTED `Clock` — never
`Date.now()` directly, the repo-wide clock discipline — and stays true for
`UI_CONFIG.waitingRoom.justSeatedMinutes` (5) minutes, aging out on its own with no expiry write
anywhere. The heading this produces, `` `${leagueName} · You're in` ``, is `docs/design-system.md`'s
one named exception to the expanded-register rule (C1).

**One function composes every start-timing sentence, across four surfaces, with no duplicate
prose (F9, "the four-surfaces rule," finally holding as of Task 9).** `describeStartTiming`
(`src/matchmaking/roll.ts`) is the single authority every surface that tells a member when a draft
starts imports rather than re-derives: the waiting room's own hero, the commissioner's nested
draft-schedule panel, the public browse/open-league card, and the `draft_kickoff_rolled` notice
(composed server-side and delivered pre-rendered, never re-derived from the payload on the client).
`describeStartTiming` takes its `authority` as `StartTimingAuthority` — `LeagueAuthority["kind"]`,
the narrow `"member" | "house"` string, never the full `LeagueAuthority` object — so a sentence
composed for a public browse card can never carry a real commissioner's `userId` by accident.
`rollNoticeSentence` sits beside it for the roll-count clause ("moved once" / "moved twice" /
"moved N times"), read by the same four surfaces.

**`LiveStatePill` renders icon-only at every width, not just below `sm` (Task 13's fix round).**
The control used to hide entirely below the `sm` breakpoint (`hidden sm:block`) — the exact live
game signal a mobile visitor on a Sunday most wants — until the 360px battery named it the sixth
control reopening the overflow bug the shell's own discipline forbids. It now renders unconditionally,
icon-only, at every width. That same battery caught two real contrast bugs, both fixed rather than
waived: the pill's own `animate-pulse` was dipping the READABLE digit's opacity mid-cycle below its
contrast floor, fixed by moving the pulse to the decorative glyph alone and holding the digit at
constant opacity (`aria-hidden`, folded into an `sr-only` sentence); and `PlayerPool`'s inactive
position-filter buttons dimmed their whole `PositionBadge` at `opacity-80`, which in light theme
dropped RB and TE below 4.5:1 — fixed by removing the dimming and using the selection ring
(`ring-2 ring-accent`) as the sole differentiator instead.

## The schedule

`generateSchedule` (`src/league/schedule.ts`) is the circle method: team 0 stays fixed while
every other team rotates one place per round, so `n - 1` rounds cover every distinct pairing
exactly once before the rotation repeats. An **odd** number of teams gets a sentinel `BYE`
appended to make the count even; whichever real team is paired with `BYE` in a given round
simply has no matchup that week, and no `BYE` row ever reaches the `matchups` table. Home and
away alternate by **round**, not by a team's position in the rotating wheel — alternating on
position would pin a rotating team to one side of the ball for a whole half-cycle, since its
wheel index falls by exactly one every round and cancels any parity rule mixed into it.
Alternating on the round alone keeps the imbalance small and bounded (`|home − away| ≤ 4`
across every supported league size and season length) rather than perfectly even, and a
rematch always swaps sides.

The generator is pure and deterministic: the same team order and week count always produce the
same schedule, which is what makes a seeded league reproducible and a regenerated schedule
idempotent. `writeSchedule` (`src/league-service/schedule.ts`) persists a generated season
inside the caller's transaction with two `onConflictDoNothing` inserts (`weeks`, `matchups`),
so a repeat write costs nothing and never duplicates a row. It is called from
`commitDraftState` inside the same transaction that completes a draft — the schedule exists
the instant a league finishes drafting, never as a separate step a commissioner has to
remember — and the defensive re-commit `docs/draft-engine.md` describes for a wedged draft is
safe to replay because this write already is.

Phase 3.6, Task 12 Step 3b (D4): that same transaction is also what makes `LeagueHome`'s
`DraftCompleteArrival` (`src/league-room/components/league-home.tsx`) possible — the drafted
roster and the Week 1 matchup it shows are read straight off `roster_slots` and this schedule,
with no second write and nothing new stored. See `docs/draft-room.md`, "The room's last moment
now hands off," for the full derivation.

## Lineups

Two tables, two different questions: `roster_slots` is **ownership** — what a team drafted, in
what slot — and never changes week to week. `lineup_slots` is **what you started in week N**,
one row set per team per week. A manager who never opens the lineup editor still fields a
legal team: `getLineup` (`src/league-service/lineups.ts`) falls back to `defaultLineup`
(`src/league/lineup.ts`), which expands the roster's drafted slot assignment into the full
lineup shape, rather than handing back an empty form.

`setLineup` reuses `validateLineup` (`src/domain/roster-eligibility.ts`) — the exact function
the draft engine uses to keep a roster legal — applied to the **starting slots only**, since it
treats an empty slot as invalid and a bench spot is legitimately allowed to be empty. Its
`reason` is returned to the client **verbatim**: it is already plain language, and paraphrasing
it a second time in the league-service layer would just be a second copy of the same rule to
keep in sync.

**The bench is derived server-side, never trusted from the client.** `setLineup` computes it as
exactly "everyone on this roster who isn't starting" — that is what lets `LineupEditor`
(`src/league-room/components/lineup-editor.tsx`) send only its starting-slot assignments and do
no lineup arithmetic of its own, which matters because `src/league-room/**` may not
value-import `@/league` at all (see "The client boundary" below).

**A week locks when it starts, not when it is scored.** `isWeekLocked` (`src/league-service/lineups.ts`)
reads the week's `stat_weeks.status` (global to the NFL calendar, never scoped by league — see
`weekStatusFor`) and delegates to `isLineupLocked` (`src/league/week-status.ts`): a week is
locked once its status is anything but `scheduled`, and `setLineup` refuses a write against a
locked week with a 409. A week the stats-ingestion worker has never reached has no `stat_weeks`
row at all, and that reads as `scheduled` — open — rather than as locked, because locking on the
row's absence would freeze every league's lineups the first time the worker was down, turning a
background-job outage into a product outage. This replaced Phase 1's "both scores exist" rule,
which was correct only when a score appeared solely because a commissioner pressed a button: with
scores that move on their own, a manager could otherwise watch a player leave the field and swap
him out before the week was ever scored. The lock is week-level, not per-player kickoff — it
errs toward locking a manager out early, which costs flexibility and costs nobody money; a
per-player lock needs a kickoff time this seam does not carry yet.

## Scoring and standings

`finalizeWeek` (`src/stats-pipeline/finalize.ts`) scores and settles one week. Phase 2 Plan B
retired the commissioner's manual "Score Week" button and route: the stats ingestion worker
calls `finalizeWeek` itself once a week's games are done, the same settlement write a
commissioner used to trigger by hand. `src/league-service/results.ts` carried a thin `scoreWeek`
delegate to it during the transition (R-B1); Plan B Task 8 deleted both the delegate and the
route together, so the worker is now the only caller. For each matchup it reads both
teams' saved (or default) starting lineup, scores the starters with `scoreLineup`
(`src/scoring/`) against the league's own `scoring_settings`, and writes both scores inside one
transaction — a half-scored week is not a result, it's a bug in progress, and
`computeStandings` deliberately ignores a matchup with only one score set. The scores are computed
INSIDE that transaction, from matchups read in a deterministic order, so a settlement can neither
be computed from a snapshot older than the data it writes against nor deadlock with a concurrent
copy of itself. Re-running is safe and reproduces identical numbers: it recomputes from the same
stored lineups and stat lines and overwrites.

Re-running is not hypothetical, and that matters for a week's final number. NFL official scoring
revisions run into the following week, and the worker records a game's box score the first moment
the provider calls it final — the earliest, least settled version of it. For three days after a
week settles the worker re-reads that week's box scores once a calendar day (its **correction
window**, `docs/decisions/live-scoring-pipeline.md` §10), and a revision that lands flows through
`finalizeWeek` into `matchups` and from there into the standings by the same machinery a first
settlement uses. After that window closes, the week's numbers are the ones that stand.

A league that finishes its draft AFTER one of its weeks has already settled is not left behind:
`finalizeWeek` refuses an undrafted league (its rosters do not exist, so every team would score zero
and the standings would show phantom losses), and the worker catches those weeks up on a later tick
once the draft is complete, a bounded number at a time.

`computeStandings` (`src/league/standings.ts`) tallies wins, losses, ties and both points
columns from finished matchups only, then sorts by the canonical ranking — **win percentage
(a tie counts as half a win), then points for, then team id** — a total order, so two clients
reading the same rows never disagree on placement. Win percentage rather than raw win count is
what keeps a 5-1-1 record ranked above a 5-2-0 one; a wins-only sort would call them equal and
fall through to points for, which has nothing to do with which team actually has the better
record. `roundPoints` (`src/scoring/`) is the same rounding function both the per-lineup
score and the standings' points-for/points-against columns use, so a team's own weekly total
and its season sum are never off by a rounding difference.

`clinchedTeamIds` (`src/league/clinch.ts`) is deliberately **conservative**: a team clinches a
playoff spot once its win total is strictly greater than what the first team *outside* the cut
could reach by winning every remaining week. A team that could still finish tied has not
clinched — a tiebreaker is a possibility, not a guarantee — so the celebration only fires on a
mathematically certain outcome.

## Real-time

**No `league.*`, `lineup.*` or `matchup.*` event type exists, on purpose.** Standings are still
a batch operation from the manager's point of view: nothing about a lineup save or the standings
table itself needs a push channel. A lineup change is visible only to the manager who made it
(`GET /api/leagues/[leagueId]/teams/me/lineup` answers the caller's own team, never anybody
else's), so broadcasting it would tell every other manager in the league about a private roster
move nobody asked to watch. Adding a channel nothing subscribes to would violate
`docs/conventions.md`'s "one closed taxonomy" rule for no gain.

**`score.update` is the one exception, and it now carries real traffic.** Phase 1 enumerated it
in `src/lib/realtime/events.ts` and never published it — there was no live feed to publish from.
Plan B's stats-ingestion worker (`src/stats-pipeline/worker.ts`) publishes it once per league per
tick that changed a player's stats or finalized a week, batched across every team the change could
have moved rather than per-player. See `docs/decisions/live-scoring-pipeline.md` for the full
contract (the payload shape, the version field, and why the score cache and the request budget
degrade in opposite directions).

League chat is the one thing on this page that IS live. `chat.message` and `chat.reaction` ride
the same `league:<id>:events` stream, gated by the same membership rule, and are consumed by
`useLeagueChat` rather than by anything in `src/league-room/**` — the panel is imported from
`src/chat-room/**` and mounted here. See `docs/chat.md`. That does not weaken the rule above:
a chat message is a genuinely new fact somebody just produced, whereas standings and lineups
are batch results with nothing to push.

## The client boundary

`src/league-room/**` is browser code under the **same** ESLint
`@typescript-eslint/no-restricted-imports` rule as `src/draft-room/**` and `src/chat-room/**`
(`eslint.config.mjs`, scoped to all three directories' `*.{ts,tsx}` files): it may not
value-import `@/league`, `@/league-service`, `@/db*` or `@/lib/realtime*` — only
`import type` (sharing a wire type like `LeagueHomeBody` costs nothing at runtime and is how
the client and server sides stay in sync) and plain `fetch`/SSE against `/api/leagues/**` and
`/api/invites/**`. The league room renders names straight off the server-shaped view (e.g.
`MatchupSide.teamName`) rather than looking them up client-side, so it has no id→name lookup
module of its own — `src/lib/display/lookups.ts`'s `teamsById`/`playersById`/`teamName`/
`playerName` pattern is a `src/draft-room/**`-only need (the draft room resolves ids against a
live pool the server never renders into text).

Pages under `src/app/**` are Next.js Server Components (`page.tsx`) and route handlers
(`route.ts`), which are outside that rule and read the service layer directly — the idiomatic
Next.js pattern. `src/app/app/leagues/[leagueId]/page.tsx` and its `matchups/[week]/page.tsx`
sibling both call `leagueHome`/`matchupWeek`/`lineupView` straight from `@/league-service` and
hand the assembled body to a presentational component (`LeagueHome`, `MatchupPanel`) imported
from `src/league-room/**`; any interactivity those pages need is a `"use client"` component
from that same directory, never inlined into the page file.

## Routes

Every `/api/leagues/**` and `/api/invites/**` route goes through `src/app/api/leagues/_shared.ts`:
`withCurrentUser` (401 JSON, never a redirect), `withLeagueMemberActor` (membership required,
403 for a signed-in stranger with no team and no commissioner role), and `withCommissioner`
(the one commissioner-only action, minting an invite — the manual "Score Week" action Plan B
retired was the other). Every response is the same envelope
(`{ ok: true, data }` / `{ ok: false, error }`) every other route in the app uses.

| Route | Who | Notes |
|---|---|---|
| `GET /api/leagues` | any signed-in user | Every league the caller fields a team in, oldest first, with fill count and draft status. |
| `POST /api/leagues` | any signed-in user | Body: `{ name, format?, teamCount?, scoringPreset?, rosterShape?, auctionBudget?, teamName?, visibility?, stakeTier?, experienceTier? }` — only `name` is required. Creates the league, the caller's team and a scheduled draft in one transaction. `visibility: "public"` (default `"invite_only"`) is what sets `is_public_matchmade` and makes the league eligible for `GET /api/public/leagues`; `stakeTier` (0-3, default 0) and `experienceTier` are the cosmetic/matching fields a public listing shows. |
| `GET /api/leagues/[leagueId]` | a manager with a team in the league, or the commissioner | `leagueHome`: standings, this week's matchup, the roster shape, the draft's status and the league's terms (`LeagueTerms` — see "League terms" above), in one payload, for every member. |
| `POST /api/leagues/[leagueId]/invites` | commissioner only | Body: `{ maxUses? }`. Mints a code; randomness is `crypto.getRandomValues`-backed, never `Math.random`, since a code is a membership capability. |
| `GET /api/invites/[code]` | **anyone holding the code, signed in or not** | `invitePreview`: the same `LeagueTerms` `leagueHome` carries, for whoever holds the code — the code itself is the capability. An invalid, expired or exhausted code returns only the refusal, never a league name, so this cannot be used to enumerate private leagues. |
| `POST /api/invites/[code]/accept` | any signed-in user | Body: `{ teamName? }`. Joins the caller to the invite's league. Re-accepting your own invite is a 200, not an error. |
| `GET /api/leagues/[leagueId]/matchups/[week]` | a manager with a team in the league, or the commissioner | Both sides' full lineups and every starter's per-player points for that week. |
| `GET /api/leagues/[leagueId]/teams/me/lineup` | a manager with a team in the league | `?week=N`. The caller's OWN lineup, never `teams/[teamId]/lineup` — there is no path or body shape in which a manager can read or set somebody else's. |
| `PUT /api/leagues/[leagueId]/teams/me/lineup` | a manager with a team in the league | Body: `{ weekNumber, slots }`. A rejected lineup (illegal slot, unowned player, a locked week) is a 409/422 with `validateLineup`'s reason verbatim. |
| `GET /api/leagues/[leagueId]/events` | a manager with a team in the league, or the commissioner | The same Redis-Streams-over-SSE fan-out the draft room uses (`docs/draft-engine.md`), gated by the same membership rule — a signed-in stranger gets 403, not another league's stream. Now also carries `score.update`, published by the stats-ingestion worker — see "Real-time" above. |
| `GET /api/leagues/[leagueId]/chat` | a manager with a team in the league, or the commissioner | `?before=<messageId>`. One page of `CHAT_CONFIG.pageSize` messages, oldest first, with `hasMore`. There is no unpaginated read. |
| `POST /api/leagues/[leagueId]/chat` | same | Body: `{ body }`. The author is the session's user; no body field can change it. |
| `POST /api/leagues/[leagueId]/chat/[messageId]/reactions` | same | Body: `{ emoji }` from `CHAT_CONFIG.reactions`. One verb toggles both directions. |
| `POST /api/leagues/[leagueId]/advisor/start-sit` | a manager with a team in the league | Body: `{ weekNumber, question }`. Answers advice. Writes nothing. |
| `POST /api/leagues/[leagueId]/advisor/trade` | a manager with a team in the league | Body: `{ weekNumber, counterpartyTeamId, give, receive }`. Assesses a proposal. Never executes one. |
| `GET /api/public/leagues` | **anyone, signed in or not** | `?format=&experienceTier=&stakeTier=`. Open, publicly listed, pre-draft leagues only, projected to `PublicLeagueSummary`. The one unauthenticated read in the app. |
| `POST /api/public/leagues/[leagueId]/join` | any signed-in user | Seats the caller in an open public league. 404 (same body either way) if the league id names nothing OR names a league that isn't public — deliberately collapsed, the same way `acceptInvite` collapses an invalid invite, so a caller cannot use this route to learn whether a private league id is real. 409 if its draft started or it is full, 500 on an unexpected failure. Re-joining is a 200. |

## Public matchmaking

Two ways into a league, one core. An **invite** is the private path (`acceptInvite`); **public
browse** is the open one (`joinPublicLeague`). Both call `joinLeagueInTx`
(`src/league-service/join.ts`), which takes the league row `FOR UPDATE` before counting teams
and inserts inside the caller's transaction. Two independently-written capacity checks are two
places the same league's fill count can disagree, and the disagreement only ever shows up as a
13th team in a 12-team league. Each path's own rules (an invite's expiry and use cap; a public
league's listing and draft status) run through a `JoinPrecondition` hook that fires only for a
caller who is **not** already a member, which is what keeps re-arriving free on both paths.

**The sit-and-go fill trigger (Phase 3.5, Task 7).** `fireWhenFullInTx`
(`src/league-service/fill-trigger.ts`) runs unconditionally, inside `joinLeagueInTx`'s own
transaction, after every seat this codebase ever seats — it re-derives fullness itself
(`hasOpenSeat`, the same predicate the caller just used for its own capacity check) rather than
trusting a boolean computed a moment earlier, because the function is called directly by its own
tests too. It fires ONLY for a draft whose `start_trigger` is `'when_full'` (never for an ordinary
scheduled draft), and it writes exactly one thing: `drafts.kickoff_at`, moved to
`now + MATCHMAKING_CONFIG.sitAndGo.graceSeconds`. It never calls `startDraft` itself — the
existing ticker that already scans `drafts` for a passed `kickoff_at` (`autoStartDueDrafts`) picks
the write up and starts the draft through the same guarded, cross-instance-safe path a
commissioner's own button uses. `createLeagueSchema` refuses `startTrigger: "when_full"` on
anything but `visibility: "public"`, so a private league can never reach this trigger in the first
place. See `docs/decisions/formats-and-lobby.md` §6 for the full reasoning.

**The privacy boundary.** `GET /api/public/leagues` is the one unauthenticated read in this
application. What a stranger may learn is `PublicLeagueSummary` (`src/matchmaking/contract.ts`)
and nothing else — **seventeen fields as of Phase 3.6 (v2)**: id, name, format, experience
tier, stake tier, team count, filled count, `scoringLabel` (derived, never the raw weights),
`compositionCategory` (the coarse participation-mix bucket), `draftAt` (an absolute-plus-relative
sentence), `medianGame` (whether this league plays the median game), `startTrigger`
(`"scheduled" | "when_full"` — see below), `houseRung` (`HouseRungName | null` — non-null only
on the house shelf's own rows, see below), `heldSeats` (Task 6 — how many seats are mid-claim
right now, rendered through `SeatMeter` and nothing else; a fact about the league's capacity, the
same disclosure reasoning `filledTeams` already carries), `rosterSummary` (Task 5 — a derived
sentence like "15 slots, 1 flex" from the league's stored roster-slot rows), `playoffWeeks` (Task
5 — the raw week numbers the platform's standard bracket runs across, computed from config for
every row rather than read off a per-league column), and `kickoffRolls` (Task 7 — how many times
`rollUnfilledDraftInTx` has pushed this scheduled league's kickoff forward; `0` for every
`when_full` league by construction, read through `rollNoticeSentence` and never rendered as a bare
number). No commissioner identity, no team or owner names, no invite code, no draft id, no
standings, no rosters, no chat, no scoring settings. Three things enforce it: `is_public_matchmade`
is opt-in and false by default, `listPublicLeagues` selects exactly the contract's columns, and a
key-set test fails if the wire body ever grows a field the contract does not name. A league that
is full, or whose draft has already started, is not listed at all: a card a visitor cannot act on
is a dead end wearing a badge.

**The roll (Phase 3.6, Task 7 — "no draft ever fires below a full room").** Every scheduled,
public matchmade draft whose kickoff has passed and whose room is not full gets its kickoff
rolled forward instead of firing short. `rollUnfilledDraftInTx` (`src/league-service/roll.ts`)
takes `leagues[leagueId] FOR KEY SHARE` before touching `drafts` — closing a real deadlock cycle
against a commissioner's own `setDraftKickoff` reschedule without serializing the roll's own
self-race — then re-derives both due-ness and fullness fresh, immediately before its guarded
write, because either fact can go stale between the scan that found the row and the transaction
that would act on it. A `when_full` draft is exempt from the roll by construction (`Step 2`'s own
model ruling: it has no chosen time to be late for until it fills). Every seated member gets a
`draft_kickoff_rolled` notice naming the new kickoff and quoting `rollNoticeSentence`
("moved once" / "moved twice" / "moved N times since it was scheduled") and
`describeStartTiming`; from the second roll onward, the notice also carries the release
paragraph (below). A public matchmade league's commissioner cannot undercut the ruling by hand
either: a manual (non-auto) `startDraft` press on a public, non-house league below a full room is
refused (`PUBLIC_ROOM_SHORT_REFUSAL`) — a private league's manual press is unaffected, since there
is no other way for its commissioner to ever draft in a league nobody else can start for them, and
a house league has no commissioner to press anything.

**The seat release (Phase 3.6, Task 8 — the escape hatch the roll requires).** `releaseSeat`
(`src/league-service/release.ts`) lets a member leave a league whose draft has not started,
freeing their seat immediately. An uncapped roll needs a door out to stay humane rather than
becoming a trap (ruling 16): drafting a permanently short room is forbidden, and this product has
no way to cancel a league, so the roll alone would otherwise mean waiting forever with no exit. If
the departed team's seat had un-filled a sit-and-go league that had already fired its fill trigger,
`releaseSeat` clears `drafts.fill_fired_at` and sends every remaining seated member a
`draft_fill_reversed` notice — the other half of `draft_fill_triggered` — quoting
`DRAFT_FILL_REVERSED_SUMMARY`: "A seat opened up, so we put this league's draft back to waiting
for a full room." A league's commissioner cannot release their own seat (`RELEASE_REFUSALS.
commissioner`) — there is no commissioner-transfer path yet, the same dead end
`HOUSE_AUTHORITY_REFUSALS` names for a house league's own two closed doors — and a house league
never reaches that refusal at all, since nobody is ever `isCommissionerOf` one.

**The house shelf (Phase 3.5 addendum, Task 14) is a second query, not a sort key on the first.**
`listPublicLeagues` returns `{ leagues, house }`: `browseQuery`'s own `WHERE` excludes house
leagues (`isNull(leagues.houseRung)`), and `houseShelfQuery` runs the mirror `isNotNull` predicate
with its own ordering and takes no `BrowseFilter` parameter at all — not merely unfiltered by
default, structurally unable to be narrowed. The shelf orders **soonest-draft-first across every
rung** (`ORDER BY drafts.kickoff_at ASC`), not by `leagues_house_rung_idx`'s own `created_at`
column — the two coincide within one rung, since a `scheduled` rung's kickoff is itself
creation-ordered by its stagger, but not across rungs, since `open_12` and `beginner_12` stagger on
independent clocks. `HouseLeagueShelf` (`public-league-list.tsx`) renders it above the filters and
the member list, one card per open house league, and prints "A new league opens as soon as one
fills, so there is always a seat." beneath the shelf once — a promise `HOUSE_CATALOG`'s own
reconciler (`ensureHouseCatalog`, `src/league-service/house-factory.ts`) is what makes true by
construction. See `docs/decisions/house-leagues.md` for the schema and reconciler this shelf reads.

**A `when_full` league shows a sentence, not a date.** Its stored `kickoff_at` is a placeholder
until the sit-and-go fill trigger rewrites it (below), and rendering that placeholder as a real
time would put a specific, wrong evening on a public card. `PublicLeagueList` reads
`startTrigger` and renders "Starts as soon as it fills" instead of `draftAt` whenever it is
`"when_full"` — how a league starts is a fact about the league, the same disclosure reasoning
`draftAt`, `scoringLabel` and `compositionCategory` each already established.

**The card gets an order, not a progress bar.** A nearly-full league needs to be *findable*, which
`listPublicLeagues` (`src/league-service/browse.ts`) answers by ordering the result — seats
remaining ascending (`team_count` minus the joined seat count), then oldest first
(`created_at`) — rather than by showing a fill meter on the card. The card's own docblock already
ruled a progress bar out (*"the number is the decision a visitor is actually making and a bar
makes them estimate it"*); this phase measured the ordering (an `EXPLAIN` assertion plus a
mutation proof, `src/db/index-plans.test.ts`) rather than reopening that decision, and it costs
nothing extra since the query already aggregates before it sorts.

**Filtering** is `League.experienceTier`, `League.format` and `League.stakeTier`, normalized by
`normalizeBrowseFilter`, the pure function that turns a query string into a `BrowseFilter`.
Unknown values (`?format=dynasty`) normalize to "any" rather than erroring, because browse is
reached by hand-edited URLs and stale bookmarks and the honest answer is the list we can offer.
Only `'snake' | 'auction'` are offered, because those are the two formats the draft engine
runs. `leagues.experience_tier` is a **league-level** column rather than a read of the
commissioner's own profile: deriving it from a person would leak that person into an
unauthenticated read and would silently re-tier every league they run whenever they edited
their profile.

Browse is ONE grouped query (`src/league-service/browse.ts`): the fill count is
`count(teams.id)` over a `LEFT JOIN` (so a league with no managers still appears), the open-seat
rule is a `HAVING count(teams.id) < leagues.team_count` predicate, and every narrowing is applied
before the `LIMIT`. That ordering is the correctness property — the earlier two-query form
applied the cap first and filtered in JavaScript afterwards, so a narrow filter over a large
public pool returned an under-filled page. `matchesBrowseFilter`/`hasOpenSeat` remain the
canonical, 100%-covered statement of the rule, and `browse.test.ts` runs all 45 filter
combinations through both the query and the pure rule over one corpus, demanding identical
answers.

**Stake tier is cosmetic.** No entry fee is charged, no prize is paid and no balance exists
anywhere in Phase 1. `MATCHMAKING_CONFIG.stakeDisclosure` is the one wording of that promise,
rendered on the create form beside the tier control and on the browse page beside the cards.
Real money arrives in a later phase behind FBO/agent-of-payee handling, KYC/AML screening and
tax reporting.

**Signed in changes the button, not the list.** `GET /browse` itself needs no session (the
whole point is that a stranger can see what is on offer before creating an account), but joining
does. `PublicLeagueList` (`src/league-room/components/public-league-list.tsx`) renders every
card from the same `PublicLeagueSummary` rows either way; only the call to action differs. A
signed-in visitor gets the real `JoinPublicLeagueButton`. A signed-out one gets a plain "Sign in
to join" link to `/sign-in`, so the page never shows a button whose press would just bounce off
a 401. The two states are two different pieces of markup, not one button with a client-side
guard in front of it.

## Known follow-ups

- **No UI starts a draft.** `POST /api/drafts/[draftId]/start` exists and is commissioner-gated,
  but nothing in the draft room calls it. The seeded dev drafts are driven by
  `scripts/drive-dev-draft.ts`, and `e2e/league-lifecycle.spec.ts` posts the route directly with
  its real session. A commissioner using the product has no button. That is a real gap, not a
  test-harness convenience, and it belongs in the next phase's scope.
- **Playoff brackets and a championship.** `clinchedTeamIds` names who is in; nothing in Phase 1
  plays a postseason. A bracket needs seeding rules, a tiebreak policy and a bye structure that
  no spec step has defined yet.
- **Per-league scoring customization beyond the four presets.** `scoring_settings` is already
  per-league and fully populated from whichever `SCORING_PRESETS` entry a commissioner picks at
  creation, so a future settings screen granting field-by-field control is a UI change, not a
  schema change.
