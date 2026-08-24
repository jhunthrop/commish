# Backend gaps backlog — Phase 3.6 closeout (Task A22)

**Nothing in this file is implemented in Phase 3.6.** That is the file's contract, not an
apology: the founder's directive had two halves — leverage every backend capability that exists
(Tasks 15 to 21 did that), and flag every capability a persona reached for that does not exist
(this file is that). Building anything below is a later phase with the founder's name on the
priority order (addendum ruling 38).

This is a list of things we now know we need to build, each found by a persona walking the real
product — not a list of things that went wrong. Severity is about the **person**, not the build
cost (Task 22 Step 1's definition):

- **HIGH** — somebody cannot do a thing the product implies they can.
- **MEDIUM** — a real want with an honest workaround.
- **LOW** — a nice-to-have.

Sources swept: the Task 15 inventory's unassigned GAP rows; every panel's backend-gap flags from
Tasks 16 to 21; the parent plan's persona gauntlet (Task 14 Step 5) as banked for A22; the
addendum's D13–D17 deferred rows; and the extended whole-site gauntlet run for this closeout
(Task 22 Step 2, recorded in `.superpowers/sdd/2026-08-23-phase3p6-addendum-whole-site/task-22-report.md`).

**One flag deliberately struck, do not re-add:** Task 17's panel originally flagged
"`experienceTier` and `helpLevel` are decoupled — my experience answer should set my help level
too." That is factually false: `updateProfile` calls `applyTierDefaultHelpLevel` in the same
transaction (`src/identity-service/profile.ts`), `profile.test.ts` pins it, and the profile
page's own Preferences hint states the coupling. The A17 review proved it and the report was
corrected; this file records the strike so the phantom never resurfaces.

## The backlog

| # | The gap, in the persona's words | Persona | Severity | Suggested owner phase | What exists today |
|---|---|---|---|---|---|
| 1 | "I want to read a notice from last month, not just my last twenty." | The manager auditing what the product told them (A15 inventory; A18 account room) | HIGH | Next service phase touching `integrity-service` (promotable sooner by the founder, per addendum ruling 5) | `listNotices` returns the newest `INTEGRITY_CONFIG.notices.inboxSize` (20) and takes no cursor. `NoticeInbox` states the cap honestly ("Your last 20 notices."). D13: a history page over a read that cannot page would be copy without a mechanism. |
| 2 | "I used a throwaway email to poke around — now I want to change the email I sign in with to my real one." | The skeptic who read before signing up (A16); the privacy-minded manager (A18) | HIGH | Phase 4 gate (account operations become legally load-bearing when money lands) | The account page renders the email as text and says plainly Commish cannot change it here; WorkOS supports email change, nothing in `src` calls it (D14). |
| 3 | "I want to raise a question about a trade, a draft, or another manager — not just about a review or a chat message." | The member with a dispute (A15 inventory; A21 complaint-seeker) | HIGH | Phase 4 (a real-money dispute needs a real intake) | `raiseFlag` is reachable only through `reportReview` and `reportMessage`. `/support` names those two paths honestly and implies no third (D15). Severity: the brief's Step 1 seeds this HIGH; D15's own row said MEDIUM — the person-centred definition wins, because a member disputing a trade in a product about to take money has no honest workaround at all. |
| 4 | "If I do not like this after all, I want to delete my account cleanly — not just walk away and wonder if my data is still here." | The seat-hold visitor mid-signup (A16); the privacy skeptic (A18) | MEDIUM, becomes HIGH the day money lands | Phase 4 (needs the data policy nobody has written — D14) | No deletion path anywhere in `src`. The account page and `/support` imply nothing to the contrary. |
| 5 | "I want to see which devices are signed into my account, and sign out everywhere at once." | The returning manager on a new device (A16); the real-money first-timer (A16); A18's session row | MEDIUM | Phase 4 gate (session hygiene before money) | `signOut()` clears only the calling browser's cookie. WorkOS session listing is not surfaced anywhere (D14). |
| 6 | "This is about to be a real-money product — where do I turn on MFA?" | The privacy-minded skeptic (A18, via D14) | MEDIUM | Phase 4 gate | MFA is a WorkOS AuthKit capability, live on the hosted screen if the dashboard enables it; no in-product surface names or links it (D14; the dashboard half is `docs/decisions/auth-front-door.md`'s runbook). |
| 7 | "I want to export my data." | The privacy-minded skeptic (A18) | MEDIUM | Phase 4 (same data-policy work as deletion) | Nothing. The privacy page promises the page will grow into a fuller policy, and does not promise export. |
| 8 | "Mute one league's notices. Turn one topic off." | The manager in many leagues (A18) | MEDIUM | Notification phase (same work item as #17's channels) | `NotificationSummary` is deliberately control-free because no preference write exists — a switch would lie. All notice topics are on, in-app only, for every league. |
| 9 | "Who moderates a house league? A member league shows me its commissioner; this shows nobody." | The house-league member (A15 inventory) | MEDIUM | An authority-decision phase (D16: who is entitled is a founder-level authority call) | `leagueModerationSummary` is commissioner-gated and a house league has no commissioner. The members panel states "Run by Commish" honestly. |
| 10 | "My invite expired — I want to ask the commissioner for a new one from right here." | The friend holding a dead invite link (A20) | MEDIUM | League-service phase | The expired/exhausted landing offers "Browse open leagues" — a real door, but not the one asked for. No request-an-invite write path exists. |
| 11 | "I want to see who else is in the league before I join." | The invited friend (A20) | MEDIUM — and a decision, not just a build | Founder decision first, then league-service | The terms panel names the commissioner only. The privacy page promises strangers "never a name of anyone already in it" — this want collides with a recorded privacy stance and needs a ruling before code. |
| 12 | "I filed a report. Did anything happen?" — status visibility, an outcome notice, a way for the operator to reach me | The complaint-seeker (A21 flags 2 and 4); the operator wanting to message a reporter (A19 flag 5) | MEDIUM | Operator-tooling phase | `resolveFlag`'s notices reach the person the decision is about; the reporter gets nothing after the immediate 200. `/support` states all of this honestly. One backend (a report thread) closes all three flags. |
| 13 | "I want to contact an operator directly, about something that is not a review or a chat message." | The complaint-seeker (A21 flag 1) | MEDIUM | Operator-tooling phase (overlaps #3's intake) | No message-the-operator surface. `/support` names the two report paths as the only ones. |
| 14 | "I decided this flag wrong and I want to take it back." | The operator at 11pm (A19 flag 3) | MEDIUM | Operator-tooling phase | `ResolutionForm` says "This cannot be taken back." and means it — a wrong decision today is database surgery. The audit chain supports recording a reversal; no write path exposes one. |
| 15 | "Show me this member's history across flags." | The operator judging a repeat offender (A19 flag 2) | MEDIUM | Operator-tooling phase | Each flag's detail page stands alone; the operator opens flags one at a time. The data exists in `integrity_flags`; no cross-flag read exists. |
| 16 | "I want my league and its history imported from the platform I am leaving." | The veteran migrating (A17 flag 1; the parent gauntlet's veteran) | MEDIUM | Growth phase | Nothing. Every league starts empty on Commish. |
| 17 | "Email me the invite. Push me a notice when my room fills. Nothing reaches my phone." | The inviting commissioner (A17 flag 2; parent gauntlet commissioner); the phone user (parent gauntlet, D12) | MEDIUM | Founder-gated (email/push infrastructure spend) | In-app notices only. The profile page says "Email updates are not connected yet. When they are, you will choose which of these arrive in your inbox." — a promise with a named future, which is the honest shape, but the future is not built. |
| 18 | "I want a practice draft before a real one." | The first-timer (A17 flag 3; parent D5, second hit) | MEDIUM | Draft-room phase | `RoomTour` ("Preview the room") ships as the D5 stand-in — a look, not a rehearsal. |
| 19 | "Where are my bench points? I want to know I left 40 on the bench, not just that I lost." | The veteran (parent gauntlet, D9) | MEDIUM | Stats phase | Starters-only totals everywhere. Bench stats exist per-player; no aggregate is computed or shown. |
| 20 | "I have the same guy in two leagues and I just benched him in one. Nothing here tells me." | The veteran (parent gauntlet, D10) | MEDIUM | Stats/insight phase | No cross-league read exists. The parent gauntlet called this "the standout premium feature" candidate. |
| 21 | "Nothing projects. Everything here is what already happened." — projections, injury tags, win probability | The veteran and the casual (parent gauntlet, D1/D2/D3/D7) | MEDIUM | Insight phase, gated on a methodology the skeptic can be shown | Deliberately absent rather than faked — the strongest trust work in the phase. Any build here must keep the no-fabricated-figures rule. |
| 22 | "There is no settings page. I named it and picked the format and now it is frozen." | The commissioner-curious (parent gauntlet; ruling 15's stated dead-end) | MEDIUM | League-service phase (needs a which-settings-when-mutable ruling) | League settings are written once at creation. No edit surface, no rename, no scoring change — only the draft time is editable. |
| 23 | "Money is mentioned once, on the front door, and stake tiers are labels. I want to know what happens when it is not free." | The skeptic (parent gauntlet; P5 legal-entity flag) | MEDIUM | Phase 4 (the whole phase is this row) | "Every league is free this season." and "Stake tiers are labels only in this preview. No money changes hands." — both true, both temporary. The legal entity, terms and money mechanics are Phase 4's charter. |
| 24 | "Search the queue." | The operator, later, at volume (A19 flag 1) | LOW today, MEDIUM at volume | Operator-tooling phase | Four flags today; the operator scans. `listPendingFlags` has no filter or search parameter. |
| 25 | "Hand this flag to another operator." | The future second operator (A19 flag 4) | LOW (there is one operator) | Operator-tooling phase | No assignment concept exists on `integrity_flags`. |
| 26 | "Is the platform down, or is it me?" — an incident/status page | The complaint-seeker (A21 flag 3) | LOW | Ops phase | Nothing names a platform-wide state to a visitor. |
| 27 | "Show me chain-verification health from the console, not a terminal." | The operator (A15 inventory; A19 flag 6; D17) | LOW | Operator-tooling phase | `verifyAllChains` has a real operator surface — the npm script (`npm run audit:verify`). A page needs its own authz and failure design (D17). |
| 28 | "Let me search reviews for the thing I care about." | The skeptic reading reviews (A20 flag 3) | LOW | Review phase, carefully | D20 refuses rating sort/filter to protect the unfiltered claim; A20's panel argues full-text search is a different axis. That argument needs its own ruling before any build. |
| 29 | "It just says I am signed out — I want to know why, so I know whether to worry." | The manager whose session died mid-draft (A16 persona 5) | LOW | Auth polish pass | `fetchWithSessionWatch` distinguishes read vs write, never a cause; no reason code reaches the client. |
| 30 | "This card says Auction and never tells me the budget." | The veteran reading the shelf (P5 flag, confirmed in the Step 2 walk) | LOW | Lobby polish pass | `auctionBudget` exists on the league and in the create form; `OpenLeagueCard` does not render it. |

## Recorded decisions that are deliberately not backlog rows

Per Task 22 Step 1's rule, deferred items became rows above; **refused** items are decisions,
recorded here so a persona's flag is answered rather than silently dropped:

- **D18 — branding the hosted AuthKit screen from code**: refused because the installed SDK has
  no such lever; it is the dashboard runbook in `docs/decisions/auth-front-door.md`.
- **D19 — per-page loading skeletons**: refused (ruling 31) — a second copy of every page's
  layout, maintained by nobody. `AppShellSkeleton`'s three shapes are the whole strategy.
- **D20 — a rating summary, sort or filter on `/reviews`**: refused (A4, ruling 33) — it would
  falsify the founder's own claim about the surface. Row 28 records the one adjacent axis
  (search) that still needs its own ruling.
- **D21 — reply-to-a-review, helpful votes, reviewer verification detail**: refused for this
  phase — each is a new write path and a new moderation surface on the one page whose value is
  that it is not moderated into a shape. A20's panel flags ("reply to a review", "verify a
  reviewer actually played") are answered by this refusal, not lost; if a later phase reopens
  them it reopens D21 by name.
- **D6 / parent ruling 19 — per-manager history tags in a room list**: refused (privacy).
  `StandingPanel` shows a person their own standing instead (ruling 30), and row 11 records the
  one adjacent want still needing a ruling.
- **D11 — waivers, trade deadline, keepers on the card**: refused for this phase — a card field
  for an absent feature is a lie with a label on it. `/league-rules` states the absence in prose.

## Engineering carries (not persona gaps, kept from being lost)

Flagged by implementers during the phase, owned by whoever next touches each seam:

- `listPublicLeagues` is uncached and now feeds two public pages (`/` and `/browse`) — P5 flag;
  the proof-stats strip already established the Redis `ReferenceCache` idiom to copy.
- `LeagueTerms.playoffWeeks` is a shared constant today; it must become per-row the day
  per-league playoff configuration ships — P5 flag.
- `describeStartTiming`'s extension contract (its docblock) binds any new start-timing surface
  to extend that one authority rather than compose a second sentence — P5/P7 carry.
- The deploy-era runbook note for the P7 roll: a database carrying stale-replaced house leagues
  at P7's arrival overshoots shelf width once; harmless and self-healing, or trim empty extras
  (ledger, checkpoint diagnosis).
- The e2e suite needs its own database (separate-e2e-database chore, filed in the ledger) — the
  shared dev DB is the root of every concurrent-lane test-noise incident this phase logged.
