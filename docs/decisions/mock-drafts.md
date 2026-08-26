# Mock Drafts — Phase 4.5

The decision record for the practice-draft pass (`docs/superpowers/plans/2026-08-25-phase4p5-mock-drafts.md`,
founder-ordered 2026-08-25). Read this with `docs/mock-drafts.md` (what shipped and where it
lives); each section here records what was chosen, why, and what would have to change for the
choice to be wrong — written to the code that shipped. Rulings 1–13 were self-ruled at planning
and surfaced to the founder with the override window open; 14–16 were ruled mid-phase, in the
ledger, at the moment their facts arrived.

## 1. A mock is a `leagues` row, never a parallel `mock_drafts` table set

The plan's biggest call, argued from the dependency graph. The room the founder ordered
showcased is welded to `drafts`/`leagues`/`teams`: `loadDraftConfig` joins `leagues` for the
roster shape, `startDraft`'s thunk reads `teams` under the draft's own row lock, replay reads
`draft_actions`, SSE rides `league:<id>:events`, chat and the moderator both key off the
league. A parallel table set forks every one of those seams into a second implementation that
drifts from the first — the exact drift `writeLeagueInTx`'s own docblock exists to prevent at
one seam, multiplied by six. The cost of the column is the exclusion audit, and that audit came
out SMALL because the codebase already routes every public aggregate through
`ENFORCED_LEAGUE_SQL`: one query needed a predicate (`leaguesFilledQuery`), one read needed
scoping (`myLeaguesOverview`), and the store needed the mock lane it needed under either
design. The heavyweight parts of a real league (audit chains, notices, money, seasons, holds,
tiers) are not table weight — they are WRITER behavior, and the mock lane turns each off at its
one writer. **Wrong only if** mock and real semantics diverge so far that the shared row forces
contortions worse than six drifting seams — nothing this phase found.

## 2. The audit law is carved out for mocks — and that carve-out is what makes retention possible

`audit_events` refuses `DELETE` at the database (migration 0019's triggers), deliberately — so
"no permanent rows" and "mocks are audited" are jointly unsatisfiable. The audit spine exists
so money, seats and conduct in REAL leagues are tamper-evident; a practice room has none of
those stakes, and an audit trail for it would be noise wearing a uniform. The carve-out is
enforced positively (the statement-spy differential test, both directions) rather than by
convention; `MOCK_NOOP_AUDIT` is one named, docblocked, greppable value; and the real-league
mirror drive proves the real path still audits byte-identically. This clause is what makes the
sweep's `DELETE FROM leagues` legal at all — see `docs/mock-drafts.md`.

## 3. Bots submit `MAKE_PICK` through `store.applyAction`; they do not ride `TIMER_EXPIRE`

Three reasons. `admitTimerExpire` refuses early expiry by design (the check-then-act race
guard), so bots-as-expiry means every bot waits the full clock — a dead room at any clock a
human would tolerate. Expiry semantics are the SAFETY NET's semantics (skip-and-owe, catch-up),
and overloading them with "the bot is thinking" would tangle two meanings in the log. And the
driver path reuses the entire single-writer machinery — mutex, row locks, sequence backstop,
broadcast — so a bot pick is exactly as safe as a human one. The engine's real expiry stays
live in mocks as the human safety net, unchanged. (Restated as D9: one engine, one writer, one
log; bots are callers, never machinery.)

## 4. Sign-in-first: the mock is the landing reward, not an anonymous toy

Signed-out mocks need a guest identity flowing through `requireCurrentUser`, `getCurrentUser`,
`resolveLeagueMembership`, `teams.userId`'s FK, chat attribution and notices — a parallel
identity system, against the standing law that WorkOS owns identity behind one seam. The
acquisition math still works: the front-door CTA carries intent through the existing `returnTo`
machinery, AuthKit's hosted sign-up is one screen, and the visitor lands INSIDE `/app/practice`
with their click preserved. The signed-out lobby VIEW (the `/app/join/<code>`
middleware-exemption precedent) is the cheap future half, deferred (D1) rather than smuggled in.

## 5. No draft grade

A letter grade is manufactured authority: the platform has no outcome data on a draft that
never plays, and the real-only founder rule ("a number is a query or it does not render")
applies to invented judgments hardest. The results page ships facts derived from the draft's
own log — roster by slot, pick-versus-board deltas from the pool snapshot — the same "how did
I do" answer without the platform pretending to know football better than its own rankings.
(Refused permanently as D6.)

## 6. Bots are seeded `users` rows, not a nullable `teams.userId`

Making `userId` nullable touches every consumer of the column (lineups, standings, notices,
trades, chat, the name join) to handle a null only mocks produce. A 24-name roster of `is_bot`
users costs one column, one seed, and zero consumer changes — the unique `(leagueId, userId)`
index even enforces one-seat-per-bot for free. Bot users have unroutable reserved emails, no
sessions, and appear nowhere the exclusion tests sweep. This also reverses
`docs/decisions/formats-and-lobby.md`'s "out for a schema reason" exclusion of mock drafts —
the schema reason (`teams.user_id NOT NULL`) is answered by real rows, not by relaxing the
constraint.

## 7. The RNG is a thirty-line seeded PRNG behind an `Rng` interface, not a dependency

The DI law's whole point: tests pass fixed seeds, the seed is stored on the row
(`mock_rooms.bot_seed`), and a bug report's draft is replayable to the pick. `Math.random` is
banned from the mock path by review AND by the determinism property test, which would flake the
moment ambient entropy leaked in. Stream keys (bot ids, `"archetypes"`, the delay streams) are
load-bearing replay identity and must never be renamed under an in-flight seed.

## 8. `src/mock-draft` is pure but BLOCKED, not the tenth exempt directory

The `src/integrity` precedent: the bot brain value-imports `@/draft-engine`, which rooms must
never reach as a value, and `MOCK_CONFIG.strategy` is a playbook a member could solve. The two
config values the setup form needs cross as props from the server page — the pattern
`src/app/**` pages already use legally — so the exempt list stays at nine and the boundary
stays sharp. See `docs/conventions.md`'s client-boundary section.

## 9. No seat holds, no tier gate, no money gate on a mock seat

The hold exists to make a paid, scarce seat race humane; a practice seat is free, plentiful
(another room is one click away) and bot-backstopped. The claim is one guarded insert under the
league lock, and losing the last-seat race reads as "that room just filled — here is another",
never a held-seat ceremony.

## 10. The lobby shows request-time seat counts with a refresh, not a pre-seat SSE fan-out

The wire's own honesty ruling (no anonymous SSE) applies verbatim: the lobby is a browse
surface, its numbers are stamped at render, and the ONE place liveness matters — inside a
claimed room — already has the league stream. A lobby socket is deferred with the same fact it
was last time (D4).

## 11. The moderator stays on in mocks, aimed only at humans

The nudge is a differentiator the first-timer should meet BEFORE their real draft — that is
what a rehearsal is for. Spend is bounded (one nudge per turn, `draft_nudges`-claimed, LLM
behind a timeout with template fallback), bot turns are guarded off structurally
(`nudge.ts`'s `isBotCache`), and if August volume ever makes the spend real,
`NudgeCopyDeps.enabled` is the existing kill switch — a config flip, not a redesign.

## 12. Snake only this phase; auction mocks deferred, not refused

An auction bot is a second brain (valuation, budget pacing, nomination strategy) with none of
it shareable from the snake sampler. The schema does not preclude it (`mock_rooms` carries no
format assumption; `format` lives on `leagues` as always), and D2 names what it waits on.
"Auction only if cheap" — it is not cheap, and a bad auction bot would violate the credibility
bar the veteran persona holds.

## 13. The sweep deletes; it does not archive

A practice draft's afterlife is the results page for a day. Archival tables for rehearsals
would be the product keeping data nobody asked it to keep — the retention windows are config,
the results page's retention sentence tells the user the rule up front, and the delete is a
cascade whose completeness is asserted table by table. A member reaching a swept code afterward
gets `MOCK_REFUSALS.missing` with a lobby link — deliberately the SAME answer a never-issued
code gets (the no-existence-oracle rule `mockRoomSummary`'s docblock states), which is why the
plan's separate swept-room sentence was removed at closeout rather than wired: distinguishing
"swept" from "never existed" is exactly what that rule forbids.

## 14. Bots honor a queued entry outright — `bestAvailableFor`'s own rule, stated once

`chooseBotPick`'s preference order mirrors `bestAvailableFor` exactly: a legal queued player
first, then the rank-weighted sample. Bots hold no queues today, but the autopick policy is
stated once, not twice — settled at Task 3's review as consistent engine behavior, not
invention: if a bot ever DID hold a queue, honoring it outright is what the real room already
does.

## 15. The mock lane MAY settle `drafts.status = 'complete'` (Task 6, ruled on the ticker's own concern)

Finished mocks were occupying `liveDraftsQuery` scan slots (LIMIT 50) for their whole 24h
retention because `drafts.status` stayed `in_progress` — Task 4's writer invariant forbids the
season-commit EFFECTS, not a bare status column. Ruled: the driver settles status via a guarded
`is_mock`-only UPDATE on replayed completion. This freed the scan slots (regression-pinned),
let the sweep's started-room scans become two pure-SQL passes on a trustworthy status, and the
differential proof was extended over the settle (still zero consequence statements).

## 16. Bot accounts are structurally refused from real leagues (Task 5, the claim-writers rule)

`users.is_bot` joining a real league is refused with a 403 at both doors (public join and
invite accept), proven both ways. The exclusion contract runs in both directions: no mock row
in a real aggregate, no bot row in a real league.

## Deferred and refused, each with the fact it waits on

| # | Item | Decision | The fact it waits on |
|---|---|---|---|
| D1 | Signed-out mock drafts / guest sessions; signed-out lobby VIEW | **Deferred** | Ruling 4. The view half waits on a product call that anonymous practice-browsing earns its middleware exemption; the play half waits on an identity design that does not fork the WorkOS seam. |
| D2 | Auction mock drafts | **Deferred** | Ruling 12: an auction bot brain (valuation, budget pacing, nomination) with credibility the veteran persona would sign. Schema already permits it. |
| D3 | Bots that "learn from everyone's drafts" (ADP from real drafts, ML) | **Deferred to Phase 6, explicitly** | This phase ships rankings + heuristics only, and the copy rulebook BANS claiming otherwise. |
| D4 | Live SSE seat counts on the lobby shelf | **Deferred** | The wire's no-anonymous-SSE ruling; request-time truth until a real liquidity problem shows in the lobby's own numbers. |
| D5 | Mock-to-real conversion ("liked this room? make it a league") | **Deferred** | Needs the real creation flow's money/tier gates rethreaded from a mock context; the browse shelf is one click away meanwhile. |
| D6 | Draft grades / letter scores on results | **Refused** | Ruling 5: manufactured authority; the real-only rule. Pick-versus-board deltas are the honest ceiling. |
| D7 | "AI opponent" branding, difficulty tiers marketed as intelligence | **Refused** | The C3-family honesty law. Archetypes are texture; the product claims practice, not intelligence. |
| D8 | Mock results feeding proof stats, the wire, or any acquisition number | **Refused, permanently** | The founder's trust framing: a rehearsal never counts. `NOT is_mock` on `leaguesFilledQuery` plus the exclusion suite is the enforcement. |
| D9 | A second pick path or a bot-owned reducer branch | **Refused** | Ruling 3: one engine, one writer, one log. Bots are callers, never machinery. |

## Watch item (flagged, not gated)

Mock volume multiplies moderator-LLM nudge calls and per-league ranking computations; both have
existing bounds (nudge claim rows, the per-league cache) and both are metered in the logs the
ticker already writes. If August traffic makes either a real cost line, the kill switch
(`enabled: false`) and a preset-keyed ranking cache are the two named follow-ups — config
changes, not redesigns.

## Cross-cutting notes for later phases

- **The migration process law** born in this phase's Task 2 fix round (applied migrations are
  never amended, always followed on — drizzle's migrator gates on the latest tracking row's
  timestamp, never a content hash) is recorded in `docs/conventions.md`'s migrations section;
  the mock-privacy CHECK shipped as follow-on `0043`, not an amend of the mock-drafts migration.
- **The R2 carry** (from the draft-room design review, landed here at Task 10): the scheduled
  rail's waiting story is trigger-true — `DraftSnapshotBody.waiting` quotes
  `describeStartTiming` verbatim for real leagues and `MOCK_COPY.waitingDetail` with the fill
  window's `starts_at` countdown for mocks; the rail never invents a commissioner again.
- `commitDraftResults` (a second `commitDraftState` entry point, currently unwired) is NOT
  `isMock`-guarded — whoever wires a route to it adds the guard or the carve-out has a hole.
