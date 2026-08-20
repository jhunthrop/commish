# Decision: audit and integrity

**Date:** 2026-08-20 · **Phase 3, Plan A** · Spec: `.superpowers/sdd/2026-08-20-phase3-plan-a-audit-spine/`

Nine sections, each recording what was chosen, why, and what would have to change for the choice
to be wrong — the ninth being the boundary all eight others stop at. This doc's job is to make Plans B, C and D short: every one of them appends to a chain
this plan built, publishes a notice through a registry this plan built, or renders a row through an
allowlist this plan built, and the rule that keeps each of those safe is written down here once
rather than re-derived per plan.

## 1. The chain scope ruling

**Chosen:** one hash chain per league, plus one platform chain for events with no league
(`session_started`, `profile_updated`, `review_removed`, and Plan B's `admin_action`). Never one
global chain.

**Why.** The append lives *inside* the caller's business transaction — see §2 — so the chain's
anchor row lock (`audit_chains`, `SELECT … FOR UPDATE`) is held for the whole business transaction,
not just the append. A single global chain would put every write in the product behind one row
lock, capping platform-wide throughput at `1 / (mean business transaction duration)`. With a draft
pick's transaction running 5-20ms, that is a ceiling of roughly 50-200 writes/second for the
*entire platform* — reached by about a thousand leagues drafting at once on a Sunday evening.
Per-league chains reduce contention to contention that already exists: a draft is already
single-writer per draft (`drafts FOR UPDATE`), and twelve managers setting lineups on a Sunday
morning at ~15ms each is not a queue. `audit-logger.test.ts`'s matched concurrency pair proves the
shape directly: two appends to the *same* scope serialize into a gapless linked run; two appends to
*different* scopes never block each other at all, even when one is held open across a `setTimeout`
gate.

**Lock ordering (ruling 3, as restated).** The audit anchor is always the *last* lock a transaction
takes, a transaction appends to at most one chain (`recordAll` throws if a batch spans scopes), and
**"lock" includes an implicit foreign-key lock**.

That last clause is not pedantry, it is the finding that forced this paragraph to be rewritten.
Postgres takes `FOR KEY SHARE` on the *referenced* row whenever a statement inserts or updates a
referencing one, and `FOR KEY SHARE` conflicts with `FOR UPDATE`. So `INSERT INTO member_notices`
is a lock on `leagues` and on `users`, and `commitDraftState`'s inserts are locks on `leagues`,
`teams` and `players` — none of which look like locks at the call site. Three transactions honored
the rule as originally written while taking exactly those locks *after* the anchor, and the result
was a real cycle: `joinLeagueInTx` held `leagues[X] FOR UPDATE` and waited for `audit_chains[X]`,
while the draft-pick transaction held `audit_chains[X]` and waited for `leagues[X] FOR KEY SHARE`
through its autopick notice. Postgres broke it after `deadlock_timeout` by aborting a pick or a
join the user did nothing to deserve. It needed a join attempt concurrent with an autopick in the
same league, which is rare and entirely reachable — `joinLeagueInTx` takes the league lock *before*
the precondition that would reject a join into a started draft, so even a doomed join holds it.

So every audited transaction now finishes its business writes first: `applyAction`
(`src/draft-service/store.ts`) holds `drafts FOR UPDATE`, then writes its notice rows, runs any
`alsoInTransaction` callback and commits the draft to a season, and only then reaches the anchor;
`setLineup` holds `stat_weeks FOR SHARE` first; `joinLeagueInTx` holds `league_invites` then
`leagues` first; `removeReview` writes its notice before appending. Every one of them reaches the
anchor row afterward, and nothing reaches any of them from the anchor, so no lock-ordering cycle
exists anywhere in the codebase — the audit spine cannot itself be the cause of a deadlock.

The single statement any caller may run *after* the anchor is `attachAuditEvent`
(`src/integrity-service/notify.ts`), which stamps `member_notices.audit_event_id`. It is safe for
one specific reason worth stating so it is not generalized: Postgres re-checks a foreign key, and
therefore locks the referenced row, only when the referencing column's value actually changes, and
that column carries no foreign key at all. `user_id` and `league_id` are untouched by it.

`src/integrity-service/lock-order.test.ts` drives the two transactions that used to deadlock
against a real Postgres, on two connections, with a rendezvous that pins the interleaving rather
than hoping for it — and reproduces the deadlock deterministically if the old order is restored.

**What would force a change.** The platform chain stays a single row only because every
platform-chain append is a short transaction by construction (a sign-in at 20/s against a ~2ms
transaction is 4% utilization of one row). The condition that forces it to be sharded: any
platform-chain append from inside a long transaction. That is the moment to shard it, not before —
it is written into `audit-logger.ts`'s own docblock so a future author reads the warning before
adding the long-running append rather than after.

## 2. The write-ordering ruling

**Chosen:** the audit append (`AuditLogger.record`/`recordAll`) and the notice row
(`notifyAffectedMember`) are inside the caller's business transaction and fail it. The Redis frame
(`deliverNotice`) is best-effort, called only *after* that transaction commits.

**Why.** This is the exact opposite of `docs/conventions.md`'s realtime rule — *"Postgres is
authoritative; publishing is best-effort and must never fail the write."* The difference is
deliberate, not an inconsistency, and it is the single rule every later plan is most likely to copy
backwards, so it is stated here beside the rule it mirrors rather than in isolation: a Redis frame
nobody received is a client that refetches on reconnect or gap; a mutation nobody recorded is a hole
in the record this whole phase exists to make trustworthy, and that is strictly worse than the
mutation not happening at all. `AuditLogger.record`/`recordAll` take the caller's `DbTx`, never a
`Db` — there is no code path that lets an audit event commit separately from the write it records.
`audit-logger.test.ts`'s "same-transaction contract" tests both directions: a business write that
rolls back takes its audit row with it, and an audit append that fails (an unhashable payload) fails
the business write that hadn't committed yet.

The one exception that proves the rule: `deliverNotice` publishing failure is *never* surfaced,
because the durable `member_notices` row already committed and the inbox reads it on the next page
load — the frame is a nudge for a page that happens to be open, not the delivery.

**What would force a change.** Nothing in this design changes this; it is definitional. A future
plan discovering a write where "committed audit row, uncommitted business write" is somehow
tolerable would need its own documented carve-out here, not a silent exception.

## 3. Canonicalization

**Chosen:** the hash is taken over sorted-key JSON from a rejecting encoder
(`src/integrity/canonical.ts`), never `JSON.stringify`. `occurredAt` is hashed in its
round-tripped spelling via `normalizeInstant` (`src/integrity/chain.ts`). `hashVersion` is part of
the hashed bytes and a stored column.

**Why sorted keys.** The verifier re-derives a hash from a row read back out of Postgres, and
`jsonb` does not preserve key order — it stores an object as a sorted, deduplicated map. Hashing
`JSON.stringify(payload)` would produce one digest on write and a different one on read for the
same data. `canonicalSerialize` sorts every object's keys before hashing, so the digest matches
however Postgres chooses to store it.

**What the encoder refuses, and why each is refused.** Everything `canonicalSerialize` refuses, it
refuses because the value would not survive that same round trip: `undefined` (jsonb has no
concept of it), `NaN`/`Infinity` (jsonb has no non-finite number), an unsafe integer past 2^53 (jsonb
does not lose precision the way a refusal-free path would silently accept and then mis-hash),
`bigint` (no jsonb representation at all), `Date`/`Map`/`Set`/a class instance (each has a "real"
value only after some serialization decision this module refuses to make silently), a cycle
(unrepresentable), and a NUL character (`U+0000` cannot be stored in a Postgres `jsonb` or `text`
value at all — Postgres would reject the insert with a much less useful error than this one gives at
the point of hashing, before any row is attempted). Failing loudly at the write, with the exact path
named (`audit payload cannot be hashed: nested.a[2] is a Date`, for example), beats a chain that
stops verifying weeks later on a row nobody can explain.

**Why `normalizeInstant`.** A caller passing `2026-08-20T19:00:00+02:00` or microsecond precision
would otherwise write a row that never re-verifies, because `timestamptz` hands back UTC
milliseconds on read — the written hash and the re-derived hash would disagree over a timestamp
spelling difference that carries no real information loss. `normalizeInstant` also **rejects
calendar-invalid dates**: `Date.parse` alone silently rolls `2026-02-30` forward to `2026-03-02`
rather than rejecting it, which would hash a timestamp that differs from what the caller actually
stated. The fix re-derives the year/month/day/hour/minute/second the caller literally wrote and
checks they round-trip through `Date.UTC` unchanged; `2026-02-30` throws, `2028-02-29` (a genuine
leap day) is accepted. This was LOW finding from Task 1's fix round 1 (`495c4f2`).

**What a `hashVersion` bump would cost.** An audit chain is the one structure where the algorithm
can never change without a way to tell old rows from new ones — a migration that reinterprets
already-hashed bytes cannot be written after the fact. `hashVersion` is stored on every row and
hashed as one of its own fields, so a version bump is: add a new constant, teach `verifyLinkedRun`
to compute the new rows' hashes with the new algorithm while still verifying old rows against the
old one (or explicitly refuse to mix, which is the verifier's current behavior — `version_mismatch`
is a hard break, not a silent skip), and decide whether pre-existing rows are re-hashed (expensive,
one-time, and the only way to ever collapse to one version) or left mixed forever (cheap, and the
verifier must keep both algorithms alive indefinitely). Nothing in this phase needs that decision
made; it is recorded here so whichever plan needs `hashVersion: 2` inherits the tradeoff rather than
rediscovering it.

**The golden vectors, plural.** `chain.test.ts` pins `computeEventHash` against fixed inputs and
literal expected hex digests, so a change to field order, canonicalization, or the hash algorithm
that silently changes existing hashes is caught by a snapshot rather than by "the numbers still
look like hashes."

There are two, because one was not enough and the reason is worth recording. The first vector's
inputs are accidentally degenerate: both objects it hashes are already alphabetical as written,
everything in it is ASCII, and every number is a small integer — so deleting `.sort()` from
`canonical.ts` outright left it green, as did escaping non-ASCII. The second is adversarial by
construction: payload keys written out of order in the source, a key that sorts after `"zeta"` only
under UTF-16 code-unit ordering, non-ASCII values, a float, a `-0`, an empty object, an empty array
and a nested object. Its digest was computed by a from-scratch implementation of the documented
canonical form in another language, written against the spec rather than ported from
`canonical.ts`, and only then compared — a vector produced by running the code it is meant to
police pins nothing. Verified by mutation: removing key sorting and escaping non-ASCII each redden
it, and neither reddened the first. `-0` hashing identically to `0` (`String(-0) === "0"`) is
correct and is now asserted rather than merely true.

## 4. Verification

**Chosen:** two entry points. `verifyChainIntegrity` walks forward from a per-scope checkpoint,
re-hashing only what has been appended since the last verified boundary. `verifyFullChainIntegrity`
walks the whole chain from genesis every time. Neither runs on a request path;
`scripts/verify-audit-chain.ts` (`npm run audit:verify`) is the only caller of either, today.

**What each can and cannot see.** The incremental walk also **re-checks the checkpointed boundary
row itself** — recomputing its hash with the real, non-injectable `computeEventHash`, never the
test's `options.hash` spy — which is what turns "we verified through sequence N" from a claim into
something falsifiable. A tamper *strictly before* the checkpoint is deliberately invisible to the
incremental walk: that is the cost of an incremental check, it is the reason the full walk exists,
and both directions are asserted by `verify.test.ts`'s matched pair (a pre-checkpoint tamper the
incremental walk misses; the same tamper the full walk catches).

**The anchor reconciliation, and the deletion class it exists for.** Walking rows can only ever
see the rows that are still there. Three events that link perfectly to each other are
indistinguishable, from the events alone, from five events whose last two were deleted — the hash
chain protects *modification*, and deletion of a contiguous TAIL modifies nothing. Both walks
therefore end by reconciling what they found against the chain's own sworn statements, and this
is what makes `--full` a safety net rather than, as it briefly was, the *weakest* check the
product had:

1. **The walk's terminus against `audit_chains`.** Sequence and hash both. A truncated tail, an
   anchor nobody updated, an anchor rewound while the rows stayed, and a chain whose every row is
   gone all land here as `anchor_mismatch`, with an accusation naming both counts.
2. **The frozen checkpoint against `audit_chains`.** The one case the first check cannot see: an
   adversary who deletes the tail *and* rewinds the anchor to match leaves two accounts agreeing
   with each other. `audit_chain_checkpoints` is a third account, frozen by an earlier honest run,
   and a checkpoint that verified more events than the anchor now claims is the rewind stated in
   the chain's own records. This is why the full walk reads the checkpoint at the end even though
   it deliberately ignores it as a starting point: starting there would mean trusting it;
   cross-checking it means holding both stored summaries to the rows.
3. **Only then is a new checkpoint frozen.** A walk that ends in an accusation never advances the
   checkpoint, for the same reason a broken linked run does not.

`verifiedThrough: 0` with `valid: true` is legal only when the anchor agrees there is nothing
there. Before this, `verifyFullChainIntegrity` returned exactly that for a chain whose every row
had been deleted while `audit_chains` still read `head_sequence = 5`.

Migration `0021` puts the checkpoint table behind its own triggers for the same reason: a detector
an adversary can delete is not a detector, and one they can rewind is worse than none because it
looks like agreement. DELETE is refused outright; UPDATE is refused unless it moves
`verified_through_sequence` forward or leaves it standing still, which is every write the verifier
itself makes. It is deliberately *not* the same append-only rule `audit_events` gets: this table is
verification's own state, not the record.

None of this requires an adversary. A restore to the wrong point in time, a partial replica
promotion or a botched backup restore produces the same divergence with nobody at fault, and the
operator's own verification tool used to report the record intact.

**Three bugs the plan's own reference implementation had, found while implementing Task 4.**
`task-4-brief.md`'s verbatim sample code was reviewed against, not copied blindly, and three of its
bugs were caught before they shipped:

1. **`tamperWithAuditEvent`'s jsonb bind.** The brief's sample bound a plain JS object patch value
   directly; `postgres-js`'s wire protocol wants a string to parse into `jsonb`, not an object to
   serialize, and would have thrown on the first payload-patching tamper test. Fixed by
   `JSON.stringify(value)::jsonb` for object/array patch values, scalars unchanged.
2. **The checkpoint-boundary check, the big one and the doc-worthy one.** The brief's snippet
   compared two already-*stored* columns — `boundary.eventHash !== checkpoint.verifiedThroughHash`.
   A payload-only tamper (exactly what `tamperWithAuditEvent` produces, since no trigger survives to
   fix up `event_hash` once triggers are disabled to tamper at all) leaves the stored `event_hash`
   column untouched, so that comparison would have passed silently on a genuinely tampered row —
   the checkpoint boundary is precisely the row a real attacker would target, because it is the one
   row an incremental verifier trusts without re-deriving. The shipped fix recomputes the hash with
   the real `computeEventHash` instead of comparing stored values, and it does so *outside* what the
   incremental test's call-count spy measures — the boundary recheck runs once per
   `verifyChainIntegrity` call, unconditionally, before `walk()` is ever invoked with the caller's
   injected `hash`, so a spy-armed test cannot be fooled into missing a boundary tamper by an
   author who only wired the spy through the walk. This is the finding worth a reader's attention
   because it is the shape every future "recompute vs. compare-stored" decision in this codebase
   should default toward: recompute from the row's own content, never trust a second stored copy of
   a derived value to still agree with the first.
3. **The no-anchor early return.** The brief's sample would have attempted an
   `audit_chain_checkpoints` write for a scope with no `audit_chains` row at all (nothing ever
   appended to it), violating the checkpoint table's FK to the chain table. The shipped fix returns
   `{ valid: true, verifiedThrough: 0, hashed: 0 }` for that case — but only after reading the
   anchor and finding it agrees there is nothing here, which is the reconciliation above. This
   is exactly correct and not a workaround: a *committed* `audit_chains` row can never have
   `headSequence === 0` in this codebase, because `lockAnchor`'s insert and the first event's insert
   commit in the same transaction (`recordAll`) — so `anchor.headSequence === 0` inside `walk()`
   really does mean "this scope was never written," never "no new events since some real
   checkpoint."

**Failure semantics (ruling 8, the freeze-and-tell protocol).** A failed verification stops the
*checkpoint*, not the product, and tells an *operator*, not a member:

- The checkpoint freezes — never advances on a failure, so every later run re-detects the same
  break rather than stepping over it.
- The script exits non-zero, naming scope, sequence, event id and reason
  (`ChainBreakReason`: `sequence_gap` | `link_mismatch` | `hash_mismatch` | `version_mismatch` |
  `checkpoint_mismatch` | `anchor_mismatch`).
- A `system_action` event is appended to the **platform chain**, recording the detection, via the
  same `AuditLogger` every other write in this phase uses.
- Nothing else stops. No member is told. **Nothing is ever repaired** — no code path in this
  codebase writes to `event_hash`, `previous_event_hash`, or any other column of an existing
  `audit_events` row; the only writes verification ever makes are checkpoint upserts and new,
  forward-only appends.

Halting appends on a detected break would halt every audited write in the product — one corrupted
row becomes a full platform outage triggered by whoever corrupted it. Telling a league "your record
may have been tampered with" before a human has looked is the accusatory failure mode this phase
spends a denylist (§7) preventing elsewhere; verification failure is the same principle applied to
the chain itself.

**The platform-chain-recursion answer.** What happens when `recordDetection` appends its
`system_action` to a platform chain that is itself the one just found broken? Traced and
independently driven (`task-4-review.md`'s Finding 4, later pinned in `e67fb7c`):
`recordDetection`'s append does not depend on chain history at all — `lockAnchor` reads only the
*current* `audit_chains` anchor row, which an event-row tamper never touches, and appends a new,
correctly-linked event on top of the corruption. It cannot loop, cannot deadlock, and cannot
suppress the earlier corruption: a subsequent full walk still reports the *original* break at its
original sequence, appended detection events included. This is proven directly in
`verify.test.ts`, not just asserted in a docblock.

**Why the full walk pages, and why neither walk runs on a request path.** The scaling review's
finding was that verification which cannot be afforded is verification nobody runs, and loading a
million-row chain into memory to check it is the same class of mistake as re-hashing it on every
request. `page()` in `verify.ts` reads `INTEGRITY_CONFIG.verification.batchSize` (500) rows at a
time by `audit_events_scope_sequence_idx`, the same index the activity feed reads by.
`fullVerifyIntervalHours` (24) is the number a production scheduler is configured with —
`scripts/verify-audit-chain.ts`, run by hand, is the only caller today, and Phase 2's Plan D (the
founder-gated deploy plan) is the plan that has a scheduler — see section 9 for why that runner is
a requirement, not a convenience.

## 5. The audited set

**Eight writes are wired to `AuditLogger` in this plan; seven names are reserved with a named
owner.** The eight are the writes an ordinary member's activity feed is actually made of, plus the
platform chain's first traffic:

| Event | Where it is written |
|---|---|
| `league_created` | League creation |
| `member_joined` | Both join doors (invite-code join and matchmade join) |
| `draft_pick` | Every draft pick, human or clock-made — audited at the action seam in `store.ts`, not the commit seam (ruling 17: `commitDraftState` sees only the final pick list with no timestamps and no human-vs-autopick signal; `CompletedPick` carries both at the action, where the row lock is already held) |
| `draft_completed` | The draft's commit |
| `lineup_change` | `setLineup` |
| `session_started` | Sign-in, on the platform chain |
| `profile_updated` | `updateProfile`, on the platform chain |
| `review_removed` | `removeReview`, on the platform chain |
| `system_action` | Verification's own detection append (§4), on the platform chain |

The seven reserved names cannot be published yet because their subjects do not exist in this
codebase: `roster_move`, `trade_proposed`, `trade_accepted`, `trade_rejected` (no trade exists —
Plan C), `flag_raised`, `flag_resolved`, `admin_action` (no admin exists — Plan B).
`src/integrity-service/reserved.test.ts` keeps this honest mechanically: `OWNER` is a
`Record<AuditEventType, "plan-a" | "plan-b" | "plan-c" | "plan-d">`, so adding a type to the
vocabulary without assigning it a plan is a type error, not a review comment someone can miss; a
grep-based test confirms every Plan-A-owned type has a real, non-test publisher somewhere in `src`
or `scripts`, and confirms every reserved type has *no* publisher anywhere in either — the mirror
image, so a later plan landing its publisher without updating this table fails loudly rather than
silently going stale. This is the same shape `score.update` used, reserved through Phase 1 and
turned on by name in Phase 2.

**A Task 5 fix worth a line here.** Contested auction picks — a lot that closes with more than one
bid — are attributed to the *winning bidder*, not left actor-less or attributed to whoever happened
to submit last. This was a real bug in an early draft of Task 5 (`8ea7303`, "attribute contested
auction picks to the winning bidder"): `renderDraftPick`'s "You" vs. "the clock" sentence choice
(§6/activity view) depends entirely on `actorId === null` meaning "the clock made this pick," and a
contested pick with the wrong or missing `actorId` would have rendered as clock-made when a real
person won it, or vice versa. `auditEventsForPicks`/`ownerIdsForContestedPicks`
(`src/draft-service/audit.ts`) resolve the winning owner explicitly rather than trusting whichever
action record happened to be last in the log.

## 6. The notice primitive

**The naming collision, resolved by renaming.** The phase overview proposed two files both named
`notifications.ts`, distinguished by a docblock comment. Two files with the same name differ by one
word in an import line, and the comment lives in the file rather than at the call site where the
mistake actually happens. Resolved instead by giving them different words for different things:
`src/identity/notifications.ts` stays the CATALOG a user's profile page reads (*"what topics does
this product tell me about?"*, `NOTIFICATION_CATALOG`, `deliverableChannels()`); the new
`src/integrity/notices.ts` is the WORDS a specific automated action says to a specific person
(`NOTICE_TEMPLATES`, `renderNotice`). `notifyAffectedMember` keeps the spec's exact name — Plans B,
C and D call it by that name.

**Why the rendered copy is stored, not just the type and context (ruling 12).** What a person was
told is a historical fact. If `NOTICE_TEMPLATES.draft_auto_picked`'s wording changes next month, a
notice a member already read must not silently become different words underneath them — the same
principle that makes `reviews` keep a removed review's original text rather than a pointer to
whatever the current review-removal copy says. `member_notices.context` is kept beside the rendered
`title`/`body` so a later reader can see what it was rendered *from*, which is also what makes a
future template change auditable rather than invisible.

**Why delivery is a per-user stream key, and the leak that shipped and was caught.** `notice.created`
rides `REALTIME_CONFIG.userStreamKey(userId)` — `user:<id>:events` — never the league broadcast.
`subscribe.ts` does no per-recipient filtering: every subscriber to a league's stream key receives
every frame published to it. An early version of this plan (Task 7/8, before the per-user stream
existed) had `deliverNotice` publish the *full rendered notice* — id, userId, noticeType, title,
body — on the league broadcast stream as a stopgap, because `getPublisher().publishToUser` was not
yet built. Review caught it as a HIGH: every league member's SSE connection received every other
member's private notice content, which for a held trade or a removed review is most of the
information a notice like that exists to keep private. Fixed in `ac2d78e` by building the per-user
stream key and stripping the league-stream publish entirely; `store.test.ts`'s notice test now
asserts the *inverse* of what it asserted before the fix — no `notice.created` frame, and no
payload containing the recipient's id, ever rides the league stream. The frame today carries
`{ noticeId, noticeType }` only, never the rendered words: a Redis stream is retained
(`streamMaxLen`, 10,000 entries) and readable by anything holding the key, so the words come only
from an authenticated `GET /api/notices` read. A notice with no league (`review_removed`) is not
published at all — the frame exists to nudge a page that is open *right now* about something in a
league the reader is looking at, and a league-less notice has no such page; it reaches the reader on
their next inbox load instead.

`REALTIME_CONFIG.maxStreamsPerUser` (8) is the shared connection ceiling every per-connection SSE
stream — league, and now per-user — counts against; a per-user notice stream is not exempt from it
and does not get its own budget.

**What Plan D's email sender changes.** `deliverableChannels()` filters `CHANNEL_STATUS` down to
channels marked `"live"`; today only `in_app` is. The day Plan D's email sender exists, the change
is: one entry in `CHANNEL_STATUS` (`email: "live"`), one new column somewhere to record a user's
email preference (nothing reads or writes one today — a stored preference for a channel with no
sender is a switch wired to nothing), and one new section on the profile page that already renders
`deliverableChannels()`'s current members. Nothing in `src/integrity/**` or
`src/integrity-service/**` changes at all: the notice registry and the durable row are
channel-agnostic already.

## 7. The member field allowlist

**Chosen:** deny by default, on two independent dimensions. `ACTIVITY_VISIBILITY`
(`src/integrity/activity-view.ts`) is a `Record<AuditEventType, "everyone" | "actor_only" |
"hidden">` over the *whole* `AuditEventType` union — adding a type without deciding its visibility
is a type error. Every type this plan does not publish is `"hidden"`, so the plan that adds the
publisher is the plan that decides what its payload may show, not a plan that inherits an
accidental default. Independently, `renderPayload`'s per-type renderer decides which *fields* of an
event's payload reach a headline — a payload field the renderer did not explicitly read never
reaches the row, allowlisted by construction rather than by an exclude-list a future field could
slip past.

**What deny-by-default guarantees, and what it does not.** It guarantees the TABLE: a vocabulary
entry with no `ACTIVITY_VISIBILITY` decision does not compile. It does not guarantee the RENDERER.
`renderPayload`'s switch ends in `default: return null` with no exhaustiveness check, deliberately
— a value that somehow fails to match the union (a row from a future migration a running process
has not reloaded types for) must deny rather than throw. The cost of that choice is real and worth
stating so the guarantee is not read as broader than it is: a plan that flips a type to
`"everyone"` and forgets to write its renderer gets a **silently empty feed row, not a type
error**. That has already happened once, to `system_action` — see the residual below.

**`actor_only` for `lineup_change` (ruling 15), with the on-page privacy statement.** A lineup
change is not secret from the league in principle, but it is competitively sensitive *before*
kickoff: this product locks lineups at kickoff precisely so nobody can react to somebody else's
choices, and a feed that broadcast every bench move before lock would hand back exactly the
information the lock exists to protect. `activityRowFor` denies a `lineup_change` row to anyone
whose `viewer.userId` is not the event's own `actorId`, before the renderer ever runs. The
league-activity page states this as a plain sentence rather than leaving it implicit: *"Lineup
changes appear only in your own history. Nobody else in this league can see them."* — added in fix
round 1 after the persona panel's high-stakes-veteran review flagged the silent version as
ambiguous (does "only visible to me" mean *hidden from the league* or *not yet computed for the
league*?). Whether `lineup_change` should become visible to everyone *after* a week locks is a real
open question, deliberately left to the panel's list rather than guessed at here.

**The pagination contract.** `listLeagueActivity`'s page is fetched *before* the visibility filter
runs, so a page can legitimately come back with zero visible rows while `nextBefore` is still
non-null — a page where every row happened to be `hidden` or `actor_only`-denied for this viewer.
The contract: **empty rows plus a non-null `nextBefore` means keep paging**, not "reached the end."
`ActivityFeed` (`src/league-room/components/activity-feed.tsx`) honors this explicitly — it renders
the terminal empty state only when `rows.length === 0 AND nextBefore === null`, and renders the list
shell plus a `Show older` control when rows are empty but a cursor remains.

**The proof Plan B is expected to write against this.** The spec's exit criterion — *"raw
multi-account scores are in the admin view and absent from the member feed"* — cannot be written
yet, because the admin view does not exist to compare against. `activityRowFor`'s own deny-by-default
test (Task 9) is the half that can be written now: it proves a payload field the renderer never asked
for cannot reach a row, for every type this plan publishes. Plan B's proof is the other half of the
same claim, run against a real admin surface once one exists.

## 8. Growth, unowned on purpose

`audit_events` is now the fastest-growing table in this system, and there is deliberately **no
retention or partitioning policy**. The two composite indexes are specified because the read
patterns are known today (`audit_events_league_occurred_idx` for the per-league, time-ranged read;
`audit_events_actor_type_occurred_idx` for Plan B's per-actor, per-type behavioral read) — the
growth policy is not specified, because inventing a retention window for a record whose entire
value proposition is that it is complete would be inventing a number with no basis. A twelve-team
league generates audit events on the order of **10^3 per season** (roughly: 12 join events, ~150-250
draft picks depending on format, a draft-completed, ~12-17 lineup changes per manager per season,
plus whatever trade/moderation volume Plans B and C add) — so a hundred thousand leagues is on the
order of a **hundred million rows** before any retention question becomes urgent enough to force an
answer. This is named as a **Phase 8** item, with this arithmetic, so a future reader inherits the
scale of the problem rather than rediscovering it under production pressure. `audit_chains` (one row
per league plus one) and `audit_chain_checkpoints` (the same cardinality) do not share this growth
profile — they are rollups, not the unbounded source, and the balance-as-rollup convention
(`docs/decisions/data-layer-hardening.md`) is exactly why they stay small while `audit_events` grows
without bound.

**`member_notices` is the second unbounded table, and it is unowned in the same deliberate way.**
Every autopick in every draft writes a row (`src/draft-service/store.ts`), every operator review
removal writes one, and Plans B, C and D add three more notice types. Nothing ever deletes one:
`listNotices` bounds the *read* at `INTEGRITY_CONFIG.notices.inboxSize` (20), which is a page size
and not retention, and the cascade foreign keys to `users` and `leagues` are the only pruning that
exists — a deleted user's or a deleted league's notices go with them, which is correct and is not
a policy.

The arithmetic, in the same terms as `audit_events` above: a twelve-team league generates notices
on the order of **10^1 per season** (one per autopick, so a handful per draft in a healthy league
and up to one per pick in a league that drafts entirely on the clock), plus whatever Plans B/C/D's
trade-hold and moderation notices add. That is two to three orders of magnitude smaller than
`audit_events`, so a hundred thousand leagues is on the order of a **million rows** rather than a
hundred million — and the reason to write it down anyway is that the FIX is different. Audit
events may never be deleted; a delivery record may. The honest retention policy for this table,
when Phase 8 gets to it, is most likely "drop read notices older than N months", which needs no
hash-chain reasoning and no ruling about completeness. It joins `audit_events` as a **Phase 8**
item, with a different and much easier answer available.

---

## 9. Threat model, and where it stops

The phase whose product is trust should not ship without writing down what the trust rests on, so
this section states the boundary plainly rather than leaving a reader to infer it from eight
sections about mechanism.

**There is no secret material anywhere in this design.** `GENESIS_HASH` is a literal in
`src/integrity/config.ts`. The algorithm is `sha256`, in the clear. `hash_version` is a stored
column. `computeEventHash` is a pure function of the row's own content. There is no HMAC key, no
signing key, no external witness, no published head, no off-box WAL archive. That is a legitimate
design point for an internal integrity spine, and it fixes the boundary exactly:

**Tier 1: an adversary holding the application's database role.** They can rewrite `audit_chains`
freely — no trigger stands on it, and none can, because every append updates it. They cannot touch
`audit_events` (migration `0019`'s two triggers refuse UPDATE and DELETE) and, since migration
`0021`, they cannot delete or rewind `audit_chain_checkpoints` either. Every attack in this tier is
caught: modification by the hash chain, mid-chain deletion by the sequence gap, tail and whole-chain
deletion by the anchor reconciliation (§4), and an anchor rewritten to cover a deletion by the
checkpoint cross-check. **The chain holds.**

**Tier 2: an adversary holding table ownership.** They can `ALTER TABLE ... DISABLE TRIGGER`,
rewrite any prefix or suffix of `audit_events`, recompute every hash forward from the edit using
the public genesis and the public algorithm, and then rewrite the anchor and the checkpoint to
agree with what they wrote. **Detection is zero, and nothing in this design can change that.** The
same privilege can `DROP TABLE`, which is why ruling 26 declined to block `TRUNCATE`: blocking it
buys nothing against someone who already has the privilege, and costs the test suite. This is the
boundary. It is worth being blunt that it is not a small one — an ordinary Postgres superuser is in
tier 2 — and that no amount of further trigger work moves it, because every defence available
inside the database is administrable by the person the defence is aimed at.

**The corollary a later plan should hold on to.** Everything short of tier 2 is detected, including
deletion, and the detection is entirely self-contained. What is NOT defended against is anyone who
can both disable triggers and rewrite the two summary tables. Detecting *that* requires a witness
outside the database, and this design deliberately has none.

**The floor inside tier 1, and the operational requirement it creates.** §4's reconciliation is
three accounts held against each other, and one of them has to have been written for it to say
anything. So there is a floor, and it is worth being exact about where it sits:

> **A tail deletion with the anchor rewound to match, on a chain that has NEVER been verified, is
> undetectable.** Not "hard to detect" — undetectable. The surviving rows, an anchor that agrees
> with them, and the absence of any checkpoint row are byte-for-byte identical to a chain that
> honestly only ever had that many events. There is nothing left to disagree with. Check 1 passes
> because the two accounts agree; check 2 has no third account to consult.

**Detection therefore begins at a chain's FIRST verification**, not at its first append. The
checkpoint frozen by that first run is the third account, and from that moment on the rewind is
caught (§4, check 2) because a checkpoint that verified more events than the anchor now claims is
the rewind stated in the chain's own records.

**The requirement this creates is FIRST-VERIFICATION-PER-CHAIN, and it is not the 24-hour cadence.**
`INTEGRITY_CONFIG.verification.fullVerifyIntervalHours` describes how often an already-protected
chain is re-walked; it says nothing about how quickly a NEW chain becomes protected at all. Every
league creates a new chain on its first append (`lockAnchor` provisions it), and that chain is
**unprotected against this one attack from its first append until `audit:verify` touches it for the
first time**. A product signing up leagues continuously therefore has a continuously refilling
population of unprotected chains, and the number that matters is the *latency* from a chain's
creation to its first verification, not the interval between later ones. A scheduled runner that
walks every chain in `audit_chains` satisfies both, which is why the requirement is stated as
coverage rather than as a second cadence.

**Who owns the runner: Phase 2 Plan D.** The scheduled runner is founder-gated deploy
infrastructure and it belongs to **Phase 2 Plan D**, not to any Phase 3 plan. Written out in full
here because "Plan D" alone is ambiguous across two phases, and the same full name is now used in
`scripts/verify-audit-chain.ts` and `src/integrity/config.ts` so a reader who arrives at either
one is not sent looking in the wrong phase.

**The interim control, until Phase 2 Plan D lands, is an operator runbook line:**

> Run `npm run audit:verify -- --full` after any batch of new leagues is created, and on a
> recurring operator reminder no less often than `fullVerifyIntervalHours` (24h). It walks every
> chain in `audit_chains` including ones never verified before, so a single run closes the floor
> for every chain that existed when it started. It exits non-zero and names the scope, sequence,
> event and reason on any break.

That line is duplicated into the script's own docblock deliberately: the operator who needs it is
reading the script, not this document.

**What would move the boundary, and what it costs.** Three upgrades, roughly in order of
cost-to-benefit, named here as the **Phase 8 / deploy-hardening** decision they are rather than
pretended into this phase:

1. **A periodically published head.** The cheapest by a wide margin. Write each chain's
   `(scope, head_sequence, head_hash, timestamp)` to somewhere the database role cannot reach — an
   object store with write-once semantics, a log-shipping sink, an email to an operator, a
   third-party timestamping service. Verification then reconciles against a FOURTH account that
   lives outside Postgres, and a tier-2 rewrite of history before the last publication becomes
   detectable. Costs one small periodic job and one storage dependency; it does not protect the
   window since the last publication, which is exactly the trade-off to size when choosing the
   cadence.
2. **An HMAC key held outside Postgres.** Replace `sha256(canonical)` with
   `HMAC-SHA256(key, canonical)`, with the key in a secret manager the database role cannot read.
   A tier-2 adversary can still delete, but can no longer FORGE: they cannot recompute a valid
   chain forward from an edit. Costs a `hash_version` bump and a key-rotation story for a record
   that must remain verifiable for its whole life, which is the genuinely hard part and the reason
   this is second rather than first.
3. **Off-box WAL archival.** Continuous archiving to storage the application role cannot reach
   makes the pre-tamper state recoverable, which is a different property from detection and is the
   one an auditor usually asks for next. Costs real infrastructure and is a deployment decision,
   not a code one.

None of the three is in this phase, and none of them should be read as pending work this plan
left undone: they are decisions that need a production deployment to be made against.

---

## Residuals

Findings and open items recorded here rather than fixed here, because fixing them is out of this
plan's scope, they are pre-existing, or they are a deliberate judgment call this plan's controller
step should see stated plainly rather than buried in a task report.

- **`renderSystemAction` is inert today, and that is on purpose.** Its contract is
  `payload.summary`; the only `system_action` publisher that exists writes
  `{ action, scopes, checkedAt }` (`scripts/verify-audit-chain.ts`'s `recordDetection`) and has no
  `summary`, so the renderer returns `null` for it. It should: that event says a chain failed
  verification, and ruling 8 is explicit that telling a league its record may have been tampered
  with, before a human has read the output, is the accusatory failure mode this phase spends a
  denylist preventing. A Plan D author reading the trap below should read this first — the renderer
  is not "working and only the visibility needs review"; it renders nothing until a publisher opts
  in by writing `summary`, and writing `summary` means choosing the words a member reads.
  `activity-view.test.ts` pins it against the real verifier payload.
- **The everyone-visible `renderSystemAction` trap.** `system_action` is `"everyone"` in
  `ACTIVITY_VISIBILITY` because every `system_action` this plan itself publishes (verification's own
  detection append) is platform-chain-scoped and never reaches a league feed at all — so
  "everyone" has been a safe default *by accident of what exists today*, not because the type is
  inherently safe to broadcast. `renderSystemAction` renders whatever `payload.summary` string it is
  given, verbatim, to every league member. **Re-review is required before Plan D emits a
  league-scoped `system_action` for an auto-set-lineup event** (or any other system action a plan
  might reasonably want to record about one specific manager) — the same competitive-sensitivity
  argument that makes `lineup_change` `actor_only` (ruling 15) applies just as hard to a
  system-generated description of one manager's lineup, and nothing in today's type system would
  catch a future author publishing one under the current `"everyone"` visibility.
- **`/callback` is never exercised by the e2e suite.** The suite authenticates by minting a real
  WorkOS test-directory session and sealing it directly into the `wos-session` cookie
  (`scripts/lib/lab-session.ts`), which is deliberate and documented (`README.md`) — it lets the
  suite skip the hosted sign-in UI while still exercising the real middleware and the real
  `getCurrentUser()` path. The consequence, unrelated to this plan but touched by it (Task 10 added
  the first e2e assertions against `session_started`'s audit trail): the actual `/callback` route
  handler that upserts a user's local row on a real WorkOS redirect has no e2e coverage. Pre-existing,
  not introduced here, and not this plan's to fix.
- **The league page's untested stranger-404 is pre-existing.** `LeaguePage`
  (`src/app/app/leagues/[leagueId]/page.tsx`) has the identical `notFound()`-for-a-stranger gap the
  new activity page has — but only the activity page got a route-level test proving it (fix round
  1, Task 10, `page.test.tsx`), because that is the surface this plan touched. `LeaguePage`'s own gap
  is explicitly left alone per instructions; it is not newly discovered by this plan, just newly
  contrasted against a page that now has the coverage it lacks.
- **The inbox's unread count has a 20-notice ceiling it never announces.** `listNotices` bounds the
  inbox at `INTEGRITY_CONFIG.notices.inboxSize` (20) and derives `unreadCount` over that same
  bounded page (ruling 22 — a member's recent notices are bounded, so the unread count is a
  `count()` over the bounded set rather than a second rollup that could disagree with the list). A
  member with more than 20 unread notices sees `unreadCount` cap at 20 with no indication that the
  true unread total is higher. Not a bug — a deliberate consequence of the derive-over-bounded rule —
  but worth the panel's attention if it ever reads as a silently wrong number rather than a
  page-scoped one.
- **The activity page's removal blockquote is unreachable, and left in.** `quoteFor` returns a
  value only for `review_removed`, which is the one notice type with `league_id: null`, and the
  page's band filters notices down to this league — so the blockquote branch on
  `src/app/app/leagues/[leagueId]/activity/page.tsx` can never render today. It is kept rather than
  deleted because Plans B, C and D add quotable, league-scoped notice types (a trade hold, a
  moderation outcome) and the branch is where they will land; deleting it would mean the next plan
  re-derives the same three lines and the same `quoteFor` call. Harmless, and named here so a
  reader who greps for dead code finds the reason instead of the line.
- **`setLineup` never asserts `teams.league_id === input.leagueId`.** Pre-existing, and safe only
  because the route derives both from the session actor rather than from the request body
  (`src/league-service/lineups.ts`). It is not a hole today; it is one assertion away from being
  provably not a hole, and it is out of this plan's scope. Recorded so the next writer of a
  team-scoped mutation adds the check rather than copying the omission.
- **There is no repo-wide copy sweep.** `copyViolations` (`src/integrity/copy-rules.ts`) is now one
  rulebook for both surfaces this plan owns, and the older per-module dash sweeps elsewhere in the
  repo (`help/glossary.test.ts`, `matchmaking/filter.test.ts`, `data/seed/seed-public-leagues.test.ts`,
  `league-members-panel.test.tsx`) still check the em-dash alone and miss the en-dash. Every sweep in
  this repo is per-module and opt-in, so a new module with user-facing copy is swept only if its
  author remembers to write the sweep — which is exactly how twelve strings in this plan's own UI
  ended up uncovered until the whole-branch review found them. Migrating those four onto the shared
  rulebook, and adding a repo-wide sweep, is backlog rather than this plan's.
- **The notice inbox's unread badge is a conscious `aria-live` non-decision.** Neither
  `notice-inbox.tsx` nor `activity-feed.tsx` uses `aria-live` anywhere. The badge's count can change
  while the panel is closed (a `notice.created` frame arrives, `use-notices.ts` refetches, the
  `Badge` re-renders) with nothing announced to a screen-reader user who is not looking at it — the
  same "this plan deliberately does not make the activity feed live" scoping decision (this plan's
  overview) applied to the inbox badge without being restated there. Whether a badge count change
  warrants a polite live-region announcement, given the badge is not the primary content of any page
  it appears on, is left to the persona panel rather than decided here.
