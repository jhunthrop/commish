# House Leagues — Phase 3.5 addendum

Written to the code that shipped (Tasks 12-15), not to the plan that proposed it
(`docs/superpowers/plans/2026-08-22-phase3p5-addendum-house-leagues.md`). Read this with
`docs/decisions/formats-and-lobby.md` (the parent plan's own new doc — the house shelf sits
beside the sit-and-go trigger it already describes) and `docs/league.md` (the wire-level
consequences of a league with no member commissioner). Every ruling below that survived contact
gets a section; every one that changed gets the correction, not the original.

## 1. The schema question — a nullable commissioner column with a CHECK, not a synthetic user

Three candidates were weighed against the shipped answer.

**A system "house" `users` row** would have been the smallest diff: it satisfies the `NOT NULL`
foreign key `leagues.commissioner_user_id` carried before this addendum, and every existing
`=== userId` comparison keeps compiling and returns `false` for every real person, which is
correct behavior. It was rejected on three grounds, all still true of the shipped code. `users.id`
IS the WorkOS user id (the Global Constraints say so, and `getCurrentUser()` is built on it) — a
row whose id names no WorkOS user makes that invariant false for every path that assumes a `users`
row is a person who can sign in. There is no exemption mechanism anywhere in the integrity stack —
`SweepDeps`, `sweepUnflaggedTrades` and the chain verifier all carry no exclusion field, and every
"does not apply here" decision in this codebase is a structural predicate rather than a set of ids
— so a house user would be the first exempted identity in the product's history, and because a
detector may only flag, never act, an un-exempted one would simply generate advisory noise
forever. And the nearest precedent, `BOOTSTRAP_ACTOR`, argues the other way: it is a sentinel
string at a boundary that collapses to `(null, "system")` before storage, fenced by a grep
tripwire with exactly three callers — a boundary convention, not a row.

**The shipped answer: `leagues.commissioner_user_id` becomes nullable, and `NULL` means the
platform commissions this league** (`drizzle/0032_house_leagues.sql`). This reuses a sentence the
codebase already tells: `audit_events.actor_id` is nullable, carries no foreign key at all, and
`src/domain/audit.ts:71` states its invariant as "Null only when `actorType` is `\"system\"`."
The existing representation of "the platform did this and there is no user row for it" is the
absence of an identity; a house league applies that same answer to a second column.

Null is ambiguous on its own — it can mean "no commissioner," "not loaded," or "we forgot" — and
that objection is closed by construction, not argued away: `house_rung` is added alongside
`commissioner_user_id` and

```sql
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_house_commissioner_ck"
  CHECK (("house_rung" IS NULL) = ("commissioner_user_id" IS NOT NULL));
```

commits only two states — a member owner with a commissioner and no rung, or a house owner with a
rung and no commissioner — and refuses everything else, including both-null and both-set, before
the row exists. Verified live, not merely declared: a hand-written `INSERT` with both columns
`NULL`, and one with both set, each raise
`ERROR: new row for relation "leagues" violates check constraint "leagues_house_commissioner_ck"`
against a real Postgres (Task 12's own verification, re-run for this task's battery below). A
pleasant, non-rhetorical second-order consequence: a null foreign key acquires no `FOR KEY SHARE`,
so the factory's `leagues` insert takes no parent lock at all — recorded in
`src/integrity-service/lock-order.test.ts`'s enumeration and in `house-factory.ts`'s own docblock.

**`leagues.created_by_house` boolean, with commissioner functions routed to the operator surface**
was half-adopted. The column is adopted in a better form: `house_rung` carries the boolean's one
fact (a league is house-run) plus the fact the reconciler and the browse card both actually need
(which rung), so nothing is encoded twice and free to disagree. The routing is rejected outright —
see §6.

## 2. Authority as a discriminated union, and the seven comparisons it replaced

`src/league-service/authority.ts` is the one answer to "who commissions this league":

```ts
export type LeagueAuthority =
  | { readonly kind: "member"; readonly userId: string }
  | { readonly kind: "house"; readonly rung: HouseRungName };
```

`leagueAuthority(row)` reads the union off a raw `leagues` row and throws on either shape the CHECK
constraint should already have refused (a row naming both, or neither) — a unit test can still
construct that shape by hand even though Postgres cannot commit it, so the invariant is stated in
TypeScript as well as in DDL. `isCommissionerOf(row, userId)` is total over the union and returns
`false` on the `house` branch before comparing anything, which is the property that matters: a
nullable `commissionerUserId === userId` comparison is a silent authority grant the moment `userId`
is ever widened to `string | null | undefined`, and `isCommissionerOf` cannot fail that way because
its `house` branch never reaches a comparison at all.

Seven call sites collapsed onto it: six files each did their own `commissionerUserId === userId`
(`src/lib/leagues/membership.ts`, `src/league-service/read.ts`, `home.ts`, `draft-schedule.ts`,
`invites.ts`, `src/integrity-service/flags.ts`), plus a seventh comparison inside `read.ts` itself
— a `commissionerTeamId` lookup via `.find()`. All seven now read `isCommissionerOf` or
`leagueAuthority` from the one module.

**Correction to the plan's own claim.** The type shipped in two stages, not one. Task 12 (the
schema task) typed `LeagueAuthority.rung` as a plain `string`, because `src/matchmaking/
house-catalog.ts` — the one legal place `HouseRungName` may be declared — did not exist yet in
that worktree, and declaring a second `HouseRungName` ahead of the catalog would have violated
this codebase's own "declared once" rule for label-map types. Task 13's fix round narrowed it to
the real `HouseRungName` (`import type` only, no runtime dependency) the moment the catalog landed,
and corrected both docblocks that had promised the narrowing "the day the catalog exists" to state
it as done. The end state matches the plan's own interface signature; the sequencing across two
tasks does not, and is recorded here rather than smoothed over.

## 3. A reconciler on the existing ticker, not a hook in the join transaction

The obvious design spawns a replacement inside `joinLeagueInTx`, on the tick of the twelfth seat,
beside the sit-and-go fill trigger. The shipped design (`ensureHouseCatalog`,
`src/league-service/house-factory.ts`) is a level-triggered reconciler that `src/draft-service/
ticker.ts` calls on an interval instead, for three reasons that all survived contact. A factory
error inside the join transaction would roll back a stranger's own seat, since the audit append and
notice row already live inside that business transaction by this codebase's own rule. An edge
trigger that does not fire leaves the shelf permanently short with nothing to notice; a level
trigger that misses a tick fixes itself on the next one — there is no missed-event failure mode
because there is no event to miss. And a join is the wrong place to pay for a league creation:
three inserts and an audit append on a stranger's own request latency, for a thing nobody in that
request is waiting on.

The tick order is deliberate and tested both ways: `ticker.ts` runs `autoStart`, then
`reconcileHouse` (gated by `DRAFT_SERVICE_CONFIG.houseReconcileIntervalMs`), then the expiry scan
— so a house league whose draft this tick just auto-started is already off the shelf before the
reconcile count runs, and the two never observe each other's half-finished state.

**Proven end to end, not just argued.** Task 13's fix round added an integration test
(`house-factory.test.ts`) that stocks the shelf through the real `ensureHouseCatalog`, fills a
spawned `open_12` league to capacity through the real `joinPublicLeague` door, advances a local
clock past its real staggered kickoff, starts it through the real `autoStartDueDrafts`, and asserts
a second `ensureHouseCatalog` call restocks the shelf with a genuinely fresh edition — never a
resurrection of the one that just started. The reconciler-to-auto-start-to-reconciler loop is
proven against real code end to end, not assumed from each half's own unit tests.

## 4. Primary-key idempotence, because leader election does not exist here

PgBouncer's transaction pooling mode forbids `pg_advisory_lock` (`docs/decisions/
data-layer-hardening.md`), so leader election among app instances is unavailable by construction —
the same constraint `autoStartDueDrafts` already lives under. Two reconciler instances racing to
restock the same rung on the same tick is therefore a case to *resolve*, not *prevent*.

The shipped resolution is a deterministic id — `house_${rung}_${edition}` — plus
`.onConflictDoNothing()` on the `leagues` insert, the same primary key the table already has; no
new unique index was added. `ensureHouseCatalog`'s own loop re-reads both the open count and the
next edition immediately before every attempt rather than computing a shortfall once, so a lost
race (the other instance's insert already committed) is visible on the very next read instead of
assumed away. `nextEdition` scans every league a rung has ever produced — filled or still open —
rather than the highest currently open one, so a replacement's id is never reused; a resurrected
edition would be a second league silently sharing one id's history with a league that already
finished.

**Proven on two real connections, not one.** `house-factory.test.ts`'s concurrent-instance test
opens two genuine `createTestDb()` connections and races them against the same rung — a
single-connection test proves nothing about the case this defends against, since a single
connection cannot observe the interleaving that makes the race real.

## 5. The catalog — one canonical family across three rungs

`src/matchmaking/house-catalog.ts` declares `HOUSE_CATALOG.rungs`: `open_12` (experienced,
scheduled, 3 open at once, 3h/3h stagger), `beginner_12` (beginner, scheduled, 2 open, 4h/4h
stagger), `sitandgo_12` (experienced, `when_full`, 1 open). All three spread one `CANON` object —
`format`, `teamCount`, `scoringPreset`, `rosterShape` read from `LEAGUE_CONFIG.defaults`, so Task
1's half-PPR canon reaches the catalog with nothing here to independently fall out of step with it
— and differ only on the two axes that exist on purpose: `experienceTier` (keeps people apart) and
`startTrigger` (serves two different appetites for waiting).

The invariant is held by a test, not a comment: the catalog's own fifth Step-1 test asserts every
rung's `format:teamCount:scoringPreset:rosterShape` string collapses to one value, so a rung added
later with a differing roster shape or scoring preset fails to compile into the catalog's own
`as const satisfies` shape or fails that string-identity assertion — either way, a fragmenting rung
cannot land silently. This is the code-level enforcement of §4.1's finding that Apex fills leagues
because every joiner fits every open seat; fragmenting the pool across formats is the failure this
addendum was written to avoid repeating.

`sitandgo_12` ships at `openAtOnce: 1`, not zero — a rung that never spawns is a control wired to
nothing, and this codebase has refused that shape five times already. One live pod keeps the
mechanism honest without splitting the evening's fill population, which is small enough to matter.

**The catalog is code, not a `.env` value or a database table**, and all three reasons the plan
gave for that still hold in the shipped module. It must be browser-safe — `src/matchmaking` is one
of the exempt directories the client boundary allows a room component to value-import, and the
catalog lives there rather than creating a ninth exemption. It must be type-checked against the
rest of the product — a rung names a scoring preset, a roster shape, an experience tier and a start
trigger, each a union the compiler can check, which neither a string env var nor a jsonb row can
be. And it must be reviewable — changing `openAtOnce` from 3 to 8 changes what the lobby is, and
that belongs in a commit with a reason in its body, not a deploy variable nobody reviews.

## 6. The two commissioner doors, and what each says now

Ruling 32's design question — whether a house league's discretionary powers should re-home to the
operator console — resolved against re-homing, and the shipped code gives the operator surface no
new house-specific control at all. The discretionary commissioner powers are precisely the ones a
public league must not have (`beating-apex-strategy.md` §4.1: "automated rule enforcement and
dispute resolution rather than handing commissioner powers to whichever stranger happened to create
the league") — an operator holding those powers over every house league is the same trust problem
with a better-paid stranger. What the operator surface already has — the moderation queue, flag
resolution, and dispute handling Phase 3 Plan B shipped — already applies to a house league exactly
as it applies to any other, because every house league is `is_public_matchmade = true` (§8).

The two doors a house league's members-panel actually closes both refuse, structurally, in
`HOUSE_AUTHORITY_REFUSALS` (`authority.ts`):

- **Invite** — "House leagues are open to everyone, so they don't use invite links. Share the
  league's page instead." `invitePreview` and `createInvite` never reach a house league: the invite
  door is this product's one deliberate, mechanism-based exemption from tier segregation, safe in a
  member league because a commissioner invites people they already know — and unsafe here, because
  it would be a hole straight through the segregation `beginner_12` exists to provide. A pleasant
  consequence the compiler caught rather than a reviewer: `invites.ts`'s lookup of the
  commissioner's own `users` row does not type-check under a nullable `commissioner_user_id`, so the
  narrowing forced the question rather than leaving it to be found later.
- **Schedule** — "Commish picks the draft time when a house league opens, because everyone here
  chose their seat around it." A house league's schedule-lock is a public fact stated on the shelf
  card, not something to hide behind a stranger-vs-member oracle, so this refusal fires for any
  caller once a league is house-scoped rather than only for a caller who would otherwise reach the
  member-vs-stranger check.

**A third refusal was drafted and is deliberately not written.** `HOUSE_AUTHORITY_REFUSALS`'s own
docblock records that a league-settings refusal was considered and rejected: there is no
league-settings write endpoint in this product at all, so a refusal string with no caller would be
wired to nothing — the same standard this addendum's own inert-deliverable sweep applies everywhere
else (§9).

**What the panel does not yet say.** The commissioner persona's sharpest question — "if nobody runs
it, who fixes a problem?" — is answered by the real mechanism (the operator dispute path above),
but no surface names that path next to "Run by Commish" yet. Task 14's review adjudicated this
DEFERRED to Phase 3.6 Task 5 (trust surfaces), on the reviewer's four-point argument: no functional
gap exists today (the dispute path already applies uniformly), it is a copy-discipline decision
about where the sentence belongs, and Phase 3.6 already owns the holistic home for trust-surface
copy. This addendum adds no UI copy naming the dispute path; the deferral is recorded here so a
later reader does not mistake silence for an unnoticed gap.

## 7. The creation-time tier gate — walked past, not bypassed

`tierJoinPrecondition` (`src/league-service/enforcement.ts`) exists because `leagues.
experience_tier` is self-declared by whoever creates a league, and the abuse it prevents is a
person declaring a tier they do not belong to in order to sit in it. `createLeague`'s own gate
(Task 3, ruling 6) asks the identical predicate against the fields a request is ABOUT to create,
closing the hole a creator never joins their own league through the public door and so never meets
`publicJoinPrecondition` at all.

The house factory walks past this gate rather than satisfying it: `createLeague`'s docblock states
the rule plainly — "Only asked for a MEMBER owner (Task 13, ruling 39)... a house owner has no
`userId` for this to check — `spawnHouseLeagueInTx` walks past this gate entirely rather than this
function inventing a vacuous pass for it." The platform declares the catalog and then sits in
nothing, so there is no person whose tier could be checked and nothing the check would prevent. The
gate that does the real work — `publicJoinPrecondition`, refusing a veteran joining `beginner_12`
— is untouched and unexempted: it applies to every joiner of a house league exactly as it applies
to a member league's. The `owner` discriminant (`LeagueOwner`, `member | house`) is what keeps the
walk-past from being a flag somebody could later set on a member league by mistake — a `member`
branch cannot omit a `userId`, and a `house` branch has no `userId` field to check in the first
place, so neither shape can express the bypass this gate exists to prevent.

## 8. Segregation and the clock — verified, not merely claimed

**Every house league is enforced, none is exempted.** `spawnHouseLeagueInTx` hardcodes
`isPublicMatchmade: true` into every `CreateLeagueInput` it builds, so `enforcementAppliesTo` is
true for every house league without exception: auto-start runs, auto-lineup runs, trade auto-hold
runs, tier segregation runs, and the multi-account detector sweeps a house league's twelve members
exactly as it sweeps any other league's. The exemption a house *user* would have needed (§1) is not
merely declined — it is unnecessary, because there is no house row for a detector to exempt or
sweep in the first place.

**`kickoff_at`'s writer count, verified against the current tree rather than assumed.**
`docs/decisions/enforcement-and-tiers.md` §9 states there are exactly two `.set({ kickoffAt })`
call sites in this codebase — `setDraftKickoff` (a commissioner's own choice) and
`fireWhenFullInTx` (the sit-and-go trigger) — and no third. A fresh grep across `src/**`
(excluding tests) for this addendum confirms that count is still exactly two: `spawnHouseLeagueInTx`
never updates `kickoff_at`. It calls the same `writeLeagueInTx` every member league's creation has
always called, which sets the column's INITIAL value on the `drafts` row's own `INSERT` — the
identical mechanism `createLeague` has used since Phase 1, whether that initial value came from a
caller's explicit `kickoffAt` or (the common case) `LEAGUE_CONFIG.defaults.draftDaysFromCreation`'s
own computed default. The house reconciler supplies `houseKickoffFor`'s staggered computation in
that same argument position; it does not add a fourth writer, because it is not a writer at all in
the sense §9 counts them — it is the third caller of an insert-time mechanism that has existed
since before this addendum.

What genuinely is new: this is the first time that insert-time kickoff value is computed and
committed by a transaction with **no human actor behind it at all**. Every earlier call to
`writeLeagueInTx` — even one whose kickoff was the default arithmetic rather than a chosen date —
was still triggered by a person pressing "create league." `spawnHouseLeagueInTx` is called from a
reconciler tick; `writeLeagueInTx`'s own audit event for that call records `actorType: "system"`,
`actorId: null` (the same `(null, "system")` shape `BOOTSTRAP_ACTOR` collapses to at its own
boundary). The honest correction to the plan's own framing: this is not the system's fourth
`kickoff_at` writer, because the writer count itself is unchanged. It is the first `kickoff_at`
value ever set with no human transaction behind it, which is a real and worth-recording property —
just not the one "fourth writer" describes.

## 9. The inert-deliverable sweep, extended

Task 11 step 4 walked four lists for the parent plan; this addendum adds three, all clean.

- **Every `HouseRungName` is reachable from the shelf.** `HOUSE_RUNG_LABEL` is an exhaustive
  `Record<HouseRungName, string>`, so a rung added without a label fails to compile; `public-
  league-list.tsx`'s `HouseLeagueShelf` reads it directly on every card (`HOUSE_RUNG_LABEL[league.
  houseRung]`).
- **`house_league_opened` (the one new `SystemActionCode`) has a real publisher.**
  `spawnHouseLeagueInTx` writes it on every successful spawn, and `SYSTEM_ACTION_VISIBILITY.
  house_league_opened` (`src/integrity/system-actions.ts`) is `"everyone"` — a fact about the
  league's shared calendar, true for anyone in it, about nobody's conduct.
- **`PublicLeagueSummary.houseRung`, the thirteenth field, renders on a card.**
  `HouseLeagueShelf` reads it to select the rung badge; `browse.test.ts`'s key-set test still fails
  if the wire body grows a field the contract does not name.

**This addendum's own self-review already applied the same discipline twice, before this task ever
ran, and both are recorded rather than quietly dropped.** Task 12 step 4 drafted a `settings`
refusal string for `HOUSE_AUTHORITY_REFUSALS`, found no league-settings endpoint for it to guard,
and did not write it (§6 above). Task 13 step 4 drafted `HOUSE_FACTORY_REFUSALS` as a copy registry
for the reconciler's own failure sentences, found no person the reconciler would ever say a
sentence to (a tick's refusal is reported on `HouseFactoryOutcome.refused`, read by nothing
user-facing), and replaced it with plain outcome reporting instead.

## 10. What running this for real found, beyond the plan

Two fixes shipped during Task 15 that no ruling above predicted, because they surfaced only once
the reconciler ran against a real, long-lived database rather than a fixture.

**The seed's first run against the shared dev database threw**, because a real WorkOS identity
already held a seat in what the seed assumed was an empty 12-seat `open_12` league (from earlier
manual `/browse` testing). Fixed by reading the league's actual current seat count before computing
how many dedicated fillers to mint, rather than assuming an empty shelf. Idempotent by construction
afterward — `npm run seed` twice reports `0 new seat(s)` and an identical shelf width both times
(re-verified below).

**A kickoff-staleness race in the seed and e2e's own fill arcs.** Both walked to the "earliest
`open_12` league" without checking whether its kickoff was still comfortably in the future; a
stale-but-unfilled candidate could arm `autoStartDueDrafts` mid-fill and produce an intermittent
`DRAFT_ALREADY_STARTED` on a long-lived dev database. Fixed by selection, never by mutation — there
is no legitimate write path to refresh a house league's kickoff (`setDraftKickoff` is
commissioner-gated, and a house league has no commissioner by construction), so hand-stamping
`kickoff_at` around that refusal would have been exactly the production-semantics violation this
addendum's own authority seam exists to prevent. `src/data/seed/house-fill-safety.ts` is the shared
predicate (`isSafeToKeepFillingHouseLeague`, a 2-hour margin — the identical margin `e2e/
global-setup.ts`'s own fixtures already require) both call sites now ask before seating a second
member; a candidate that is short of capacity AND unsafe is skipped for the next-earliest one, and
a shelf where every candidate is unsafe fails loudly (a named error) rather than silently. Proven
by two unit tests that stamp a real kickoff to exactly the unsafe boundary and to one minute past
it, not merely reasoned about.

## 11. Composition with Tasks 1-11 — what this addendum assumes rather than restates

`HOUSE_CATALOG`'s `CANON` reads `LEAGUE_CONFIG.defaults`, which Task 1 sets to half-PPR and Task 2
gives a median toggle, so the catalog inherits the canon rather than restating it — except for
`medianGame`, which `LEAGUE_CONFIG.defaults` has never carried (§12 below). `sitandgo_12` writes
`start_trigger = 'when_full'`, the column Task 7 created, and its leagues fire through Task 7's own
`fireWhenFullInTx` with no second mechanism. The shelf (Task 14) sits above the list Task 8
reordered. Task 12's `setDraftKickoff` refusal sits beside Task 7 step 5's own commissioner-only
gate. Task 15 extends Task 10's seed and Task 10's own e2e spec file rather than adding a new one.
If Tasks 1-11 are not merged, every one of those is a dangling reference — the same warning the
addendum's own self-review carries, restated here because this is the doc a reader lands on when
searching "house league."

## 12. A carry, unresolved and now slightly larger

`docs/decisions/formats-and-lobby.md`'s own cross-cutting correction records that `medianGame`'s
default is not centralized in `LEAGUE_CONFIG.defaults` the way the roster-shape default is — it is
a literal `false` at `createLeagueSchema`'s `z.boolean().default(false)`
(`src/league-service/schemas.ts:58`) and at `input.medianGame ?? false`, written twice inside
`writeLeagueInTx` itself (`src/league-service/creation.ts:183` and `:215`, the `leagues` insert and
the audit payload). This addendum did not centralize it — checked directly rather than assumed,
since Task 13 rewrote `creation.ts` substantially and could plausibly have folded it in along the
way; it did not. It also could not have: `HOUSE_CATALOG`'s own `CANON` needs a `medianGame` value
for every rung and has nowhere centralized to read one from, so it hardcodes `medianGame: false`
directly (`house-catalog.ts:72`) rather than spreading it from `LEAGUE_CONFIG.defaults` the way
`format`, `teamCount`, `scoringPreset` and `rosterShape` all are. The carry is now three literal
`false`s instead of two, by necessity rather than oversight — worth centralizing the next time any
of the three is touched for an unrelated reason, not fixed here for the same reason Task 11 did not
fix it: this task documents what shipped.

A second, unrelated fast-follow candidate, recorded rather than fixed for the identical reason:
`src/data/seed/seed-enforcement.ts` writes the same `drafts` shell shape (`format: "snake", status:
…, kickoffAt: …, auctionBudget: null`) at three separate `.values({…})` call sites
(`HELD_TRADE_DRAFT_ID`, `AUTOSET_DRAFT_ID`, `AUTOSTART_DRAFT_ID`), never extracted into one helper.
Predates this addendum and is untouched by it.
