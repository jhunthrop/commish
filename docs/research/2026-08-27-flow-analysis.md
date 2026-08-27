# Commish — UX flow analysis and persona journeys (2026-08-27)

Founder-ordered: "a UX flow analysis of the site to make sure that it provides a user experience... a persona review of users trying to use the site for the first time... make sure the navigation and layout makes sense."

Four analysts walked the **built app** (not the code) as journeys rather than screens, each producing its own document:

| Analyst | Document | BLOCKER | FRICTION | POLISH |
|---|---|---|---|---|
| Maya, never played fantasy | `2026-08-27-journey-first-timer.md` | 7 | 15 | 11 |
| Deshawn, 12-season veteran | `2026-08-27-journey-veteran.md` | 7 | 25 | 8 |
| Ana, office commissioner | `2026-08-27-journey-commissioner.md` | 3 | 11 | 6 |
| Navigation / IA | `2026-08-27-navigation-ia.md` | 3 | 12 | 5 |
| **Total** | | **20** | **63** | **30** |

The six per-screen Ive reviews (2026-08-26/27) stand alongside this; they judged surfaces, this judges **paths between them**.

---

## The verdict in one paragraph

Every individual screen in this product is better than the product. The journeys break in the seams: a first-timer is never told what fantasy football is on the public side of the wall (the perfect explanation sits *inside* the account she has not created), a veteran cannot read a player's name on the button he must press within sixty seconds, a commissioner copies an invite "link" that is a relative path and cannot open, and the live draft room — the highest-stakes screen the product owns — renders zero navigation of any kind. Nothing here is a rewrite; the fixes are small and mostly mechanical. But until they land, the product's own best qualities are unreachable by the people it was built for.

---

## The five findings that matter most

### 1. A GET request permanently joins you to a league (SAFETY DEFECT)
`src/app/join/[leagueId]/hold/page.tsx:94` — rendering the page as a signed-in user calls `returnFromSignIn`, which **writes a `teams` row**. Navigating to a URL therefore seats you: no confirmation, no settings review, no exit afterwards. The veteran analyst was seated in a seeded league by typing the address, and could not leave; the row is still there (`dev_public_sunday_snake` / "Commish Lab").

The design intent is legitimate (return here after signing in and complete the seat you already held), but the intent is carried by a URL that any prefetch, crawler, shared link, or curious click also triggers. **A read must never seat a member.** The write belongs behind an explicit POST — with the signed-out→sign-in→return path completing through a one-tap confirm, not silently.

### 2. The live draft room has no way out
Zero anchors at 390px and 1440px: no home, no league, no profile, no support, no sign-out. The `(room)` layout group correctly declines the app shell so the board can own the viewport — but "no shell" was built as "no navigation". Browser-back is the only exit, and a direct landing (notification, bookmark) has no back entry to use. Compounded by every page in the product setting `document.title` to "Commish", which makes the history that five routes depend on unreadable.

### 3. The product explains itself only after you commit
`/app` opens with the exact sentence a newcomer needs, and the "Preview the room" modal is a genuinely excellent four-card explainer — both behind the account wall. On the public side, the hero's friendliest button ("Try a mock draft") sits eight pixels beneath "No account is needed to look" and throws the visitor to an **unbranded third-party signup form**. Meanwhile the nav item labelled "How it works" opens a rulebook that never says what fantasy football is. Maya quit two clicks in, having never learned the game.

### 4. The commissioner's invite does not work
`invite-panel.tsx` renders the invite `value` as `/app/join/ZHSBJF2C` — a **relative path**, with no copy button, no share sheet, and no mailto. She texts eleven people something that cannot open. The panel's state is local, the invites API is POST-only with no list and no revoke, so a reload offers "Create invite link" again and mints a *second* live code. And the same league advertises two different draft days: the countdown hero says Saturday 5 September 7:00 PM while the summary rail and the stranger-facing invite landing say Sunday 6 September 12:00 AM UTC.

### 5. The storefront is showing test data to strangers
17 of 50 public rows are fixtures ("E2E Money Dark 1787678163994"); the wire loops one event verbatim ten times per pass; and the Reviews page — linked in the public nav — displays exactly one review: one star, *"This league ate my roster overnight and nobody ever explained why."* Beside it, `/support` states there is no way to contact an operator. Two of three personas independently flagged this as the credibility break.

---

## What is genuinely good (so it is not lost in the fixing)

- The **invite landing** a stranger receives is excellent: honest state model, one-tap join, the league's terms in plain words.
- The **money story is honest** — the wallet says real-money play is not available and "no number on this page will ever be an invented one". The veteran called it an honest *no*, and would bookmark the product for it.
- The **draft room itself** meets a veteran's bar: 1,646-player pool, position filters, queue, snake board, archetyped bots that behave like people.
- The **prose** across rules, support, and wallet is written by someone who understands that a skeptic reads for what is missing.
- League creation took Ana **under a minute**, and rescheduling took three interactions.

---

## Cross-cutting patterns (fix the pattern, not the instance)

1. **Instructional copy that is not wired.** "See how the draft room works", "Name your team", "Rank your draft slots" render as dead body text in one place and as working controls in another.
2. **The same fact stated twice, differently.** Draft dates, week status, seat counts, "no review step" vs a trade in review — four self-contradictions in one veteran session. One fact, one source, everywhere it appears.
3. **Orphans.** Seven routes have zero inbound links (the TV board, five operator pages, a redirect stub); four more (support, legal ×2, league rules) are unreachable from all 17 signed-in routes.
4. **No "you are here".** The league rail marks the current league for screen readers but styles it identically to the other 105 tiles.
5. **Dev fixtures on public surfaces.** E2E and Mobile360 artifacts render in the storefront, the ticker, and the shelf.

---

## Remediation program

**Wave A — safety and exits (immediate, gated):**
A1 the hold-page GET write becomes an explicit POST-with-confirm; A2 the draft room gains a minimal exit bar (wordmark home, league name, leave); A3 support + legal reachable from every signed-in route; A4 the five operator pages get doors; A5 per-page `document.title`.

**Wave B — the funnel (fast lane):**
B1 the public side explains the game before asking for an account (one sentence + the existing four-card explainer, moved outside the wall); B2 "Try a mock draft" either works signed-out or says it needs an account before it navigates; B3 branded auth handoff; B4 "How it works" answers what fantasy football is before it lists rules.

**Wave C — the commissioner (fast lane, one gated item):**
C1 absolute invite URL + copy button + share sheet (and a mailto); C2 one draft-time fact, one format, everywhere (gated — it is a data/format seam); C3 invite list with revoke (gated — API surface); C4 a pending/joined roster view with a nudge.

**Wave D — credibility and wayfinding (fast lane):**
D1 fixtures excluded from public surfaces; D2 wire de-duplication; D3 reviews surface honest or hidden; D4 rail "you are here"; D5 the dead instructional copy wired or deleted.

**Wave E — the veteran's in-season product (mixed):**
E1 the matchup page's honest line ("Up 7.40 with 6 of 13 games final") and has-not-played vs scored-zero (already specified by the competition review); E2 draft-button names readable at every width; E3 stats-not-final state on scored surfaces.

Note on the "scoring engine is broken" report: triaged as **not an engine defect**. Week-14 data carries real production at every position (QB 8,206 yards, RB 7,080, WR 6,049, TE 1,315); the seeded stat set covers a subset of players, and the matchup page renders a missing line as `0.00`, indistinguishable from a real zero — the exact defect the competition review filed. It presents as a broken engine, which is why it reads as a blocker to a stranger.
