# Decision: operators and moderation

**Date:** 2026-08-20 · **Phase 3, Plan B** · Spec: `.superpowers/sdd/2026-08-20-phase3-plan-b-operator-surface/`

Eleven sections, each recording what was chosen, why, and what would have to change for the choice
to be wrong. This is a new document rather than more sections on `docs/decisions/audit-and-integrity.md`
(653 lines about the chain) because this plan's decisions are about a different thing: who may act,
what they may do, and who is told — built *on* the chain Plan A wrote, not extending it.

## 1. The role, and why it cannot be granted from inside the product

**Chosen:** one boolean, `users.is_admin`. No roles table, no permission matrix, no RBAC framework.
The one writer is `grantAdmin` (`src/integrity-service/grant-admin.ts`), called only from
`scripts/grant-admin.ts` (`npm run admin:grant -- --user <userId> --by <granterUserIdOrBootstrap>
[--revoke]`), which runs against the database host — never through a session. `requireAdmin()`
(`src/lib/auth/current-user.ts`) sits beside `requireCurrentUser()` and is the one place anything
reads it back: `if (!user.isAdmin) throw new Error("Not an operator.")`.

**Why no in-product grant path.** Founder decision #12's default was a DB flag set by a guarded
operator script; this plan makes that the *only* path rather than the first one (ruling 15). The
consequence is the point: there is no privilege-escalation surface inside the application at all,
so a bug that lets somebody become an operator has to be a bug in Postgres access control, not a
bug in this codebase. `src/data/seed/seed-operator.test.ts`'s `grepSourceTree` is the tripwire that
keeps this true as the codebase grows — it enumerates every idiomatic write shape (`UPDATE
users`, an ORM `.set({ isAdmin: ... })`, a raw SQL string) across `src` and confirms the only
callers are `scripts/grant-admin.ts`, `src/data/seed/seed-operator.ts` (the dev-seed's own use of
the exact same writer, not a second one) and `src/integrity-service/grant-admin.ts` itself.

**The bootstrap check.** A fresh database has no operator to name, so `--by bootstrap`
(`BOOTSTRAP_ACTOR`) is legal exactly once — checked, not trusted: `grantAdmin`'s transaction reads
`SELECT id FROM users WHERE is_admin = true LIMIT 1` and refuses the bootstrap actor the moment
that finds a row. Every grant after the first names an existing operator's own `users.id`, so the
grant chain is walkable in the audit log (`admin_action`, §5) from the first admin forward. The
toggle's own idempotency lives in the `UPDATE`'s `WHERE` (`eq(users.isAdmin, !input.grant)`), the
same "judge by this write's own returned rows" discipline `removeReview` and `resolveFlag` use: a
second `--revoke` on an already-revoked account matches zero rows and reports that honestly
instead of writing a duplicate `admin_action` about a change that did not happen.

**What a deployment gets instead of an admin-creates-admin UI.** Nothing to build, review or
secure beyond the script — no page, no route, no confirmation email. A local developer gets the
identical path a production operator gets: `npm run seed` calls `seedOperator`, which grants the
same account that becomes team 1's owner and commissioner (`claimUserId` if the developer set
`DEV_SEED_CLAIM_USER_ID`, else the seed's first placeholder user) operator access through the real
writer — not a mock row, a real `admin_action` event and a real `admin_granted` notice, exactly
what running `scripts/grant-admin.ts` by hand would produce. `npm run seed && npm run dev` lands a
working dispute queue with no manual step, and the e2e suite's `ensureE2eOperator` grants the
suite's own stable test identity the same way, because there is deliberately no dev auth bypass to
grant it through instead.

**What would force a change.** The day the operator team is large enough that shell access to the
database host becomes the bottleneck is a real day, and it is one route away: `grantAdmin` already
takes a `grantedBy` id and writes a real audit trail, so the missing piece is a page that calls it
from an authenticated admin session rather than a CLI argument — the writer does not change, only
who is allowed to invoke it and how. Nothing here should be read as a bet that this scales forever;
it is a bet that it is the right shape for the team size this plan ships for.

## 2. 404 and not 403

**Chosen:** every admin surface answers 404 for a signed-in non-operator, never 403. `withAdmin`
(`src/app/api/admin/_shared.ts`) is the one gate on both sides of the wire — every route under
`src/app/app/admin/**` and `src/app/api/admin/**` goes through it, and
`src/app/app/admin/admin-routes.test.ts` is the route-tree tripwire that keeps a new admin file
from forgetting it, the same "enumerate the tree, fail if anything is ungated" discipline
`advisory-only.test.ts` uses. `requireAdmin()` throws `"Not an operator."` for a signed-in stranger, and
`withAdmin` turns that into `fail("Not found.", 404)` on the API side and `notFound()` on the page
side. `"Not authenticated."` (nobody signed in) is the one case that still answers differently —
401 on the API-route overload, because a caller with no session is told to sign in, not turned away
identically to a member who is signed in but not an operator.

**Why.** A 403 confirms to a signed-in stranger that the admin surface exists and only needs a
different account. A 404 tells them nothing they did not already have. This is not a new rule this
plan invents; it is the codebase's own existing non-oracle discipline, restated here so it reads as
one rule applied three times rather than three coincidences that happen to agree:

- `publicJoinPrecondition` (`src/league-service/join.ts`) answers 404, worded `NOT_PUBLIC`, for
  both "no such league" and "a real league that just isn't public" — `joinPublicLeague` remaps
  `joinLeagueInTx`'s own `LEAGUE_MISSING` 404 to this identical shape, so a caller posting a
  league id cannot tell the two cases apart. A 403 or a distinguishable 404 would be an existence
  oracle over every private league in the product.
- `LeaguePage` (`src/app/app/leagues/[leagueId]/page.tsx`) answers `notFound()` for a signed-in
  caller with no team in the league and no commissioner claim on it, so a stranger who guesses a
  real league id sees the identical page a nonexistent id produces.

Three call sites, one sentence: **a route never confirms that a guessed id names something real to
a caller who has no business knowing.** `withAdmin` is the highest-value instance of it in this
plan, because the admin surface is the one worth hiding hardest — Phase 2 Plan D's deploy hardening
inherits exactly this discipline rather than rediscovering it.

**401 stays distinguishable, deliberately.** Whether *this caller* is signed in is a fact about
their own state, not about whether the surface exists, so collapsing 401 into 404 would tell a
signed-out visitor nothing while costing every legitimate caller an extra round trip through
sign-in to find out they were never close. `withAdmin`'s page overload has no such distinction to
make: `src/middleware.ts` already redirects a signed-out `GET /app/**` to hosted sign-in before a
Server Component ever runs, so a page-side `requireAdmin()` failure is a non-operator every time in
practice, and both collapse to `notFound()`.

**What would force a change.** Nothing in this plan. The day this stops being a hidden surface —
public knowledge that `/app/admin/queue` exists, the way `/sign-in` is public knowledge — a 403
would leak nothing a 404 does not already cost in confusion; that is a UX tradeoff, not a security
one, and it is not this plan's to make.

## 3. The queue's shape

**Chosen:** one table, `integrity_flags`, with a `flag_type` discriminator (`multi_account`,
`review_report`, `chat_report`, and `trade_fairness`, raised by Phase 3 Plan C's own detector —
see `docs/decisions/trades-and-fairness.md` §6 and §9) rather than one table per detector. `resolved_at`/`resolved_by_user_id`/`resolution`/`resolution_note` are stamped columns on
the same row, not a separate resolutions table. Status is derived, not stored: `FLAG_STATUSES =
["open", "resolved"]` names the two values a reader computes from `resolved_at IS NULL`, and there
is no `status` column to disagree with it.

**One table, not one per detector.** The spec names `MultiAccountFlag` and `TradeFairnessFlag`
separately; one table per name would mean three queue queries, three detail views and three
resolution paths for one workflow, and Plan C would add a fourth of everything (ruling 28). One
table means Plan C adds a subject renderer and a row type. The cost is a jsonb `evidence` column
whose shape varies by `flag_type` — which is exactly what a discriminated union is — and
`src/integrity/queue-view.ts` narrows it at the one place it is read.

**The stamp, not a resolutions table.** The spec says resolution *"never mutates the original
flag."* A guarded stamp is that claim in the only sense that matters: no fact already on the row is
overwritten, the `UPDATE`'s own `WHERE` (`isNull(resolvedAt)`) makes it single-shot, and two
operators resolving the same flag at the same instant serialize on the row lock — the loser's
`UPDATE` matches zero rows because Postgres re-evaluates the `WHERE` against the now-committed
winner (§4). It is the shape this codebase has already chosen twice (`reviews.removed_at`,
`stat_weeks.version`). The alternative — deriving status from an appends-only resolutions table —
costs a join on every queue read for a relation bounded at exactly one resolution per flag, which
is the balance-as-rollup convention's own threshold (derive over a bounded set, roll up over an
unbounded one) read backwards. The **immutable** record of what happened is the `flag_resolved`
audit event (§5); the row is the queue's index into it, not the record itself.

**The partial unique index on open flags, and why a resolved subject may be flagged again.**
`integrity_flags_open_subject_idx` is unique on `(subject_type, subject_id)` **where `resolved_at
IS NULL`**. At most one *open* flag per subject: a second report of the same message, or a second
sweep finding the same pair, is confirmation rather than a duplicate — `raiseFlag`'s
`onConflictDoNothing` on that same index means a second call about an already-open subject returns
the existing flag, not a new row and not an error. Partial on the open condition specifically so a
*resolved* flag never blocks a later one about the same subject: content reported again after a
`no_action` verdict is a new question, not the old one reopened, and a subject with a closed history
should still be reportable.

**Oldest-first, no severity sort.** `integrity_flags_queue_idx` orders by `raised_at`, and
`pendingFlagQuery` reads it that way with no other ordering offered (ruling 30). A severity
ordering over a heuristic score is the platform quietly telling an operator which accusations to
believe, on the strength of a number this plan's own false-positive tests (§7) say will score high
for roommates. Oldest-first is the only ordering that cannot express an opinion, and it is also the
ordering that starves nobody: the two flag types with a human on the other end of them (a report)
are exactly the two an operator resolving by score would reach last. This is wrong only at a queue
volume no human can clear, which is the day the answer is more operators or a better heuristic, not
a sort that hides the backlog from whoever is triaging it.

## 4. The resolution vocabulary, and the test a decision has to pass to exist

**Chosen:** `RESOLUTION_DECISIONS = ["no_action", "warned_user", "content_removed",
"trade_reversed"]` (`src/integrity/flags.ts`), each with an owner in an exhaustive
`DECISION_OWNER: Record<ResolutionDecision, "plan-b" | "plan-c">`. `decisionIsAvailable(decision)`
returns `DECISION_OWNER[decision] === "plan-b"`, and `resolveFlag` refuses any decision that fails
it — `{ ok: false, status: 400, reason: "This product can't reverse a trade yet." }` — before any
write. `ACCOUNT_RESTRICTED` is not in the list at all.

**The test.** A resolution decision exists in the vocabulary when it has an implementation, **or**
it is declared with a named owning plan and a runtime refusal (ruling 2). Founder decision #5 drops
`ACCOUNT_RESTRICTED` on the reasoning that *"an enum value with no implementation is a control
wired to nothing."* Applied honestly, that reasoning also indicts `trade_reversed`: this product
cannot reverse a trade either, because it cannot make one yet. The test above is what separates
them rather than dropping both or keeping both. `trade_reversed` is declared, owned by `plan-c`,
and refused by name at runtime — the identical shape Plan A used for `score.update`, reserved
through a phase and turned on by name in a later one. `account_restricted` has no owning plan in
this phase and the spec's own out-of-scope list forbids account actions outright, so it is not
declared at all. A reserved name with no owner is how a control wired to nothing gets wired to
something by a future reader who assumes the name implies intent; declaring it only when a real
owner exists is what keeps that from happening.

**Why `content_removed` exists though the overview's default list didn't name it.** The overview's
list (`no_action`, `warned_user`, `trade_reversed`) predates this plan absorbing the moderation
residuals from Phase 2's identity-and-trust plan. The resolution of a report is very often a
removal, and without a decision that names what actually happened, an operator removing a message
would have to record it as `warned_user` — an audit trail that says something untrue about its own
event. It is also the only decision in the list with a complete implementation on the day this plan
merges (ruling 3): `resolveFlag`'s `content_removed` branch dispatches to `removeReviewInTx`
(review subject) or `removeChatMessageInTx` (chat_message subject) inside the *same* transaction as
the stamp, so a decision and its consequence cannot come apart — a refusal from either remover
(already removed, a ghost id) is re-thrown as `ContentRemovalRefused` and rolls the whole
transaction back rather than leaving a flag stamped "resolved: content_removed" with nothing
actually removed.

**What Plan C changed.** `trade_reversed` moved from refused to implemented:
`reverseTradeInTx` (`src/league-service/trade-reversal.ts`) is the mechanism, called from
`resolveFlag`'s `trade_reversed` branch in its own transaction (§5's "one transaction, one chain"
ruling — the reversal's own anchor is the league chain, `resolveFlag`'s is the platform chain).
Nothing else in this file's vocabulary changed: `DECISION_OWNER.trade_reversed` still reads
`plan-c` as PROVENANCE (who built it), but `decisionIsAvailable` no longer asks who owns a
decision — Plan C's own fix replaced the one-axis `DECISION_OWNER[d] === "plan-b"` check with a
two-axis `DECISION_WIRED_FOR: Record<ResolutionDecision, Record<FlagSubjectType, boolean>>` that
also subsumes what used to be a separate `CONTENT_REMOVAL_WIRED_FOR` table — the collapse was
worth doing in the same commit that first made ownership and wiring diverge, because Plan B's own
LOW 13 was the one-axis version of the identical bug (a `content_removed` decision against an
account pair reaching an unwired branch became a 500, and a 500 is not a refusal). See
`docs/decisions/trades-and-fairness.md` §8 for the reversal's own shape — a compensating transfer,
forward-only, never re-scoring a settled week.

## 5. Where an operator action is recorded

**Chosen:** every investigatory event — `flag_raised`, `flag_resolved`, `admin_action` — appends to
the **platform chain**, `leagueId: null` on the event itself, with the real league id (if any)
carried in the payload instead. The **league chain** is used only for a consequence the league
shares: a stat correction's `system_action` (§10), and a chat removal's own effect on the
conversation the room can already see (the `admin_action` for a chat removal is still
platform-scoped — see below — but the removal itself, the message tombstone, is a league-visible
fact by construction, §8).

**The two classes, and the sentence that decides which one a future action is:** *a record about a
person under review is not the league's business; a record about a consequence the league already
sees is.* `flag_raised`/`flag_resolved` are about a person (an account pair, a review's or a
message's author) being looked at — even when nothing comes of it. `admin_action` for a grant or a
chat removal is about the platform's own act, addressed to nobody's audience but the platform's own
trail and the affected member's own notice. `stat_week_corrected`'s `system_action` is different in
kind: it is a fact about the *league's shared scoreboard*, true for everyone in it, which is exactly
why it is the one action in this plan allowed to summarize itself to the room at all (§9).

**Why the platform chain buys a property no visibility flag can.** `scopeFor` derives an event's
chain scope from `leagueId`, and Plan A's invariant is that the column and the scope always agree.
A platform-chain event is therefore never read by `listLeagueActivity` at all — not filtered out at
render time, structurally unreachable from that query. `ACTIVITY_VISIBILITY.flag_raised`,
`.flag_resolved` and `.admin_action` are all `"hidden"` in `src/integrity/activity-view.ts` besides,
so this plan holds the line on two independent dimensions: even if a future author flipped one of
those three entries to `"everyone"`, the event still could not reach a league feed, because it is
never in the set `listLeagueActivity` reads in the first place. Two defenses, because one of them
is one line away from being wrong.

**The consequence, accepted honestly.** A member's own activity feed will never show that they were
reported — this is deliberate, and it is ruling 6's other half (§6): the record exists (the audit
event is written either way), but nowhere a member looks for their own history will it appear. The
cost to accept: `audit_events_league_occurred_idx` does not serve these rows at all, which is fine,
because the queue reads `integrity_flags` directly, never the chain, for its own listing (§3).

**One transaction, one chain.** Plan A's ruling 3 — a transaction appends to at most one chain,
`recordAll` throws on a batch spanning scopes — binds every write in this plan the same way it
binds Plan A's own. This is why a stat correction affecting two leagues is two transactions and two
league chains (§10), and why `raiseFlag`'s insert (which carries a foreign key to `leagues` and
therefore an implicit `FOR KEY SHARE`) is the only write in `raiseFlag` — it runs before the anchor
automatically, because there is nothing else to sequence.

## 6. Who is told, and the one exception

**Chosen:** every operator action notices the affected member, except `no_action`. The mapping is
exhaustive — `NOTICE_FOR_DECISION: Record<ResolutionDecision, NoticeType | null>`
(`src/integrity-service/flags.ts`) — so a decision landing later with no entry here fails to
compile rather than silently inheriting "tell nobody."

**`no_action` tells nobody, on purpose.** An investigation that closed with nothing happening is
not an event in that member's life, and *"we looked into you and found nothing"* is precisely the
accusation `INTEGRITY_CONFIG.notices.accusatoryTerms` exists to keep out of this product's copy.
The record still exists regardless — `flag_resolved` is written either way, on the platform chain
— so the exception is entirely about who is *told*, never about what is *recorded*. This is wrong
only if a regulator later requires subject notification of a closed investigation, which is a
Phase 4 question with a one-entry answer: flip the map's `no_action` entry to a real `NoticeType`.

**`content_removed` is `null` here too, but for a different reason: it already notified.**
`removeReviewInTx` and `removeChatMessageInTx` each send their own notice
(`review_removed`/`chat_message_removed`) inside the *same* transaction as the removal — a second
notice from `resolveFlag` itself would tell the member twice about one decision. `warned_user`
is the one decision `resolveFlag` notices directly, with `operator_warning`.

**The reporter is never told the outcome, and why.** Telling a reporter the outcome tells them the
outcome of a decision about somebody else — an operator's private read on a third party, handed to
whoever happened to click report first. The alternative, a bare *"we looked at it,"* is a
notification carrying no information a reporter could act on, which is worse than the silence it
replaces. What a reporter gets instead is confirmation at the moment of reporting — the report
itself succeeding is the acknowledgment — and nothing further.

**Every notice this plan sends states plainly that there is no reply (ruling 19).**
`operator_warning`, `chat_message_removed` and (from Phase 2) `review_removed` each end their body
with the identical sentence: *"There is no reply to this message."* Founder decision #4's default is
no appeal path; the ruling is not the absence of one, it is the disclosure of the absence. A notice
that describes a decision and offers no reply invites a member to hunt for one, so the notice says
outright that there isn't. `admin_granted` and `stat_week_corrected` carry no such line — neither is
a sanction, and there is nothing to appeal. Adding an appeal later costs nothing this plan built: it
is a new notice type and a new flag type in the queue this plan already opened, which is exactly why
not building one now costs nothing later.

**The reason travels in the closed vocabulary's own phrase — to the author's notice, never to the
room.** `chatRemovalPhraseFor`/`removalPhraseFor` (`src/moderation/removal.ts`) map a stored
`ModerationReasonValue` to a human sentence fragment, and that mapped phrase is exactly what a
removed message's or review's *author* reads in their private notice's blockquote (`quoteFor`,
`src/integrity-service/notify.ts`). It is **not** what the room sees: a removed chat message's
tombstone renders only *"We removed this message."* — see §8 for why that split between the author's
notice and the room's own view is deliberate rather than an inconsistency.

## 7. The multi-account detector

**Chosen:** league-bounded, flag-only, run as a sweep triggered by a join, never a subscriber.

**Bounded to one league, never platform-wide.** `sweepLeagueForMultiAccounts(db, leagueId, deps)`
reads exactly three batched queries regardless of member count — this league's `teams`, every
member's `session_signals` (`signalsForUsers`), and this league's own draft's `MAKE_PICK` actions —
and compares every pair *within* that set, `n·(n-1)/2` of them. The spec bounds this for compute
cost, but the reason that actually matters is false-positive exposure: two strangers on one office
network who have never met are not a question anybody should be asked to answer, and a
platform-wide comparison would ask it constantly. `multi-account.test.ts`'s first test asserts the
*pair count* as well as the flag count, so a widened sweep fails loudly rather than quietly costing
more.

**The three heuristics and their arithmetic** (`src/integrity/similarity.ts`, pure, no I/O):

- `deviceSimilarity(a, b)` — Jaccard over each account's distinct client signatures
  (`DeviceProfile.signatures`, `userAgent|acceptLanguage` pairs). `|A ∩ B| / |A ∪ B|`, `0` — never
  `NaN` — for an empty union.
- `ipCorrelation(a, b)` — the identical Jaccard over addresses, but counting **only**
  `source === "platform_verified"` rows. Weight `0` today; see the release gate below.
- `behavioralSimilarity(a, b)` — `1 - min(1, |medianA - medianB| / cadenceToleranceSeconds)` over
  each account's median seconds between draft picks, floored at `0`. Answers `0` — not a guess —
  when either side's sample is below `minActionsForBehavioral` (5): a median over two picks is
  noise, and noise fed into a weighted sum is a flag raised about a real person on the strength of
  nothing.
- `multiAccountSuspicion(scores, weights)` — the weighted mean, **normalized by the weights
  actually in play**: `Σ(w·s) / Σw`, not a plain `Σ(w·s)`. This is what makes a zero-weighted
  signal genuinely inert rather than merely small — it is excluded from both the numerator and the
  denominator, so it cannot move the score by any amount, however extreme its own value is.

**The flag-only contract test.** `src/integrity/flag-only.test.ts`, in `advisory-only.test.ts`'s
shape, with the same four properties: a type-level guard (`RaiseFlagInput` has no resolution field
— proved with a `@ts-expect-error`), a non-vacuity assertion (the scan actually finds files to
check), recursive traversal excluding only `.test.ts`, and every offender collected rather than
failing on the first. It proves, by import-closure analysis, that nothing reachable from the
detector can import `grantAdmin` or any account-mutating write — a flag reaching `PENDING_REVIEW`
(there is no other status a flag is ever raised at) is the detector's entire reach.

**The false-positive tests that must not be "fixed."** `multi-account.test.ts` carries a
`describe("known false positives, which are CORRECT behavior and not defects")` block — shared
device, shared IP, family-in-one-league — each asserting a flag **is** produced and naming that as
correct, with `DO NOT "FIX" THIS TEST` in the first one's body. A detector this coarse will flag
roommates and siblings; that is why resolution is a human decision (`resolveFlag`, §4) rather than
an automated one, and a future author "fixing" one of these tests to stop flagging a synthetic
family is quietly weakening the detector everywhere, not fixing a bug.

**The IP release gate, in full.** The weight is zero on merge (`INTEGRITY_CONFIG.multiAccount.weights
= { device: 0.6, ip: 0, behavioral: 0.4 }`) and stays zero until two things land *together*:

1. A trusted proxy in front of the app (Fly's proxy, Phase 2 Plan D) that overwrites
   `X-Forwarded-For` rather than trusting whatever a caller sent.
2. `session_signals.ip_source` continuing to discriminate `platform_verified` rows from
   `xff_unverified` ones — which `ipCorrelation` already only counts the former of — so flipping the
   weight is a filter that starts trusting rows already tagged as trustworthy, never a data audit
   that has to retroactively decide which old rows to believe.

The reasoning for zero, not just the fact of it: every address this product can see today comes
from a header the caller controls until a trusted proxy overwrites it. A rate limiter keyed on a
forgeable header loses a speed bump — an annoyance, not a harm. A **multi-account flag** keyed on
one lets an attacker manufacture suspicion against somebody else's account, and because the flag
names a **pair**, the manufactured suspicion lands on a real, uninvolved person who did nothing.
`multiAccountSuspicion`'s normalization (above) is what makes the zero airtight rather than merely
conservative: a test in `multi-account.test.ts` proves device and behavioral signals alone can cross
`flagThreshold` (0.75) with the IP weight held at zero, so the gate is provably load-bearing, not
decorative. If the release-gate test ever fails, the honest fix is the heuristic, never the weight.

The gate is recorded in two places by design, so it cannot be found in only one: here, and in the
phase overview's founder-gated bucket (`docs/superpowers/plans/2026-08-20-phase3-overview.md`),
beside Phase 2 Plan D's XFF-limiter item — the same underlying platform-verified-IP dependency
gates both, and a reader who finds one gate should find the other beside it, not have to go
looking.

**The triggers, and why it is a sweep and not a subscriber.** There are **two**, and each fires at
the moment one of the sweep's own inputs comes into existence. A subscriber on every session start
would re-derive the same answer thousands of times for a question whose inputs change twice.

1. **A seat fills.** A league's pair set changes exactly here, so `joinLeagueInTx`'s two callers
   (`acceptInvite`, `joinPublicLeague`) call `triggerMultiAccountSweep(db, outcome)` **after** their
   own transaction commits, never inside it (ruling 11).
2. **A draft completes.** The behavioral signal changes exactly here: `profilesFor` derives cadence
   from the league's own `MAKE_PICK` rows, and a league has none until its draft has run. The draft
   store (`src/draft-service/store.ts`) fires the sweep after the transaction that turned the draft
   into a season commits.

The second trigger is not an optimization; without it the detector **raises nothing in production**,
which the final whole-branch review found and which is arithmetic rather than a bug. A join is
refused once the draft leaves `scheduled` (`publicJoinPrecondition`) and no seat reopens afterwards,
so at every real firing of trigger 1 the league has zero `MAKE_PICK` rows,
`behavioralSimilarity` returns its sample floor of `0`, and the remaining weight
(`device` 0.6, `ip` 0) cannot reach `flagThreshold` 0.75 even at a perfect device match. Trigger 1
stays because the pair set really does change there and it becomes meaningful the day the IP weight
leaves zero; `multi-account.test.ts`'s "the trigger timing that actually ships" drives both moments
against a real join and a real completed draft, and asserts that ceiling explicitly so the
limitation is a red test the day a weight changes rather than a fact nobody rediscovers.

The **after-commit** placement is the deliberate part, and it is the same for both triggers: the
sweep appends to the platform chain (a second anchor lock) while the triggering transaction may
still be holding `league_invites` `FOR UPDATE` (the invite door), `leagues` `FOR UPDATE` (both join
doors) or `drafts` `FOR UPDATE` (the draft store) — running the sweep inside that transaction would
be a second anchor lock taken while another lock is already held, exactly the ordering hazard Plan
A's write-ordering rule exists to prevent. A failed sweep is logged and swallowed, never re-thrown
(one implementation, `sweepQuietly`, shared by both triggers): the person joining did nothing wrong
and neither did the league that just finished drafting, and
`scripts/sweep-multi-account.ts` (`npm run integrity:sweep -- --league <id>`) is the manual re-run
for a league whose signals moved after both triggers fired, or whose trigger itself failed. The
join's own audit event, `member_joined`, is written **inside** its transaction, where it belongs —
the sweep's `flag_raised`, if any, is a second, independent append.

**A flag is raised by the platform; a member's report is a signal that raises one (ruling 12).**
There is no "report this member" affordance anywhere in this plan — everything reportable is a
**piece of content** (a review, a chat message), and every flag whose subject is a *person*
(`account_pair`) is raised by the sweep, with no human on the other end of it
(`raisedByUserId: null`, `actorType: "system"`). A product where one member can put another member
in an operator's queue by clicking a button is a product with a new harassment vector, and this
plan does not open one.

## 8. Moderation

**Founder decisions 1, 2, 3 and 4, as shipped.**

1. **pg-13 stays, documented as unreviewed.** `GIPHY_CONFIG.rating` is unchanged, and whether it is
   the right ceiling for a real-money product's chat rooms remains a founder/product question, not
   an engineering one — put in front of the persona panel rather than settled in this doc, because
   four personas answering it differently is the useful output. The engineering half needed no work:
   a GIF is one `chat_messages` row (`identity-and-trust.md`'s ruling 17), so the removal stamp
   built for text covers a GIF by construction the moment a Giphy key exists.
2. **One closed reason vocabulary, in `src/moderation`.** `MODERATION_CONFIG.reasons` — `spam`,
   `abusive`, `other` — is the single source both a review report and a chat report pick from.
   `src/reviews/config.ts` re-exports it (`REMOVAL_REASON_VALUES` widened back to `readonly
   string[]` there, deliberately, so `scripts/remove-review.ts`'s existing `.includes()` check keeps
   compiling unchanged), which is what makes this a de-duplication with a zero diff at every
   existing consumer, not a refactor.
3. **Operator-only removal. No commissioner path, even in a private league.** A commissioner can
   already remove a *member* from their own league; they cannot remove a *message*. §4.1's original
   reasoning for operator-only removal — *"a public league can't trust a stranger the same way"* —
   is not obviously right for a private league too, and the asymmetry is worth a commissioner
   reading it somewhere calm rather than discovering it while angry. Commissioner removal in
   private leagues stays a later, additive decision: one more actor branch in
   `removeChatMessageInTx` and one more entry in its audit payload, whenever it lands.
4. **No appeal, stated on the notice itself.** Covered in full in §6.

**Why chat renders a removed message in place, and a removed review vanishes (ruling 18).** Not an
inconsistency — a review feed is a list of independent opinions, and a missing one is unnoticeable;
a conversation is sequential, the people in it already saw the message before it went, and a silent
hole is a conversation everybody misreads, on top of handing the author a deniability the room can
see straight through. So the chat row keeps its shape: the author and avatar stay (attribution is
not the thing being removed), the words do not (`ChatMessageView.removal`'s body is withheld on the
wire entirely, not merely hidden by the client), and `RemovedMessage` (`src/chat-room/components/`)
renders exactly one neutral sentence: *"We removed this message."* Active voice with the platform
as the named actor, because the house copy rulebook (`src/integrity/copy-rules.ts`) bans the
passive construction the first draft of that sentence used, and the room is written in the same
voice as the notices that rulebook governs.

**The reason renders in the closed vocabulary's own phrase — but only in the author's own notice,
and it never reaches the room at all.** An earlier reading of ruling 18 would have the room itself
render the mapped phrase (`chatRemovalPhraseFor`) beside the tombstone. That is not what shipped: a
fix-round adjudication moved the phrase to the author's private `chat_message_removed` notice
exclusively. That first fix left `removal.phrase` *on the wire*, unrendered — and the final
whole-branch review's HIGH 1 was that unrendered is not unsent: `ChatMessageView` reaches every
member of the room, in the page payload and in every live `chat.message` SSE frame, so any member
could read a leaguemate's removal reason out of devtools or off the stream. `ChatMessageRemoval` is
now `{ at }` and nothing else — the sticky-removal fold (`src/chat/messages.ts`) only ever needed
the object to be non-null, never its contents — so re-leaking the reason does not compile, and the
wire-level guards in `src/chat-service/chat.test.ts` and `src/chat-service/moderation.test.ts`
assert on the serialized payload and on a reconstructed SSE frame rather than on a render. The
reasoning: a reason broadcast to a whole room, permanently, in
a real-money league, is a public accusation, and it runs against the same minimal-disclosure norm
that makes `no_action` tell nobody (§6). The fact that a message went is what preserves the
conversation's shape (ruling 18's whole purpose); the reason does not have to ride along to do
that, and reviews' own precedent — a removed review's reason reaches only its author, through
`quoteFor`'s private blockquote — is the shape this plan mirrors rather than departs from. Both
removal notices, review and chat, carry the identical closing sentence: *"There is no reply to this
message."*

**`chatRemovalPhraseFor` split from `removalPhraseFor`, not reused.** A fix-round finding was that
the review phrase mapper's generic fallback — *"breaking the review rules"* — was leaking into
chat's own removal notice (and, before the fix, the room's tombstone). `chatRemovalPhraseFor`
(`src/moderation/removal.ts`) reads the identical closed vocabulary but returns
`"breaking the chat rules"` for the `other` catch-all; `spam` and `abusive` already read as
domain-neutral content descriptors and repeat verbatim. One vocabulary, two renderers — the same
"two record types cannot share one type's internal module" reasoning that put the vocabulary in
`src/moderation` rather than inside `src/reviews` or `src/integrity` in the first place (ruling 21,
below).

**Why `src/moderation`, and why not `src/integrity`.** `src/integrity/**` is on the client-boundary
**blocked** list (`docs/conventions.md`) — it reads `node:crypto` and is Postgres-backed, neither of
which is browser-safe — and the chat report dialog (`src/chat-room/components/report-dialog.tsx`)
needs the reason labels as *values* to render a picker. `src/moderation/**` is a third pure,
I/O-free directory, browser-safe by the same test `src/chat`, `src/matchmaking`, `src/identity`,
`src/help` and `src/reviews` already pass, and it joins the exempt list in `docs/conventions.md`'s
client-boundary section for the identical reason those five do. Two similarly-named directories,
two different boundaries: `integrity` is the server-only machinery that decides what happened and
records it; `moderation` is the vocabulary of what may be removed and why, needed on both sides of
the wire.

**Reporting content that is already removed, and what the operator is then offered.** Neither
`reportMessage` nor `reportReview` checks `removed_at IS NULL`, and the open-subject unique index
dedupes only OPEN flags — so a member can report a tombstone, and a fresh flag opens on it. Both
of those are deliberate: a report on content that is already gone is a real question (the author
may still deserve a warning), and auto-resolving it would answer that question on the operator's
behalf. What the queue detail page does instead is offer only the decisions that can actually
succeed: `no_action` and `warned_user`, with `content_removed` withheld and the card saying why
(*"We already removed this content. You can still close this flag or warn the member."*). The
operator still reads the words — a removed row keeps its body forever, and only the member-facing
wire withholds it — because they cannot judge whether to warn without them. `resolveFlag`'s own
409 stays underneath as the backstop for a direct POST.

**`content_removed` is refused before the transaction opens for a subject it cannot remove.**
`CONTENT_REMOVAL_WIRED_FOR` (`src/integrity/flags.ts`) is the one table naming which subject types
have a remover, read by three consumers rather than re-derived by each: the queue detail page
(which decisions to offer), `resolveFlag` (which to refuse, in product copy, before any write) and
`removeSubject` (the throw that backstops both). Before this, a direct POST of `content_removed`
against an `account_pair` flag reached `removeSubject`'s unwired branch and became a 500 —
admin-only and fail-safe, since the transaction rolled back, but a crash is not a refusal.

## 9. The `renderSystemAction` gate, closed

**The re-review Plan A required.** Plan A's own residuals section named the hazard explicitly:
`system_action` is `"everyone"` in `ACTIVITY_VISIBILITY`, and `renderSystemAction` renders whatever
`payload.summary` string it is handed, verbatim, to every member of a league. That had been safe
only by accident of what existed — the sole publisher on merge was
`scripts/verify-audit-chain.ts`'s detection append, which writes no `summary` and is
platform-chain-scoped besides. Plan A required a re-review before anything published a
league-scoped `system_action`, rather than leaving the hole open for whichever plan got there
first. This plan is that first publisher (`correctSettledWeek`, §10), so this plan owed the
re-review.

**The outcome, as a table.** `SYSTEM_ACTION_SUMMARY_ALLOWED: Record<SystemActionCode, boolean>`
(`src/integrity/system-actions.ts`) is the third deny-by-default dimension in this codebase, added
to the two Plan A shipped (`ACTIVITY_VISIBILITY` decides which *types* a member sees at all; each
payload renderer decides which *fields* reach a headline). A `SystemActionCode` with no entry here
does not compile, so writing a summary for an action nobody signed off on is a type error, not a
review comment somebody could miss:

| `SystemActionCode` | Allowed | Why |
|---|---|---|
| `stat_week_corrected` | **true** | A fact about the league's shared scoreboard, true for everyone in it, about nobody's conduct. A member who is not told is a member reading standings that changed under them. |
| `chain_verification_failed` | **false** | Restates Plan A's ruling 8: telling a league its record may have been altered, before a human has read the output, is the accusatory failure mode this phase spends a denylist preventing. |
| `lineup_auto_set` | **DECIDED** — `subject_only` | Phase 3 Plan D shipped the publisher (`autoSetLineupInTx`, `@/league-service/auto-lineup`) and, with it, the answer this section's own pre-decided note got half right: the competitive-sensitivity argument is correct, but the delivery path is `subject_only`, not `actor_only` — a `system_action` has `actorType: "system"` and therefore `actorId: null` by construction, so `ACTIVITY_VISIBILITY`'s own `actor_only` branch (which compares `event.actorId` to the viewer) can never match one. The member an auto-set concerns is the SUBJECT, carried on `payload.subjectUserId`. See `docs/decisions/enforcement-and-tiers.md` §5. |
| `trade_held_for_review` | **DECIDED** — still denied, now structurally | Phase 3 Plan D supplied the number this row was waiting on (`INTEGRITY_CONFIG.trade.autoHoldThreshold` is `35`, `docs/decisions/trades-and-fairness.md` §7) and the denial survives it, for a reason stronger than "undecided": a hold's `system_action` is written on the PLATFORM chain, and a platform-chain event is never read by `listLeagueActivity` at all. The denial stopped being a decision anybody has to keep making. See `docs/decisions/enforcement-and-tiers.md` §5 and §7. |

**The pre-decided answer, and what it got right and wrong.** This section originally told Plan D
not to simply flip the table entry, and to build an **actor-scoped** delivery path instead — a new
visibility, not a new summary. Plan D's own re-review (`docs/decisions/enforcement-and-tiers.md`
§5) took the "a new visibility, not a new summary" half whole and corrected the one word this
section could not have tested without the code in front of it: the path that means something for
an actorless event is `subject_only`, not `actor_only`. That correction is Plan D's to own — this
section stays as the record of the question Plan D inherited, not the last word on the answer.

**Where the dimension lives now.** `SYSTEM_ACTION_SUMMARY_ALLOWED` above is HISTORICAL as a
hand-maintained table: `src/integrity/system-actions.ts` now exports `SYSTEM_ACTION_VISIBILITY`
(`Record<SystemActionCode, "everyone" | "subject_only" | "hidden">`), the fourth deny-by-default
dimension, and `systemActionSummaryAllowed(code)` derives the old boolean from it (`=== "everyone"`)
rather than the codebase carrying two tables that could disagree the first time somebody edited
one — the same collapse this plan performed on `CONTENT_REMOVAL_WIRED_FOR` in Plan C. Every
`SystemActionCode` this codebase has, including the two Phase 3 Plan D added
(`tier_blocked_join`, `draft_auto_started`), is decided there now. `docs/decisions/
enforcement-and-tiers.md` §5 is the section that owns the dimension going forward; this section
stays for its own history, `stat_week_corrected` and `chain_verification_failed` included, both
unchanged by the subsumption.

**Where the check runs.** `renderSystemAction` (`src/integrity/activity-view.ts`) checks
`SYSTEM_ACTION_SUMMARY_ALLOWED[action] === true` *and* `typeof payload.summary === "string"` before
rendering anything; either failing is a silent `null` row, the same deny-by-default shape
`ACTIVITY_VISIBILITY`'s own `default: return null` uses for a type the renderer's switch does not
recognize. `activity-view.test.ts` pins all three current entries against the real verifier and
correction payloads, not against a hand-typed stand-in.

## 10. Stat corrections

**Founder decision #11, as shipped:** operator-chosen week, no hard reach-back limit, always
re-settling, every affected manager told. `correctSettledWeek` (`src/stats-pipeline/correction.ts`)
is the operator path `docs/decisions/live-scoring-pipeline.md` §10 named as its own residual — a
revision to a week that has fallen out of the ingestion worker's three-day correction sweep, or to
any week but the most recently settled one. `correctionCandidate` never runs here; this function
goes around it on purpose.

**The two-phase budget reservation, and the fail-closed ledger.** `RequestBudget` has no release
path, so reserving a worst case up front would spend real ceiling on requests the call might never
make. Phase one reserves exactly one request (the schedule call); phase two, once the schedule is
in hand and the box scores worth fetching are known, reserves exactly that many. A denial at
*either* phase fails closed — nothing has been read from the provider and nothing written to
Postgres — mirrored in the copy itself (`CORRECTION_DENIAL_REASONS`): *"nothing has been read or
written."* This is a **third spender** against the same monthly ledger the ingestion worker and the
backfill reserve already draw from, never a second ledger with its own ceiling to reconcile against
the first.

**There is no hard reach-back limit, and the request budget is the real ceiling.** A hard limit
would be inventing a number with no basis — the correction machinery is genuinely idempotent at any
depth, because `persistTick`'s own Postgres-level conflict resolution (`changedRowWhere` /
`onConflictDoUpdate`) is the arbiter of "did anything actually change," not a snapshot diff that
degrades with age. What bounds an operator's ability to correct is the same shared monthly ceiling
that bounds everything else this pipeline reads from a paid provider, and it fails closed on a
Redis outage — unlike every cache elsewhere in this repo, which degrades open. An operator running
`npm run stats:correct` prints the delta the ledger charged last, and always, whether or not the
correction changed anything.

**One transaction per league.** Plan A's ruling 3 binds here exactly: a transaction appends to at
most one chain. Two leagues affected by one week's revision means two transactions
(`correctLeagueInTx`, called once per league from `attemptLeague`) and two league chains — never
one giant transaction holding a lock across every affected league's chain at once. The global
`persistTick` call runs once, **before** any per-league transaction and outside all of them, because
`stat_weeks` is keyed on week alone and is not league-scoped at all. A partial failure therefore
means some leagues re-settled and some did not (`leaguesFailed`, named by id and reason, never
silently dropped) — recoverable by re-running, because the machinery is idempotent, and strictly
better than one transaction that holds every affected league's lock hostage to whichever league
fails first.

**Who is told, and who is not.** Only a manager whose **team's points actually moved** is told —
"every affected manager" (founder decision #11) means *affected*, not merely *present in a league
that re-settled*. `correctLeagueInTx` diffs each team's before/after state and skips any team whose
points did not change; a league that re-settles to byte-identical numbers is still honestly
re-settled (`leaguesResettled` counts it), but writes nothing (`leaguesChanged` does not), because a
`system_action` row claiming a change would be false. For a manager who *is* told, the notice names
whether the change moved their **result**, not just their points: `correctionOutcome` resolves one
of exactly three fixed clauses (`StatWeekCorrectionOutcome`) from the team's before/after
win/loss/tie — never free text, so `notices.test.ts`'s copy sweep covers every sentence this notice
can produce, not one sample of it. The reasoning for naming the outcome explicitly, not just the
point delta: a member reading *"your score changed by 0.4"* and discovering three days later that it
turned a win into a loss has been told a true thing and misled anyway. `stat_week_corrected`'s
per-manager notice and the league-wide `system_action` summary (§9, allowed for exactly this action)
are composed from the same underlying template, so the impersonal, league-wide sentence and the
personal one can never say different things about the same correction.

## 11. Threat model additions

Plan A's threat model (`docs/decisions/audit-and-integrity.md` §9) draws two tiers: an adversary
holding the application's database role (tier 1, fully detected), and one holding table ownership
(tier 2, undetectable, and no trigger design changes that). This plan adds a role, not a tier — an
operator is inside tier 1 by definition, holding an ordinary authenticated session against the
application, never a database credential of their own.

**Every action an operator takes is on the chain.** `resolveFlag`, `grantAdmin` and
`correctSettledWeek` each write a real, hash-chained audit event — `flag_resolved`, `admin_action`,
`system_action` — inside the same transaction as the mutation itself (§5). A compromised operator
session is therefore a tier-1 adversary in every sense Plan A's model already covers: every write it
makes is caught by the identical mechanisms that catch anyone else's — the hash chain for
modification, the sequence gap for mid-chain deletion, the anchor reconciliation for a deleted tail,
the checkpoint cross-check for a rewound anchor. Nothing about holding `is_admin = true` grants
immunity from any of that; it grants a wider set of transactions to write, every one of which is
still just a transaction.

**What a compromised operator session CAN do:** resolve flags (any decision now wired —
`no_action`, `warned_user`, `content_removed`, and since Plan C `trade_reversed`), remove chat
messages and reviews, reverse an executed trade between two members (a roster mutation, though one
bounded to restoring a recorded prior state and refused once any traded player has moved again —
`docs/decisions/trades-and-fairness.md`), and read the
detector's raw evidence for every open flag (`src/integrity/queue-view.ts`, admin-only by
construction — §3, ruling 16). Each of these is a real, if unwelcome, capability an attacker with a
stolen operator session would have, and each leaves the identical trail an honest operator's use of
it would.

**What it CANNOT do: grant itself, or anyone else, anything.** `requireAdmin` has no
privilege-escalation path inside the application at all (§1) — `grantAdmin` is called from exactly
one place reachable by a running server process's own code (`scripts/grant-admin.ts` is a CLI entry
point, not an API route or a Server Action any session-holding request can reach), and
`seed-operator.test.ts`'s source scan is the tripwire that keeps a second caller from ever compiling
in unnoticed. A stolen operator session is bounded by exactly the privileges that session already
carries; it cannot mint a second one, or a third, because the grant is not reachable from inside the
application at all — the highest-privilege mutation in this product requires shell access to the
database host, which is a materially different bar than any session-hijack vector reaches.

**The device signal is two forgeable headers at weight 0.6, and a flag can be aimed.** Recorded
here, and NOT re-weighted, because re-weighting would be treating a documentation gap as a
detection one. `signatureOf` (`src/integrity-service/multi-account.ts`) is
`` `${userAgent}|${acceptLanguage}` `` — stored verbatim, truncated, never hashed — and both
strings are entirely caller-supplied. With `weights.device = 0.6` and `flagThreshold = 0.75`, a
pair needs `device >= 0.583` to be flaggable at all, and at `device = 1.0` it needs only
`behavioral >= 0.375`, which is median pick gaps within 37.5 seconds of each other.

Two halves, and only one was already written down:

- The FALSE-POSITIVE half is documented and accepted: two ordinary single-device mobile members
  with identical UA and `en-US` collide at `device = 1.0` with no effort at all, and
  `multi-account.test.ts` says so in three named tests ("known false positives, which are CORRECT
  behavior and not defects"). A flag is a question for a human, and an operator resolves it
  `no_action` in ten seconds with nobody ever told they were looked at (§6).
- The DELIBERATE-MANUFACTURE half was not, and this paragraph is it. An attacker who knows a
  victim's exact `User-Agent` and `Accept-Language` and shares a league with them can set both
  headers to match and pace their own picks to the victim's, and manufacture a `multi_account`
  flag naming that victim.

**Why documenting is the right answer rather than hashing.** Hashing the signature with
`SESSION_SIGNAL_SALT` adds nothing against this attacker: they are not replaying a stolen hash,
they are re-sending a self-reported string, and the hash of a forged string is the hash of the
victim's string by construction. What the manufactured flag actually buys is bounded and small: it
is a FLAG, never an action — `src/integrity/flag-only.test.ts` proves no code path reachable from
the detector can suspend, ban or restrict anything — read by a human beside the pair's join dates
and every signal that fed the score, and resolved by that human. The cost of the attack is an
operator's time and a platform-chain record; the cost to the victim is that a person looked, and
`no_action` tells nobody (§6).

**The real hardening is a verified signal, and its gate is already open.** The IP signal is pinned
at weight zero for exactly this reason and flips on when two things land together: Fly's proxy
overwriting `X-Forwarded-For` (Phase 2 Plan D) and `ipCorrelation` counting only rows stamped
`platform_verified`, which it already does. A platform-VERIFIED signal is the category that cannot
be aimed, and any future verified device signal joins the weighting on the same terms. Until then
the honest position is that the detector's strongest input is self-reported, an operator reading a
`multi_account` flag is told so on the queue view itself (`src/integrity/queue-view.ts`'s own
docblock), and the flag-only contract is what bounds the damage.

**What would move this boundary.** Everything Plan A's §9 already names — a periodically published
head, an HMAC key held outside Postgres, off-box WAL archival — moves the tier-2 boundary, and moves
it for every write in this product including this plan's, without this plan doing anything further.
Nothing specific to the operator role needs its own hardening beyond what §1 and §2 already build:
the role's entire security model is "make the grant unreachable from any code a compromised session
can execute," and that is complete as shipped, not partial.

**Phase 3 Plan C's addition: two accounts under one person can now move value between themselves in
a single audited transaction.** A trade between a manager's own two teams in the same league is
legal at the application layer — `proposeTrade` never checks whether the two `userId`s behind two
teams are the same person, because nothing about a trade's mechanics depends on that fact. That is
exactly the behavior `trade_fairness` detection exists to raise a question about: an unusually
lopsided completed trade between two specific teams is the observable signature this mechanism was
built to notice, regardless of why the two sides agreed to it. See
`docs/decisions/trades-and-fairness.md` §10 for the full addition, including what it deliberately
does NOT add — no account action reachable from a trade flag, no money movement, and no path from a
flag to an automatic consequence. The detection is a question for a human, exactly like every other
flag type this section already covers.
