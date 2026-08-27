# Journey review: the first-timer

**Persona:** "Maya", 29. Has never played fantasy football. A coworker mentioned it. Smart, busy, mildly intimidated by sports jargon, on a laptop at lunch. Does not know what PPR, flex, waivers, snake, or ADP mean. Will not read paragraphs. Bails when confused.

**Date:** 2026-08-27 · **Build:** `worktree-ive-campaign` @ `localhost:3102` · **Viewport:** 1440x900, dark

This is a journey review, not a screen review. The question is not whether a page looks good. The question is whether a person who knows nothing can start at the front door, understand what this is, decide to commit, get somewhere useful, leave, and come back.

---

## Method

Driven with Playwright (`node_modules/playwright`), 1440x900, `colorScheme: dark`, throwaway scripts under the session scratchpad, screenshot at every step. Started signed out at `/` with no knowledge of internal routes; every navigation below came from something visible on the screen. Sign-in used `e2e/.auth/manager-zero.json` (a zero-history identity) to continue past the auth wall. No source edits. One house league was joined (`house_beginner_12_4`, platform-run, auto-replenishing); nothing seeded was deleted or modified.

### The actual click path

**Signed out**

1. `/` — the front door
2. press an ⓘ next to "Snake" — read the plain answer
3. nav → **How it works** → `/league-rules`
4. no way back except the **Commish** wordmark → `/`
5. hero → **Try a mock draft** → *off-site*: `spirited-tranquility-94-staging.authkit.app/sign-up` — **wall #1**
6. browser back → `/` → nav → **Open leagues** → `/browse`
7. filter tab → **Newer players** → `/browse?experienceTier=beginner`
8. **Take a seat** on Beginner 12-team League 4 → *off-site*: `…authkit.app/` sign-in — **wall #2**
9. (separately) nav → **Reviews** → `/reviews`; footer → **Support** → `/support`

**Signed in** (session injected at the point wall #2 interrupted her)

10. `/` — still shows "Sign in", no route to her account
11. → `/browse` → **Join** → lands directly in `/app/leagues/house_beginner_12_4`
12. rail tile **B1** → `/app` — the get-started hub
13. **Preview the room** → the "How this room works" modal
14. **Run a mock draft** → dropped straight into a live draft, on the clock, `0:57`
15. `/app/mock-drafts` — the lobby page step 14 skipped
16. bell **11** → notice panel

---

## The walk

### 1. The front door (`/`)

**What she is looking for:** what is this, is it for me, does it cost anything.

The page answers the third question well and immediately: *"Every league is free this season."* in green, and every row in the table says **Entry: Free**. Cost is not something she has to hunt for. Good.

It does not answer the first two. The headline is *"Real leagues. Real seats. Drafting this week."* — every word of that assumes she already knows what a fantasy league is, what a seat is, and why drafting this week matters. The subhead is *"Season-long fantasy football with a live draft room, real-time scoring, and a platform that runs the league so no brother-in-law has to."* The brother-in-law joke is a joke for people who have already played. She reads "draft room" and does not know what a draft is.

> *"Okay. Real seats for what, exactly."*

Two things she notices and likes: **"New to these terms? Press any ⓘ for a plain answer."** and a league literally called **Beginner 12-team League 4** tagged *newer players only*. She presses the ⓘ next to "Snake" and gets a genuinely good, plain sentence about picks reversing each round. Whoever wrote the glossary wrote it for her.

Two things that damage the page badly. The ticker at the top loops the same line — *"A seat was claimed in The Longshot League 5 · 11 minutes ago"* — roughly ten times in a single pass, always the same league, always the same "11 minutes ago". And a third of the league table is test garbage: **E2E Money Dark 1787678163994**, **E2E Money Dark 1787678273444**, and fifteen more. She is not a QA engineer. She sees a storefront where the products are named after database rows, and one of them says "Money Dark" directly under a promise that everything is free.

> *"Is this a real company?"*

**Can she get back:** n/a, she is home. **Jargon with nothing in reach:** mock draft, draft room, season-long, stake tier, "Competitive"/"Friendly" badges, "Entry". Jargon that *is* explained: snake, PPR, Half PPR, sit-and-go, house league.

### 2. "How it works" (`/league-rules`)

**What she is looking for:** how it works.

**What the screen offers:** five dense paragraphs of format vocabulary, then a glossary. The first sentence is *"Every league on Commish drafts either snake or auction."* By paragraph three she is reading *"A superflex league adds a second flex-like spot that also accepts a quarterback"* and *"the league's median score that week counts as a second win, loss, or tie."* Paragraph five tells her what the product cannot do: no waiver wire, no trade deadline, no keeper or dynasty formats.

This page is a rules reference filed under a discovery label. It never says what fantasy football is, what a season looks like, or what she would actually do on a Tuesday. It answers questions she has not earned yet.

> *"I asked how it works and got a rulebook. Also I don't know what any of these words mean and it just told me three of them don't work."*

**Can she get back:** barely. The header collapses to the **Commish** wordmark and **Sign in** — Open leagues, How it works, Reviews and the Take a seat button are all gone. There is no back link, no next step, no CTA of any kind. The page is a cul-de-sac.

### 3. "Try a mock draft" — wall #1

Back on `/`, the most inviting thing on the page is the hero button **Try a mock draft**. It sits eight pixels under the line **"No account is needed to look."** The word *try* is a promise.

One click and she is on `spirited-tranquility-94-staging.authkit.app`. Different domain. No Commish logo, no Commish type, no Commish anything. A card that says **Sign up** and asks for **First name**, **Last name**, **Email**. No mention of what she is signing up for, no mention that it is free, no way back — the page has no link to Commish at all, only "Already have an account? Sign in".

> *"I clicked try and it asked for my last name. On a website with 'staging' in the URL."*

This is the sharpest contradiction in the funnel: the one try-before-you-buy affordance is a signup wall wearing the word "Try", placed directly beneath a sentence saying no account is needed. In this build the `redirect_uri` also points at `localhost:3000` while the app serves on `3102`, so even a Maya who pushed through would land nowhere.

**Clicks to value here: zero. Value delivered: zero.**

### 4. Browsing (`/browse`)

She goes back and tries the safer-sounding nav item. `/browse` is the same table, longer: fifty rows, seventeen of them E2E. There are filter tabs — **All · Drafting soonest · Drafts when full · Newer players** — and *Newer players* is exactly right for her. She clicks it. Nine results. Five of the nine are E2E rows, and one (Prime Time Twelve 5) has no *newer players only* tag at all.

She wants to look at Beginner 12-team League 4 before she commits. She cannot. The league name is not a link. There is no league page for a signed-out visitor. The only clickable thing in the row is the commitment button. "No account is needed to look" is technically true and practically false: there is nothing to look at beyond one row of a table.

**Can she get back:** the header here is the app header — wordmark and Sign in only. "How it works" is not reachable from `/browse`.

### 5. "Take a seat" — wall #2

She clicks **Take a seat** on the beginner league. Instant hard redirect, off-domain again, to the same unbranded AuthKit page — this time a **Sign in** card. No interstitial. No "You are joining Beginner 12-team League 4." No seat held. Nothing on the page connects to anything she just did.

The homepage had promised, in three numbered steps: *1 · 10 seconds — Pick a seat — your seat holds for 10 minutes. 2 · 30 seconds — Sign in with email.* The real order is inverted. She signs in first, and nothing is held while she does it.

**This is where the wall interrupted her.** Everything above is the signed-out funnel, and in it she was never once told what fantasy football is.

### 6. Signed in, back at `/`

Session restored. She types the address again the way anyone would.

The homepage does not know she exists. Same marketing header, still showing **Sign in**, no avatar, no "Your leagues", no link to `/app` anywhere on the page. She clicks **Sign in** to fix it — and is thrown off-domain to the login form to type her email again.

> *"Did it log me out? Am I in the wrong place?"*

Recovering requires knowing to click **Open leagues** and then the **Commish** wordmark, which quietly changes destination from `/` to `/app` depending on which page you are standing on. Three header systems are in play: the marketing nav on `/`, the app nav on `/browse` and `/app`, and a wordmark-only nav on `/league-rules`, `/reviews` and `/support`.

### 7. Joining (`/app/leagues/house_beginner_12_4`)

From `/browse`, **Join** is one click and she is in. Fast, and it lands well: *"Beginner 12-team League 4 · You're in. You claimed seat 1 of 12 just now."*

Then it stops. She is 1 of 12. Draft: *"Starts as soon as it fills."* No date, no estimate, no "we will email you when it does", no way to invite anyone to help fill it. Every module below is empty: no matchup this week, a standings table with one row (her, 0-0), an empty chat, *"Your lineup appears here after the draft"*, and a Lineup advisor with nothing to advise on. The league facts panel does explain Snake and Half PPR inline, which is good — but then hands her `1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench` with no ⓘ at all.

The card at the top offers the one thing she needs: *"See how the draft room works. A quick look at the clock, the queue and how a pick actually happens, before it is your turn for real."* **It is not a link.** It is plain body text. There is no route to a draft-room preview anywhere on this page.

There is also no way to leave. No "leave league", no undo, nothing. She has committed to a season in one click with no visible exit.

> *"I'm in. Nothing is happening. When does it start? Can I get out of this?"*

### 8. `/app` — the page that should have been the homepage

The rail tile **B1** takes her to `/app`, and this is the best page on the site for her. It opens with the sentence the entire funnel was missing:

> *"A league is a group of managers who draft NFL players, then start the ones they think will score most each week. You play one other manager every week of the NFL season. Your team's score is whatever your starters do in their real games."*

That is the whole game in three sentences, in her language. It is behind the account.

Below it, four next-step cards. Two work (**Preview the room**, **See what you will hear about**); two are dead text (**Name your team**, **Rank your draft slots** — instructions with no affordance, the same pattern as the league page). Her one league is displayed as a large prominent card that is not clickable; the only route into it is the unlabeled two-character tile in the rail. That tile reads **B1**, while the league header reads **BE** and the welcome card reads **B4** — three monograms for one league.

**Preview the room** opens a modal — *The clock · The queue · Taking your turn · Practice anytime* — four short plain-English cards. It is the single best onboarding asset in the product. It is behind the account, behind a button, on a page she can only reach after joining a league.

### 9. "Run a mock draft"

She clicks it, expecting a practice room and a moment to get oriented.

She is dropped straight into a live draft. Round 1, Pick 3. **She is on the clock. 0:57.** No lobby, no settings, no "start when ready". An orange **Connecting…** pill sits in the header and does not resolve. The player pool she must choose from shows names clipped to a few characters — **Jah…**, **Bija…**, **Ce…**, **Ju…**, **Dra…** — sixty-one clipped text nodes on the page. She is being asked to pick, against a clock, from names she cannot read, with a number beside each one that is never explained.

The bottom coaching bar is good — *"Your pick. Take somebody from the pool. Star players in the pool to build your queue."* — and the top banner reassuring — *"This is a mock draft. Nothing here counts."* Neither survives the panic of a running clock.

**Can she get back:** no. The draft room header has zero navigation. No wordmark, no leave, no exit. Browser back is the only way out of the room.

Meanwhile `/app/mock-drafts`, the page the CTA skipped over, opens with exactly the sentence that would have calmed her: *"A mock draft is the real room against practice opponents. Free, nothing counts, done in minutes."*

### 10. Coming back

The mock is preserved (`Your mock drafts · Drafting now · Continue`), which is genuinely good. The bell shows **11**, and opening it shows eleven near-identical notices:

> *"We made your pick for you. The clock ran out on pick 179 in Practice draft, so we used your queue and drafted Kenny Harris (K). Set your queue before your next draft so this does not happen again."*

Eleven times. She does not know what a queue is. Timestamps read `8/26/2026, 12:56:28 PM`, in a product that everywhere else writes *Thursday 27 August, 4:22 PM UTC*.

### 11. The two pages she checks before trusting anyone

**Reviews** (a top-level nav item). One review on the entire site:

> **1 out of 5, poor** — *"This league ate my roster overnight and nobody ever explained why. Filed at 1787735299359."*

**Support.** *"Some things this platform does not offer yet: a way to contact an operator directly, a way to see the status of a report once you file it, an incident or status page, and an email once something reported gets fixed."*

A cautious person deciding whether to hand over her email reads: the only customer says the site ate his team, and there is no one to call.

---

## Findings

| id | severity | what happened | where | one-line fix |
|---|---|---|---|---|
| J01 | BLOCKER | "Try a mock draft" — the only try-before-signup CTA, placed directly under "No account is needed to look" — is a signup wall | `/` hero | Run the solo mock signed-out; ask for the account only to save the result |
| J02 | BLOCKER | Both walls dump her off-domain to unbranded `spirited-tranquility-94-staging.authkit.app` with no Commish branding, no statement of which league she is joining, and no link back | `/sign-in`, `/sign-up` | Brand the AuthKit page and pass the league context and a "back to Commish" link into it |
| J03 | BLOCKER | The Reviews nav item shows exactly one review: 1/5, "This league ate my roster overnight and nobody ever explained why. Filed at 1787735299359" | `/reviews` | Exclude test-authored reviews; do not ship the nav item until there is a real corpus |
| J04 | BLOCKER | 17 of 50 storefront rows are test data ("E2E Money Dark 1787678163994", "Mobile360 Hold League"); 5 of the 9 beginner-filtered results are E2E rows | `/`, `/browse` | Exclude e2e-named leagues from every public shelf |
| J05 | BLOCKER | "Run a mock draft" skips the lobby and drops her onto a live clock at 0:57 with no orientation and no way to leave the room | `/app` → `/app/drafts/:id` | Route the CTA to `/app/mock-drafts`, or add a start-when-ready gate |
| J06 | BLOCKER | The draft room header has no navigation at all — no wordmark, no leave, no exit | `/app/drafts/:id` | Add a persistent "Leave room" and Commish wordmark to the draft header |
| J07 | BLOCKER | `redirect_uri` is `localhost:3000` while the app serves on `3102`; completing signup in this build lands nowhere | auth config | Point the redirect at the running origin |
| J08 | FRICTION | "How it works" is a format rulebook: five dense paragraphs, never says what fantasy football is or what she would do each week, ends by listing what the product cannot do | `/league-rules` | Lead with the "a league is a group of managers…" explanation and the room modal; demote the glossary |
| J09 | FRICTION | The two assets that actually teach her — the league definition on `/app` and the "How this room works" modal — are both behind the account | `/app` | Surface both on the signed-out storefront |
| J10 | FRICTION | Three different headers: marketing nav on `/`, app nav on `/browse` and `/app`, wordmark-only on `/league-rules`, `/reviews`, `/support` | site-wide | One header, one nav model |
| J11 | FRICTION | Signed in, `/` still shows "Sign in" and offers no route to her leagues; clicking it throws her off-domain to log in again | `/` | Session-aware header with "Your leagues" |
| J12 | FRICTION | Nothing to look at before committing: league names are not links, no signed-out league page; the only affordance per row is the commitment button | `/`, `/browse` | Make the league name open a read-only preview |
| J13 | FRICTION | The hero promises "1 · Pick a seat — your seat holds for 10 minutes. 2 · Sign in." The real order is sign-in first and no hold is created | `/` hero | Hold the seat before auth, or change the copy |
| J14 | FRICTION | "See how the draft room works…" on the league page is dead body text; the identical words on `/app` are a working button | `/app/leagues/:id` | Wire it to the same modal |
| J15 | FRICTION | "Name your team" and "Rank your draft slots" next-step cards have no action link | `/app` | Wire both |
| J16 | FRICTION | After joining she is 1 of 12 with "Starts as soon as it fills" — no date, no estimate, no email promise, no invite link, every module empty | `/app/leagues/:id` | Add a "what happens next" block with a fill estimate and an invite link |
| J17 | FRICTION | No way to leave a league anywhere in the product | `/app/leagues/:id` | Add "Leave league" with a confirm |
| J18 | FRICTION | Support states there is no way to contact an operator, no status page, no ticket status | `/support` | Publish at least one contact address |
| J19 | FRICTION | The notice panel is eleven near-identical "We made your pick for you… so this does not happen again" scoldings using a word ("queue") she has never been taught | bell panel | Collapse repeats, soften tone, link "queue" to its definition |
| J20 | FRICTION | The "Newer players" filter returns leagues with no "newer players only" tag | `/browse?experienceTier=beginner` | Match the filter to the label |
| J21 | FRICTION | Player names clipped to 3–4 characters in the draft pool ("Jah…", "Bija…", "Ce…"); 61 clipped nodes on the page, on a 60-second clock | `/app/drafts/:id` | Widen the pool column; drop the team badge at this width |
| J22 | FRICTION | Unexplained jargon with no ⓘ in reach: mock draft, draft room, queue, on the clock, roster line "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench", points for/against, stake tier, superflex, median game, waiver wire, the rank number in the pool | throughout | Extend the ⓘ pattern that already works on the storefront |
| J23 | POLISH | The ticker loops the same line ("a seat was claimed in The Longshot League 5 · 11 minutes ago") about ten times per pass, always the same league | `/`, `/browse` | Deduplicate the feed |
| J24 | POLISH | Three monograms for one league in one session: rail "B1", league header "BE", welcome card "B4" | `/app`, `/app/leagues/:id` | One derivation rule |
| J25 | POLISH | The header notification control is labelled only "11" | app header | Label it |
| J26 | POLISH | The rail "+" tile is unlabeled except for a title attribute | app rail | Visible label or tooltip on hover |
| J27 | POLISH | Her own league still shows a "Join" button on the `/app` open-leagues shelf | `/app` | Show "You are in this league" |
| J28 | POLISH | The prominent `/app` league card is not clickable; the only entry is the two-character rail tile | `/app` | Make the card a link |
| J29 | POLISH | "Stake: Free — a label for how competitive a league is", plus "no money changes hands" disclaimers, introduce money anxiety she never had | `/`, `/app/leagues/:id` | Drop "stake" from the first-timer surface |
| J30 | POLISH | Notice timestamps read "8/26/2026, 12:56:28 PM" against the site's "Thursday 27 August, 4:22 PM UTC" | bell panel | One date format |
| J31 | POLISH | All times shown in UTC to a person on a laptop at lunch | `/`, `/browse` | Localize |
| J32 | POLISH | The "brother-in-law" subhead joke only lands for people who already play | `/` hero | Rewrite for someone who has never played |
| J33 | POLISH | `/league-rules` prose uses ~12 terms; the glossary defines 7 (superflex, median game, head-to-head, waiver wire, keeper/dynasty undefined) | `/league-rules` | Define every term the prose uses |

**Counts:** 7 BLOCKER · 15 FRICTION · 11 POLISH · 33 total

---

## Where she would have quit

**On the signed-out storefront, before creating an account — at `/reviews`, two clicks in.**

Her sequence is the cautious one: *How it works* first, which gives her a rulebook and a dead end. Then *Reviews*, because she is about to give a stranger her email — and the only review on the site says the platform ate someone's team, signed by a test account. She closes the tab.

If she is braver and clicks the hero button instead, she quits one click earlier, on the unbranded `staging.authkit.app` signup form, because "Try" turned into "Last name" on a domain she has never heard of.

Either way she quits **before the auth wall**, having never been told what fantasy football is. That fact is the review: the product explains itself very well, in `/app`'s opening sentence and in the "How this room works" modal — and both of those live on the far side of the commitment she has not been given a reason to make.

**Clicks to first value:** signed out, **there is none** — no screen in the signed-out funnel explains the game or lets her do anything. Signed in, the first thing she genuinely understands is the "Preview the room" modal, roughly **8 interactions past a mandatory off-site signup** (browse → take a seat → 5+ auth interactions → `/app` → browse → join → rail → preview).

---

## The three changes that would most improve her journey

**1. Let her play before she signs up.** Make "Try a mock draft" actually start a solo mock signed-out, and ask for an email only when she wants to save it. Today that button is the single most inviting thing on the homepage and it is a signup wall wearing the word "Try", sitting eight pixels under "No account is needed to look." Nothing else in the funnel would move the number as much: a first-timer who has drafted one round understands fantasy football, and a first-timer who has read five paragraphs about superflex does not.

**2. Move the explanation in front of the wall.** The product already contains exactly the right words — `/app`'s *"A league is a group of managers who draft NFL players, then start the ones they think will score most each week"* and the four-card *How this room works* modal. Both are locked behind an account. Put them on `/` and rebuild "How it works" around them, with the format glossary demoted to a reference section underneath. The writing is already done; it is filed in the wrong place.

**3. Clean the storefront and give her something to look at.** Exclude e2e-named leagues from every public shelf and from `/reviews`, deduplicate the ticker, and make each league name open a read-only preview — who is in it, when it drafts, what the rules mean — so that "no account is needed to look" becomes true. Right now the first impression is a database dump with one one-star review, and the only clickable thing in a league row is the button that commits her to a season.
