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
| Review row | *does not exist* | nothing | Task 9 |

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

## Status

Task 3's rows above are satisfied. `LeagueMembersPanel`'s persona-panel pass (this task's Step 5)
is deferred to the controller step outside this task's scope. Task 9's review-row and Task 11's
closing summary append below when they land.
