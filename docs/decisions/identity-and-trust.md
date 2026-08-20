# Decision: identity and trust

**Date:** 2026-08-19 · **Phase 2, Plan C** · Spec: `.superpowers/sdd/2026-08-19-phase2-plan-c-onboarding-and-trust/`

This doc is written before the work it describes, not after — the same retrofit shape Phase 2's
Step 5 used for its own audit. Task 3 opens it with the one section a retrofit needs first: the
complete list of every place the product currently says who somebody is, checked off as each row
is satisfied. Later tasks in this plan append their own sections below rather than starting a
second document, so "identity and trust" stays the one place this plan's decisions about a
manager's face, name, and standing in a league live.

## Where identity renders

Every call site in the product that names or pictures a manager, found by reading every room a
signed-in user can be in — chat, the draft room (both the live room and the TV board), the league
room, and the app shell — not by grepping for one string, since "team name only" and "no face at
all" are both invisible to a text search for `Avatar`.

| Surface | File | Before | After |
|---|---|---|---|
| App header | `src/components/app-shell/app-header.tsx` | name only | face + name, links to the profile (Task 2) |
| Chat message | `src/chat-room/components/message-list.tsx:51` | face + team name | unchanged, now ref-aware (Task 1) |
| TV board spotlight | `src/draft-room/components/tv-board.tsx:67` | face + owner badge | unchanged, now ref-aware (Task 1) |
| Draft board seat header | `src/draft-room/components/draft-board.tsx:249` | team name only | **unchanged, deliberately** (ruling below) |
| Room rail, whose turn | `src/draft-room/components/room-rail.tsx:183` | team name only | face beside the name |
| Standings row | `src/league-room/components/standings-table.tsx:50` | team name only | face beside the name |
| League members | *did not exist* | nothing | new panel (`LeagueMembersPanel`), with the commissioner marked |
| Review row | `src/account-room/components/review-feed.tsx` | *did not exist* | face + display name beside each review, via `Avatar` and `ReviewView.authorAvatar`/`authorName` (Task 9) |

## Ruling: the draft board's seat headers stay text-only

The draft board is a dense grid — every team is a column, every pick is a cell, and the header row
is the one place all of them are visible at once. A face per column earns its keep in the rail
(one identity, stated once, at masthead scale) and in the TV spotlight (one identity, the whole
point of the screen). It does not earn its keep repeated across a dozen narrow columns competing
with the pick history underneath them: that is the one place in this product where identity costs
more legibility than it returns. The rail directly above the board already carries the face for
whoever the grid's current column belongs to, so the fact is never actually missing from the
screen — it just has one home instead of two.

## Ruling: a league's members list belongs to every member, not to the commissioner

Before this task, a league had no members list at all: the only way to learn who was in a league,
or who ran it, was to recognize names scattered across standings, chat, and the invite panel — and
none of those said which manager was the commissioner. `LeagueMembersPanel` states that as a fact
about the league to every member who opens it, not as something inferred from which controls a
particular viewer happens to see. This is the deliberate contrast with the public-browse contract
(Task 6): browsing leagues before joining one stays commissioner-blind by design, because a
stranger evaluating a league has no standing to know who runs it yet. A member of the league has
already crossed that line — naming the commissioner inside the room is the point.

An unfilled seat renders as an open seat, never as an absent person: `LeagueMembersPanel` reports
"N seats still open" from `teamCount` rather than rendering nothing for a slot nobody has filled,
because those are different facts to a commissioner deciding whether to send another invite.

## Query-count discipline

`leagueHome` (`src/league-service/read.ts`) already read the team-plus-owner join once, through
`listTeamCards`, before this task — the standings table's face and the members panel's roster both
read the SAME rows rather than each re-querying `teams`/`users`. `leagueStandings`
(`src/league-service/results.ts`) took its own `teams` query out entirely in favor of the rows its
caller already had, which is a net reduction in `leagueHome`'s query count, not merely a wash.

## Ruling: `ownerUserId` on the members wire, not a server-computed `isCommissioner` boolean

`LeagueMemberCard` (`src/league-room/contract.ts`) carries each member's raw `ownerUserId`
alongside `LeagueHomeBody.commissionerUserId`, and `LeagueMembersPanel` does the
`team.ownerUserId === commissionerUserId` comparison itself, client-side.

The alternative considered was narrower: have `leagueHome` compute an `isCommissioner: boolean`
per member server-side and never put a raw user id on the wire at all — the more conservative
shape for a DTO that, per `TeamCard`'s own docblock, promises "no secrets, nothing a leaguemate
should not see." That shape was rejected for two reasons. First, it doesn't fit the panel's own
required signature — `LeagueMembersPanel({ teams, commissionerUserId, myTeamId })` — which this
task's brief specified verbatim; a component that takes `commissionerUserId` needs something on
each row to compare it against. Second, there is already a precedent for a raw user id on a
members-only wire: `ChatMessageView.authorUserId` (`src/chat-room/contract.ts`) has been on the
league chat's payload since Phase 1, read by `MessageList` to decide whose message is "mine." An
opaque WorkOS id string is not the kind of secret the DTO promise is about — it identifies a
person only to someone who already has the roster of names sitting right next to it, which is
exactly what this panel already reveals.

The boundary this ruling depends on: `ownerUserId` reaches this wire ONLY through
`LeagueHomeBody`, the members-only league-home payload. It is not on `TeamCard` itself (the type
`listTeamCards`, the draft room, and the TV board all still use), so nothing outside a league a
user has already joined ever sees a member's raw id. Task 6's public-browse contract, which stays
commissioner-blind by design, is unaffected — it never touches `LeagueHomeBody` at all.

## The invite preview is unauthenticated, and what that discloses (Task 7)

`GET /api/invites/[code]` answers without a session. The invite code itself is the credential:
codes are 8 characters over a 31-symbol alphabet from a CSPRNG, roughly 40 bits, and have been
the sole thing standing between a stranger and league MEMBERSHIP via `acceptInvite` since
Phase 1. A preview that reveals less than the join it precedes cannot be the weak point of the
pair. The IP rate limiter on the route is a speed bump against enumeration, not the defense;
the code space is.

What a code holder sees before holding an account: the league's name, format, size and open
seats, scoring label, stake tier with the standard disclosure, and the commissioner's display
name. The commissioner's name is the deliberate part. The public `/browse` contract stays
commissioner-blind by design (the Task 3 entry above), but an invite is a personally-sent
offer, and the person deciding whether to accept it has standing a browsing stranger lacks:
they are being asked to hand this specific person their entry fee. Naming the host on the
invitation is the trust surface working as intended, not a leak.

The non-oracle discipline (plan ruling 22): a wrong, expired, or exhausted code returns only
`{ ok: false, reason }`, and the failing paths never read a league row, so a probe cannot
distinguish a league that exists from one that never did by shape, and not meaningfully by
timing. This is asserted by `invitePreview`'s tests, not just described here.

## The avatar ref scheme (Task 1, Task 2)

`users.avatar_url` stays one column, but after this plan it holds an **avatar ref**, not
necessarily a URL. `parseAvatarRef` (`src/identity/avatars.ts`) is the one function that decides
which of three things a stored value is:

1. **`preset:<key>`** — one of eight built-in presets (`AVATAR_PRESETS`), each an `IconName` plus
   a token pigment (`AvatarTone`). A preset costs no object store, no CDN and no upload pipeline;
   it is code, the same way a `PositionBadge` sticker is code. Eight, not thirty, because a picker
   a manager can scan in one glance beats a wall they scroll past.
2. **An `https://` URL** — what WorkOS supplied at sign-up, before this plan the only thing the
   column ever held.
3. **Anything else** (`null`, empty, an unrecognized preset key, `javascript:`, `data:`, a bare
   `http:` URL, a protocol-relative `//…`) — renders as **initials**, never an error and never a
   broken image. `Avatar` always has a `name` to fall back to, so "we don't know what this is" and
   "this person hasn't chosen" produce the same, perfectly fine, face.

**Only `https://` is ever handed to an `<img src>`.** Before this plan the column was written
exclusively by WorkOS, so nobody had to think about it as attacker-controlled. Task 2 makes it
user-writable through `PATCH /api/profile`, which turns an unvalidated avatar URL into the
shortest path from a text field to script execution in every other manager's browser.
`avatars.test.ts` names `javascript:`, `data:`, a bare `http:` and a protocol-relative URL
individually, rather than trusting a regex the reader has to verify by eye. The write path itself
closes the same door a second way (ruling 5, below): `updateProfile` never accepts a URL from a
request body at all, only a preset key, so there is no code path today from client input to
`avatarUrl` holding anything but a preset ref or `undefined` (leave-alone). The `https://` render
guard is what keeps a *future* writer — Plan D's upload handler, or a WorkOS profile picture that
changes shape — from becoming an injection surface just by writing to the same column.

**Turning on uploads costs no new `AvatarRef` case**, by design (ruling 4 in the plan): the
`remote` case (`{ kind: "remote", url }`) already exists and already renders — it's how a
WorkOS-supplied picture displays today. `IDENTITY_CONFIG.avatar.uploads` in `src/identity/
config.ts` is `false` and unread by anything yet, the flag reserved for exactly this: Plan D's
upload handler mints its own `https://` URL from whatever bucket it writes to, stores it the same
way `updateProfile` already stores one, and gates the profile form's new upload control on that
one flag. No schema change, no new column, no precedence rule between two sources of one face —
the ref vocabulary already has room for it.

## Where identity renders

See the audit table at the top of this document — Task 3 wrote it before this plan's later tasks
built the rows it named, and each row above is now checked off against what actually shipped: the
app header, chat, the TV board, the room rail, the standings row, the league members panel and the
review row all carry a face today. The draft board's seat headers are the one deliberate
exception, ruled on above: the densest grid in the product, where a face per column would cost the
scan speed the board exists for, with the fact never actually missing from the screen because the
rail directly above the board already carries it for whichever column is on the clock.

## The preferences row

`user_preferences` (`drizzle/0015_user_preferences.sql`) holds exactly two fields beyond its key:
`helpLevel` and `draftTourDismissedAt`. The rule that produced that shape, not a longer one: **a
preference this product cannot honor does not ship as a control.** `helpLevel` is read in two
places — `firstRunPlan`'s `showsExplainer` and `InfoTip`'s inline glossary line — and
`draftTourDismissedAt` is read in one, `RoomTour`'s once-only gate. Every field in this row has a
reader before it has a row. The alternative this rejects is a preferences table shaped like a
settings-page wishlist — a notification toggle, a theme override already served by
`ThemeProvider`, anything else a designer might imagine wanting — each of which is a migration
written for a feature nobody has specified, and (per the notification catalog below) a control
that would visibly do nothing.

`draftTourDismissedAt` is a timestamp, not a boolean, for the same reason a `Clock`-injected ISO
string beats `Date.now()` everywhere else in this codebase: same storage cost, strictly more
information, and Phase 3's integrity work wants to correlate behavior against time. A boolean
would have to be widened later, which is a migration to avoid one character today.

The row is **self-sufficient** rather than provisioned at sign-up: `readPreferences` and
`updatePreferences` (`src/identity-service/preferences.ts`) both call the same `seedIfMissing`
before they read or write, seeded from `defaultPreferences({ experienceTier })`
(`src/identity/preferences.ts`) — the column default (`guided`) is a floor, not the answer, and
the real default is computed from what the user already told us about themselves. `ON CONFLICT DO
NOTHING` makes two concurrent first touches for the same user race safely: whichever insert loses
does nothing, and both callers go on to see the one row that won. A bare `PATCH /api/preferences`
from a user who has never opened anything that calls `readPreferences` first still succeeds, never
a 500 on a missing row — seed and write happen inside the same transaction, so a concurrent reader
never observes one without the other.

## The notification catalog and the deliverable seam

The spec did not ask for a notification-preferences surface at all; naming email as Plan D's arrived
by way of the plan brief. Building a stored preference for a channel with no sender would be a
switch wired to nothing that the user believes does something, which the no-MVP directive rules
out. So the **model** ships in full and the **surface** describes rather than promises:

- `NOTIFICATION_CATALOG` (`src/identity/notifications.ts`) is four topics in plain language — your
  turn to pick, your draft starting, your scores moving, your league talking — each naming the
  real `RealtimeEventType`s that fire it. `notifications.test.ts` checks the catalog against
  `REALTIME_EVENT_TYPES`, the runtime array `src/lib/realtime/events.ts` now exports alongside its
  type (ruling 21), so a topic can never describe a notification the product doesn't actually
  publish.
- `NotificationChannel` is `"in_app" | "email"`, and `channelStatus()`/`deliverableChannels()` are
  the one place that says which of those is real today: `in_app` is `"live"` (the realtime stream
  already delivers it), `email` is `"not-connected"`. `deliverableChannels()` filters to just the
  live ones — nothing downstream is ever offered a channel that isn't in that list.
- `NotificationSummary` (`src/account-room/components/notification-summary.tsx`) renders the
  catalog as description, not controls, with one honest sentence about email and no toggle beside
  it.

**What Plan D changes, named exactly:** one array (`CHANNEL_STATUS.email` flips to `"live"` once a
sender exists), one column (an `email_notifications` preference, following the same seed-then-write
idiom `user_preferences` already establishes), and one section of the profile page (toggles appear
in `NotificationSummary`, which already exists and already renders the catalog it would toggle).
Nothing about the catalog, the channel union or `deliverableChannels()` needs to change shape when
that day comes — only the one map that says what is real.

## The first-run rule

**Guidance is ordering, never removal.** `firstRunPlan` (`src/identity/first-run.ts`) reorders the
same three paths — create, join, browse — for every manager; it never hides one. The copy table
(`PATH_COPY`) is fixed regardless of ordering, so whichever manager reads it, all three read the
same plain, active-voice sentence for the same key: `first-run.test.ts`'s "always returns the same
three keys, whichever order" and "always offers all three paths, whichever way it orders them"
pin this directly, over both `firstRunPathOrder` and `firstRunPlan`. The reasoning: `experienceTier`
is self-reported, unverified, and set by a control most users will never revisit. Hiding the create
form from someone who ticked "new to fantasy" and then came here to run their office league would
be a dead end produced by a guess, which "never a dead end" (`docs/design-system.md`) rules out on
its own. `firstRunPlan` returns `null` the moment `leagueCount > 0` — the fork is a first-run
surface, not a nag, and it disappears on its own rather than staying around unwanted.

## League terms

`leagueTerms` (`src/league/terms.ts`) is one pure function with exactly two callers: `invitePreview`,
read by a signed-out prospect deciding whether to join, and `leagueHome`, read by every member
after they have. Both render the SAME `LeagueTermsPanel` with the result, so a prospect and a
member can never be told two different things about the league they're both looking at —
`invites.test.ts` asserts this against one seeded league rather than trusting two independently
hand-typed expectations to agree. See `docs/league.md`'s "League terms" section for the full query
accounting and the panel's placement.

The stake disclosure is **read, not retyped**: `MATCHMAKING_CONFIG.stakeDisclosure` is the one
wording of "no entry fee is charged, no prize is paid," and both the terms panel and the browse
page render that same string rather than each carrying its own copy of the promise. Two hand-typed
copies of a legal-adjacent disclosure are two places they can drift out of agreement; one constant
referenced twice cannot.

## The review feed's moderation boundary

Moderation here is scoped to abuse, with three legs and a hard stop where Phase 3 takes over
(ruling 18): **report** is an in-product affordance (`POST /api/reviews/[reviewId]/report`,
idempotent on the `(review_id, reporter_user_id)` primary key — a second click from the same
reporter is confirmation, not a duplicate or an error) that produces a **signal**, not an action.
**Removal** is an **operator script**, `scripts/remove-review.ts` calling `removeReview`
(`src/review-service/reviews.ts`) — there is no admin role, no permission check and no admin UI
anywhere in this codebase, and building one here would mean building the thing Phase 3 already
plans to own, then reconciling two of them. **Removal is a stamp, never a delete**: the row keeps
its author, its text, who removed it, why, and when
(`removedAt`/`removedByUserId`/`removalReason`), which is exactly the shape Phase 3's audit log
will want to read. The no-re-stamp invariant is enforced in the `UPDATE`'s own `WHERE` clause
(`removed_at IS NULL`), not just in the script's pre-confirmation read, so two concurrent removal
attempts for the same review serialize on the row lock and the second's `UPDATE` matches zero rows
rather than silently overwriting the first operator's reason and timestamp.

**The feed itself is provably unfiltered on rating.** `feedQuery` (`src/review-service/reviews.ts`)
does not `SELECT` the `rating` column at all — not filtered out after the fact, never fetched.
Ordering, the one narrowing this query applies (`removed_at IS NULL`) and pagination all run with
zero knowledge that a rating column exists; `listReviews` attaches the number afterward, through a
separate `ratingsFor` lookup, purely for display. `reviews.test.ts` asserts this against
`feedQuery(db, {}).toSQL()` directly — a stronger claim than "we checked the output and no rating
was filtered," since the column is not present to filter on in the first place.

**Precisely where Phase 3 takes over:** everything past "here is a report, here is a removed row
with who/why/when." A queue to triage reports, a role that can act on one from inside the product,
an audit trail beyond the removal row itself, and rate-limit or reputation signals feeding
moderation decisions are all out of this plan's scope and into Phase 3's, by name.

## The GIF seam

`GifProvider` (`src/gifs/provider.ts`) is one method, `search(query, limit)`, proved against a
shared contract suite (`describeGifProviderContract`, `src/gifs/test-support.ts`) the same way
`StatsProvider` proves Tank01 — so a future Tenor adapter is another implementation of this
interface, not a rewrite of chat. `GifResult.alt` is required and never empty: an adapter whose
upstream result has no title synthesizes one from the search query, because a GIF in a chat log
with no alt text is a message a blind manager cannot read.

**Fixture discipline mirrors Tank01 exactly.** `createFixtureFetch` (`src/gifs/giphy/fixtures.ts`)
serves only the committed fixtures (`giphy/fixtures/manifest.json` + one file per recorded search)
and throws by name for anything unrecorded, so a test that would otherwise reach `api.giphy.com`
fails immediately instead of going to the network. Matching is on the search text (`q`) alone —
`limit`, `rating` and `api_key` are real params the adapter always sends, but they don't change
which fixture is the right answer.

**The unconfigured path is a real product state, not a stub.** `createGifProvider()`
(`src/gifs/registry.ts`) returns `null` for the default `GIF_PROVIDER=none`, and that `null` is
load-bearing: `ChatPageBody.gifSearchEnabled` is set from `createGifProvider() !== null` once per
page load, so the composer never renders a dead "Add a GIF" button and `GET /api/gifs/search` 404s
rather than serving an empty result grid that has to explain itself. An unrecognized provider name
still fails fast with a named error, matching `src/stats/registry.ts` — a typo in a deploy's env is
a misconfiguration to shout about, never a feature to silently lose.

**The rating ceiling** is a request param, not a client-side filter: `GIPHY_CONFIG.rating` is
`"pg-13"`, sent on every search so upstream is asked to never offer an unrated result in the first
place, rather than trusting this adapter to filter one out after the fact. An unrated GIF search in
a league chat is a moderation surface this phase has no answer for — the same reasoning
`CHAT_CONFIG`'s closed reaction set already documents for emoji.

**A GIF rides `chat.message`; `chat.gif` was not added, contradicting the spec's task list**
(plan ruling 17). A GIF is a message: it occupies one row in `chat_messages`
(`0017_chat_message_gifs.sql`'s five nullable columns), delivered by the same frame carrying the
same `ChatMessageView`, with the client already folding it. A second event type would mean two
publish paths and two client folds for one write — the shape that lets two renderings of one thing
drift. `ChatMessageView.gif` (`src/chat/contract.ts`) is `null` for an ordinary text message and
populated alongside `body` (which carries the GIF's alt text as a text fallback) otherwise.
Migration `0018` (`drizzle/0018_chat_messages_covering_index.sql`) widened
`chat_messages_league_id_idx` with `INCLUDE (body)` because `0017`'s six new nullable columns were, on the corpus size
`src/db/index-plans.test.ts` proves against, enough to flip the planner off that index and onto a
full `chat_messages_pkey` scan for every league's paginated chat read. `drizzle-orm`'s `index()`
builder has no way to express an `INCLUDE` clause, so the migration is hand-written, and
`index-plans.test.ts` guards the fact structurally — reading `indexdef` back from `pg_indexes`
rather than trusting the migration file's SQL to still be what's actually on disk.

**Voice messages are deferred, with the resource they need named** (plan ruling 19, matching how
Plan A recorded its Tank01 key deferral): client-recorded audio needs an object store and a CDN in
front of it to serve it back, both of which the Phase 2 overview assigns to Plan D by name
("Step 16's voice messages need the same object store plus the CDN in front of it"). Neither exists
in this codebase today, so neither `chat.voice` nor a voice composer is built here.

## Status

Task 3's rows above are satisfied, and the full identity/trust surface area this plan set out to
build is now built: the avatar ref scheme, the profile write path, first-run guidance, the
preferences row, the notification catalog, league terms on both its surfaces, the review feed with
its moderation boundary, and the GIF seam. `LeagueMembersPanel`'s persona-panel pass (Task 3's Step
5) and every other user-facing surface this plan touched each ran their own marked persona-panel
step (Tasks 3, 5, 6, 8, 9, 10) rather than deferring the review to this closing section.

**Residuals carried into the ledger**, honestly summarized rather than silently dropped, for
whichever plan picks them up next:

- **Moderation surface question.** This plan's review-removal path is report-plus-operator-script
  with no admin role (ruling 18, above). Phase 3 owns building an actual moderation surface —
  a triage queue, a role, an audit trail beyond the removal row — and this plan deliberately did
  not build a smaller version of it first.
- **Chat has no removal path at all**, and that is a larger gap than the review one above. A
  posted message or GIF in a league chat cannot be deleted, hidden or reported by anyone: not its
  author, not the commissioner, not the operator. `src/chat-service` has no delete, no hide and no
  report; ruling 18 forbids the role that would own one. This plan opened the higher-volume
  user-content surface (an open GIF search, whose rating ceiling is the engineering default noted
  above) without the removal path the lower-volume one got, and says so here rather than leaving it
  to be discovered in a real league. Phase 3's moderation surface owns chat, not just reviews.
- **A removed review's author is told, and told the operator's own words.** `myReview` reports the
  removed state and `ReviewComposer` renders it instead of an editable form, because the
  alternative — letting them edit into a write `submitReview` refuses at the database — is a
  silent shadow-ban. The consequence to keep in mind: `--reason` in `scripts/remove-review.ts` is
  author-facing copy, not an internal note. What this still does not have is an appeal path.
- **The PG-13 founder question.** `GIPHY_CONFIG.rating: "pg-13"` is an engineering default, not a
  founder-reviewed content policy. Whether that's the right ceiling for a real-money product with
  real leagues talking in real chat rooms is a product decision nobody with the authority to make
  it has weighed in on yet.
- **A verified-played-here signal.** Every review is gated on `withCurrentUser` (a valid session),
  but nothing checks that the reviewer has actually played a season on this product — the review feed cannot yet
  distinguish "a manager who fielded a team here" from "a signed-in account." A "verified" badge
  needs a definition of what verification means (one league completed? one season scored?) that
  this plan did not receive.
- **Activity cues on member avatars**, raised while building `LeagueMembersPanel` (Task 3's panel)
  and not built: an online/last-active indicator beside a member's face. Deferred for the same
  reason voice messages were — no realtime presence channel exists yet, and this plan's realtime
  taxonomy stayed closed rather than growing one for a feature not in scope.
- **Custom avatar upload** (ruling 4) and **email notification delivery** (ruling 11) are Plan D's,
  each carved out with the exact one-line change this document names above them.
