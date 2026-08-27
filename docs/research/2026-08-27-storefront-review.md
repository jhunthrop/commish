# The storefront — a re-review of the founder-approved front door (2026-08-27)

`/`, `/browse`, `/league-rules` and `/legal/*` are where the Sunday Standard was born: the mock
the founder approved on 2026-08-24 ("this is better") was drawn against this cluster, and the six
rules were derived from it. This is not a first review, and it does not relitigate the identity.
Near-monochrome is right. The wire is the signature and it works. The row shelf was
founder-ordered and it is the correct form. What this review judges is what has landed on top of
that base since: the practice entry (Task 9), the sit-and-go directive (2026-08-26) that turned
the whole house catalog `when_full` and cut the shelf's width, the fun-name pass, and the
signed-in variants of two pages built for strangers. The bar is unchanged — "most premium
experience in the fantasy world... sleek, modern, beautifully simplistic but high information
density... maximize full screen width... best app I've ever seen or used."

The finding that matters most is not a pixel. Three of these accretions each made local sense and
together they moved what the storefront is *for*: the front door's hero now offers a stranger
exactly one visible action, and it is a fake draft.

## Method

Judged the real rendered pages, not the code's intentions. The built app at
`http://localhost:3102` (branch `worktree-ive-campaign`), driven with Playwright/Chromium against
the real seeded Postgres — real `listPublicLeagues`, real `proofStats` cache, real
`listWireItems`. Two contexts: a clean anonymous one (the signed-out front door and browse a
stranger actually gets) and `e2e/.auth/manager-a.json` for the signed-in variants of `/` and
`/browse`. Full-page shots at 1680 in both themes and at 360, plus four driven query states
(`?whenFull=1`, `?sort=soonest`, `?experienceTier=beginner`, and the unfiltered shelf). Every
geometry number below — column origins, pill widths, row heights, document heights — was read out
of the live DOM with `getBoundingClientRect`, never eyeballed off a screenshot. Contrast ratios
are computed from `src/design/tokens.ts` values directly, so they hold in any engine. Read-only:
no source file changed, no commit made, no league joined, no server touched. Shots (this machine):
`/private/tmp/claude-501/-Users-jh-code-fantasy/d1b45147-2ef6-4dae-8e60-c0a2d552f0c5/scratchpad/revE/`
(`front-*`, `browse-*`, `rules-*`, `terms-*`, `privacy-*`, `in-*`).

Two harness artifacts to discount when reading the shots. The seeded corpus carries three
`E2E Money Dark <timestamp>` leagues on the public shelf — test residue, not a real listing; their
*names* are not a finding, their row shape is. And the six open house leagues predate the
2026-08-26 sit-and-go directive, so they still wear factory names. That the shelf shows six where
the catalog now declares two is **not** an artifact — see E13.

## Executive verdict

The base still holds: the wire scrolls real events under the nav, the palette is honestly designed
in both themes rather than inverted, the row shelf is the right idiom, and the money copy is clean
end to end (the deposit step the founder once flagged exists only in `LIVE_STEPS` and every
surface — hero, steps, shelf, Entry column, Terms — derives its free-season claim from one
`moneyIsLive()` switch, verified byte-for-byte). What has drifted is everything the accretions
touched: the practice link renders as a 1,648 × 40 bar across the top of `/browse`, above and
eleven times wider than that page's own title; the sit-and-go directive turned a 30-word footnote
into the entire "Drafts" column on 21 of 29 rows and quietly starved the four surfaces gated on a
chosen kickoff, including the front door's only red number; the shelf's column header sits up to
80px off the columns it names; and a signed-in member is still told to sign in. The front door
does not fail — it *defers*: 2,054 of its 2,146 pixels carry no ink action at all, and the one
thing it invites a stranger to do in the hero is practice.

## Findings

| # | Class | Sev | Finding | File | Remediation (one line) |
|---|---|---|---|---|---|
| D1 | DEFECT (design law) | HIGH | The practice pill on `/browse` is a **1,648 × 40 bar** (measured) at the very top of `<main>`, above the `<h1>` and **11.8× its width** (title: 140px) — a `rounded-pill` at 41:1 is not a pill, and rule 5's two-pill vocabulary is the product's entire action language. Cause is mechanical and reproduces: `PracticeEntryLink` returns a bare `<Link>` carrying `buttonClassName(...)`, and `<main className="flex … flex-col">` stretches it (`align-items: stretch`). The front door escapes only because its instance sits inside `items-start`. The same bug renders `NextDraftModule`'s signed-in Join at **318 × 40** in a 360px module | `practice-entry-link.tsx`, `src/app/browse/page.tsx`, `next-draft-module.tsx` | The pill wraps itself (`<div className="flex"><Link …/></div>`) so no parent's alignment can ever inflate it; add a component test asserting an intrinsic width in a stretching flex column |
| D2 | DEFECT | HIGH | **The shelf's column header does not sit over its columns.** Measured on `/browse` at 1680: Format header x=450 / data x=424, Drafts **865 / 813**, Entry **1219 / 1147**, Seats **1270 / 1190** — up to **80px of drift**, and "Entry" and "Seats" visibly collide into one pair. `LEAGUE_ROW_GRID` carries two `max-content` tracks; the header row fills them with "Entry" (34px) and an empty `<span/>` (0px) while every data row fills them with "Free" (27px) and a 106px pill, so the header and the rows resolve **different grid tracks**. A column header that names the wrong column is worse than none | `league-row.tsx` (`LEAGUE_ROW_GRID`, `LeagueRowsHeader`) | The two `max-content` tracks become fixed or `minmax()` tracks so header and rows resolve identically; a test asserts the header cell's x equals its column's x |
| D3 | DEFECT | HIGH | **The signed-in front door wears the stranger's chrome and the stranger's words.** `/` renders `PublicBar` unconditionally: a signed-in member sees "Sign in" in the corner (measured, verbatim) beside the anonymous "Take a seat" ink pill, reads "No account is needed to look." in the hero, and is walked through "2 · 30 seconds · Sign in with email · That is the whole signup." The page already reads `user` — for `helpLevel` and for the CTA's destination — and then declines to use it for the two things it most changes | `src/app/page.tsx`, `front-door-hero.tsx`, `seat-claim-steps.tsx` | The front door branches its chrome and its hero detail lines on `user`, the way `/browse` already branches `PublicBar` vs `AppShell` |
| D4 | DEFECT | MEDIUM | **Two filter pills do not govern the rows they show first.** `whenFullOnly` is "never applied to the house shelf" by design, and the house half always leads — so under **"Drafts when full"** row 1 is `Open 12-team League 50`, a `scheduled` league printing "Friday 28 August, 1:59 AM UTC (in 12 hours)". Under **"Drafting soonest"** the first six rows do not move at all. A filter that visibly contradicts itself on its own first row teaches a visitor the controls are decoration | `src/app/browse/page.tsx`, `src/league-service/browse.ts` (`houseShelfQuery`), `browse-filters.tsx` | Either apply the sort/when-full axes to the house half too, or say once, above the pills, that the house shelf always leads |
| D5 | DEFECT (design law) | MEDIUM | The unfilled `SeatMeter` track is drawn in `surfaceInset`, which the token table itself assigns to "an unfilled meter" — and against the shelf's own `surface` ground that is **1.03:1 in dark** (`#111114` on `#0D0D0F`) and **1.07:1 in light** (`#F3F3F1` on `#FBFBFA`). On today's shelf, six of twelve front-door rows are 0-seated, so the product's named money primitive renders as a 355px-wide invisible object on exactly the rows sit-and-go exists to sell | `src/design/tokens.ts`, `seat-meter.tsx` | The meter's own track needs a role that clears its ground (or the meter draws its own hairline); a token test asserts the track is visible against `surface`, not only against `surfaceElevated` |
| E1 | EXECUTION | HIGH | **The Drafts column is now one sentence, repeated.** `describeStartTiming`'s when-full commitment is 30 words over three sentences, written as a *footnote beneath a value*; with the whole catalog `when_full`, `ScheduledDraftValue` returns `null` and the paragraph IS the column. Measured on `/browse`: **21 of 29 rows** carry it verbatim at **58px each — 1,218px of one sentence**, under a header reading "Drafts" that names a value no longer present. On the 360 card the same fact renders as a ledger row labelled "Drafts" with an **empty value cell** | `open-league-shared.tsx` (`DraftTimingNotes`), `league-row.tsx`, `open-league-card.tsx` | The column prints a *value* ("When it fills"), and the reassurance sentence moves to one line under the shelf, said once, not twenty-one times |
| E2 | EXECUTION | HIGH | **The front door's hero offers one action and it is the mock draft.** Measured: the page's only ink pill is "Take a seat", 104 × 40, at x=1508 **y=12** — in the nav. The hero band's own single affordance is `PracticeEntryLink` (139 × 40, quiet), and because a scheduled league qualifies, `featuredInHero` forces the entire 12-row shelf to `quiet` as well. **2,054 of 2,146px carry no ink at all.** Rule 5's count is satisfied and its intent is inverted: the ink lives in the chrome, and the page's loudest in-band invitation is to practice | `src/app/page.tsx`, `front-door-hero.tsx`, `next-draft-module.tsx` | The hero band earns the page's ink (the module's Join, or a "Take a seat" beside the headline); the practice link steps back to a text link — see R5 |
| E3 | EXECUTION | MEDIUM | **`NextDraftModule` never says "Next draft."** Its docblock names it "THE NEXT DRAFT"; the rendered box has no eyebrow, no label, no heading — a bordered rectangle in the hero's right half holding a league name, a date, "12 of 12 open" and a button, with nothing telling a stranger why it is there. `EYEBROW` exists for exactly this | `next-draft-module.tsx` | One `EYEBROW` line: "Next draft" |
| E4 | EXECUTION | MEDIUM | And the league it features is the worst one on the shelf: **`Open 12-team League 50` — 12 of 12 open, zero seated, and already rolled once** ("This draft moved once because the room was not full", rendered right under it). `featuredScheduledLeague` selects the nearest scheduled instant with no seat test at all, so the front door's premium slot advertises the room that has most conspicuously failed to fill | `public-league-list.tsx` (`nearestScheduledLeague`) | The featured league must have at least one seat taken and no prior roll, else the module declines to render (rule 6, real or absent) |
| E5 | EXECUTION | HIGH | **The phone documents are enormous and uncapped.** Measured at 360: `/` is **7,087px**, `/browse` signed out is **14,163px**, and `/browse` signed in is **18,079px** — fifty screens of ledger cards, with no count, no pagination, no "showing 29", no way to collapse. The front door's own cap (`shelfCap`) governs member leagues only; the house half is uncapped, which is why the "capped teaser" renders twelve | `public-league-list.tsx`, `src/app/browse/page.tsx` | Cap and count both halves; `/browse` paginates or virtualizes past a screen or two |
| E6 | EXECUTION | MEDIUM | **Five rows apologise on a public shelf.** "This draft moved once because the room was not full." is honest and correct as a detail on a league page; printed in the Drafts column of the storefront, five times, it is the product telling a stranger its rooms do not fill — in the exact column they are reading to decide whether to sit down | `open-league-shared.tsx` (`DraftTimingNotes`, `rollNoticeSentence`) | The roll notice belongs on the league's own page and the waiting room, not the shelf; or it earns its place by pairing with the new time, positively worded |
| E7 | EXECUTION | MEDIUM | **The grid spends its widest tracks on its thinnest facts.** Measured: Seats is **355px** to hold "12 of 12 open" plus an invisible track (D5); Entry is **27px** to hold "Free"; Format is 373px to hold "12 teams · Snake · Half PPR". The six columns were proportioned when Drafts held a date and Seats held a filling meter; neither is true on today's shelf | `league-row.tsx` (`LEAGUE_ROW_GRID`) | Re-proportion against what the columns actually hold now, with Drafts and Seats re-earning their width from E1 and R3 |
| E8 | EXECUTION | MEDIUM | **The legal pages float.** `/legal/terms` and `/legal/privacy` are both exactly 1,000px documents at a 1,000px viewport: content ends near y=447, `PublicFooter` sits immediately beneath it, and roughly **480px of empty ground** follows to the fold. A terms page whose last half is void reads as unfinished, whatever it says | `src/app/legal/terms/page.tsx`, `.../privacy/page.tsx` | The public shell pins the footer to the bottom of the viewport on short documents (`min-h-dvh` + `flex-1` on `<main>`) |
| E9 | EXECUTION | MEDIUM | **Every paragraph of every reading page is `text-text-muted`** — the entire body of Terms, of Privacy, and the whole prose lede of `/league-rules`. `textMuted` is the *secondary* role; a legal document typeset entirely in it reads as fine print, literally. The tell is on `/league-rules` itself, where the glossary's term names are ink and the prose a reader came for is not | `legal/terms/page.tsx`, `legal/privacy/page.tsx`, `league-rules/page.tsx` | Reading-page body text is `text-text-primary`; `textMuted` returns to captions and meta |
| E10 | EXECUTION | MEDIUM | **The reading pages measure the frame, not the paragraph.** All three carry `mx-auto max-w-3xl` on `<main>` itself, so at 1680 the `<h1>` sits at **x=472** with 472px of dead gutter each side — against the constitution's own carve-out: "The frame is always full-bleed; only the words a person reads line-by-line ever get measured." The wordmark anchors at x=16 and the page title floats in the middle of the screen | `legal/*/page.tsx`, `league-rules/page.tsx`, `support/page.tsx` | The frame keeps the product gutter and the paragraph column carries the measure, so a reading page and an app page share one left edge |
| E11 | EXECUTION | MEDIUM | **`/league-rules` is a dead end, and it is the front door's own second step.** "How it works" is nav item two; the page it opens has no CTA, no "See open leagues", no "Take a seat" — and `PublicBar` renders **bare** off the front door, so the three nav links vanish too. The only way onward is the wordmark. The constitution's "never a dead end" is written for empty states; it is truer of a marketing explainer | `league-rules/page.tsx`, `legal/*/page.tsx`, `public-bar.tsx` | Every public page carries the same nav and the same one quiet way back to the shelf |
| E12 | EXECUTION | LOW | **Signing in deletes the trust links.** `/browse` renders `PublicFooter` on the signed-out branch only; the signed-in branch returns `AppShell` alone, so Terms, Privacy, Support and League rules are unreachable from that page for a member (measured: `footer` present signed out, `null` signed in) | `src/app/browse/page.tsx`, `app-shell.tsx` | The footer is chrome, not a signed-out decoration — `AppShell` carries it, or `/browse` renders it on both branches |
| E13 | EXECUTION | LOW | **The shelf-width cut does not reach a shelf that is already wide.** `HOUSE_CATALOG` declares `openAtOnce: 1` on two live rungs; six house leagues stand open. `ensureHouseCatalog` "opens exactly the shortfall" and has no retirement path for surplus, and five of the six are now `when_full` at **0 of 12 seated** — a room that never fills never leaves. The same staleness is why the founder's fun-name pool is live in code and absent from every rendered row (and from the wire, which quotes "Open 12-team League 41"). The founder's complaint was "too many open tournaments at once" | `src/league-service/house-factory.ts`, `src/matchmaking/house-catalog.ts` | The reconciler retires surplus as well as opening shortfall, oldest-and-emptiest first; then the fun names arrive on their own |
| R1 | DIRECTION | HIGH | **Sit-and-go removed the product's own supply of chosen kickoffs, and four surfaces are gated on one.** `draftsNext48hQuery`, `nextDraftAtQuery`, `featuredScheduledLeague` and the wire's `draft_tonight` item all require `start_trigger = 'scheduled'`; no rung in the catalog produces one any more. Today they are held up entirely by legacy pre-directive rows — the front door's single red number ("12 drafts in the next 48 hours"), its "12 hours until the next draft" chip, its whole right column, and one of the wire's four kinds. As those rows drain, the front door loses its only live count **by construction**, and rule 1's live family disappears from the storefront. This is the accretion with the longest reach and nothing in the codebase records that the trade was made | `house-catalog.ts`, `proof.ts`, `wire.ts`, `public-league-list.tsx` | Decide once: either a rung stays scheduled to keep a real clock on the storefront, or the proof strip and the wire get sit-and-go-native facts (rooms filling now, time-to-fill) and the scheduled-only readers are retired rather than left to starve |
| R2 | DIRECTION | HIGH | **"Real leagues. Real seats. Drafting this week."** is the one sentence sit-and-go most directly contradicts. Under it sits a shelf whose house half is 0-seated and drafts only when full — which may be this week, or never. The headline was true when the catalog staggered dated kickoffs; it is now a promise the shelf beneath it cannot keep, and it is the first thing a stranger reads | `front-door-hero.tsx` | The headline states what sit-and-go actually offers ("a seat now, a draft the moment it fills") — one sentence, persona-vetted, in the approved register |
| R3 | DIRECTION | — | **The shelf never says sit-and-go, and never says how fast.** The word appears nowhere a visitor reads; nothing states how quickly a room usually fills, or how many are filling right now. The one fact that makes a 0-seated room attractive already exists and already renders — the wire says "Open 12-team League 41 filled · drafting soon". Bringing fill velocity onto the row (or one line above the shelf) is the highest-leverage premium move available on this surface, and it honors the wire's existing honesty contract because it is a real read | `public-league-list.tsx`, `league-row.tsx`, `src/league-service/wire.ts` | Design a fill-velocity fact against the wire's contract (request-time truth, real-or-nothing), then let the Drafts column carry it |
| R4 | DIRECTION | — | **The ink is on the wrong row.** `featuredLeagueId` prefers the nearest *scheduled* draft, which under sit-and-go means the one legacy dated room — empty and already rolled — while `Backyard Brawl` (live chip "Filling", 2 of 8 open) takes a quiet pill. The fallback clause the function already carries (fewest seats remaining) is now the *right* rule, not the fallback | `public-league-list.tsx` (`featuredLeagueId`) | Invert the preference under a when-full shelf: tightest room first, dated kickoff only as the tiebreak |
| R5 | DIRECTION | — | **What is the practice draft's place in the funnel?** Today it is the hero's only visible action (E2) and the first element on `/browse` (D1) — two decisions each made as "one quiet line" that add up to the storefront leading with a rehearsal. My read: the mock draft is the *answer to a hesitation*, not the offer — it belongs beside the steps ("Never drafted before? Try a mock first"), not in the slot where the product asks for a seat. Recorded for the persona panel rather than auto-fixed, because it is a positioning call | `front-door-hero.tsx`, `src/app/browse/page.tsx` | Mock the two placements at 1680 and 360 and let the panel rule |

Counts: **5 DEFECT · 13 EXECUTION · 5 DIRECTION.**

## The per-state walk

Shots referenced by filename in `scratchpad/revE/`.

**S1 · Front door, dark, 1680 (`front-dark-1680.png`).** The base is intact and it still looks
like the mock: the floodlit band, the yard lines, the 58px display headline with "Drafting this
week." in money green, the wire ticking real events under the nav. Then the composition drifts.
The hero's left column ends on a quiet "Try a mock draft" pill; the right column holds an unlabeled
box (E3) advertising an empty, already-rolled league (E4); the ink pill is in the corner at y=12
(E2). Below the fold the shelf is twelve rows, nine of which print the same 30-word sentence in
the Drafts column (E1), six of which show a completely empty seat meter (D5), and whose column
header does not sit over its columns (D2). Document height 2,146px, no horizontal overflow.

**S2 · Front door, light, 1680 (`front-light-1680.png`).** Structurally identical and honestly
designed rather than inverted — the palette work holds. The one register loss is the floodlight:
dark gets two radial washes and light gets one, so the hero band and the shelf band read as nearly
the same paper, and the yard lines carry the whole distinction. Not a defect; worth knowing the
light hero has less energy than the approved dark mock promised.

**S3 · Front door, 360 (`front-360.png`, `c-front360-fold.png`).** The best-composed state in this
cluster's desktop-or-phone comparison, and the same story the mock-lobby review found: the moment
the viewport stops letting things stretch, the hierarchy reads. Wordmark, ink pill, wire, headline
at `display-md`, sub, money line, one quiet pill, three steps, three chips. Then 7,087px of ledger
cards (E5), the first of which prints a "Drafts" label with an empty value beside it (E1).

**S4 · Browse, dark, 1680 (`browse-dark-1680.png`, `c-browse-fold.png`).** The worst single frame
in the cluster and the clearest picture of the accretion problem: the first element on the page,
above the title, is a **1,648px bar reading "Try a mock draft"** (D1). The page's own `<h1>` is
140px. Below it, four filter pills of which two do not govern the six rows directly under them
(D4), then 29 rows carrying 1,218px of one repeated sentence (E1) and five apologies (E6).

**S5 · Browse under `?whenFull=1` and `?sort=soonest` (`browse-whenfull.png`,
`browse-soonest.png`).** Driven to prove D4 rather than infer it. Under "Drafts when full" the
list drops 29 → 19 rows and row one is still a scheduled league with a dated kickoff. Under
"Drafting soonest" the row count is unchanged and the first six rows are byte-identical to "All".

**S6 · Browse, signed in, 1680 and 360 (`in-browse-1680.png`, `in-browse-360.png`).** The shell
arrives, the wire correctly does not, and the full-width practice bar is *still* the first thing
inside the content column (1,584px now). The footer is gone (E12). At 360 the document is
**18,079px** (E5).

**S7 · Front door, signed in (`in-front-1680.png`).** Byte-for-byte the stranger's page: "Sign in"
in the corner, "Take a seat" ink, "No account is needed to look.", "Sign in with email · That is
the whole signup" (D3). The one thing that does change — the module's CTA becoming a real Join —
changes for the worse, stretching to 318px in a 360px module (D1).

**S8 · `/league-rules` (`rules-1680.png`).** The best-composed page in the cluster. The prose,
the dotted term links that jump to the glossary rather than floating a tip, the `Panel` with its
EYEBROW head and hairline-separated entries — this is what the reading register should be. Two
faults, both fixable in an afternoon: it is set entirely in the secondary text role (E9) and it
is a dead end with no nav and no way forward (E11).

**S9 · `/legal/terms`, `/legal/privacy` (`terms-1680.png`, `privacy-1680.png`).** Dignified in
voice — four plain paragraphs that say what the product is, what it does not have, and that it is
a preview, with no legalese and no borrowed boilerplate. Undignified in frame: the whole page is a
736px column centered at x=472 (E10), every word is muted grey (E9), the footer floats immediately
under the last line with ~480px of black beneath it (E8), and neither page carries a date. A terms
page with no effective date cannot tell a member which terms they agreed to; that is the one thing
these pages owe a reader that the words alone cannot supply.

## The first-timer's thirty seconds

Seconds 0–5: the headline lands. "Real leagues. Real seats. Drafting this week." over a floodlit
band with a ticker of real events above it — this is still the best five seconds this product
owns, and the approved identity is doing the work. Seconds 5–15: she reads down the left column,
past a good sub, past "Every league is free this season" in green, past "No account is needed to
look" — and arrives at a button that says **Try a mock draft**. It is the only thing in the hero
she can press. She did not come to rehearse; she came to see whether there is a real league with a
real seat, which is what the headline just told her. The real invitation is a 104px pill 1,468px
away in the corner (E2, R5). Seconds 15–25: her eye goes right to the one boxed object on the
band, which has no label telling her what it is (E3), and reads: a league name, a date twelve
hours out, **"12 of 12 open"**, and a Join. Twelve of twelve. Nobody is in it. Directly beneath,
in the shelf, the same league carries a line explaining that its draft already moved once because
the room was not full (E4, E6). Seconds 25–30: she scrolls into the shelf and meets twelve rows,
half of which say the same thirty words in the same column under a header that is 52 pixels to the
right of them (E1, D2), and six of which show a seat bar with nothing in it at all (D5). The word
that would explain all of this — sit and go, a room that drafts the moment it fills, and how fast
that usually happens — is on no surface she has seen (R3).

Verdict: she is not repelled, and she may well click "Try a mock draft," which is the one thing
the page made easy. That is the problem in one sentence. The front door's approved thesis is that
this product is real and live and happening this week; what the accretions left is a page that
leads with practice, features an empty room, and shows a stranger nothing filling.

## Prioritized remediation

**Before this ships to strangers (the compact fix pass):**
1. **D1** — the practice pill wraps itself and stops stretching, on both surfaces, with a test.
   Ten-minute fix, largest visual return in the cluster.
2. **E1 + D2** — the Drafts column gets a *value* again and the when-full sentence is said once;
   the header's two `max-content` tracks are fixed so the header sits over its columns.
3. **D3** — the front door branches on `user`: no "Sign in" to a member, no "that is the whole
   signup" to someone who already did it.
4. **E2** — the hero band earns the page's ink action, and the practice link steps back.
5. **E3 + E4** — the module says "Next draft", and declines to render an empty or already-rolled
   league.
6. **D5** — the seat meter's track becomes visible against the page ground, in both themes.
7. **D4 + E6** — the two inert filter pills are made honest, and the roll apology leaves the shelf.
8. **E8, E9, E10, E11, E12** — the reading-page pass: footer pinned, body text in the primary role,
   frame full-bleed with the paragraph measured, one nav on every public page, footer on both
   branches of `/browse`. All five are small and they land together.

**After (the composition pass, in order of leverage):**
1. **R1** — the scheduled-kickoff decision, made explicitly and recorded. Everything the front
   door counts as live depends on it, and it is currently decided by accident.
2. **R2** — the headline says what sit-and-go actually offers.
3. **R3** — fill velocity on the row, against the wire's existing honesty contract. The premium
   move, and the one that makes a 0-seated room attractive instead of alarming.
4. **R4** — the ink follows the tightest room, not the only dated one.
5. **E5 + E13** — the shelf gets a count, a cap and a reconciler that retires surplus; the fun
   names arrive on their own once it does.
6. **E7** — the six columns re-proportioned against what they now hold.
7. **R5** — the practice draft's place in the funnel, adjudicated by the persona panel.

---

*Method footnote: all geometry, computed styles and ink counts were read from the live DOM of the
real built app on `worktree-ive-campaign` at `http://localhost:3102`, against a clean anonymous
context for the signed-out states and `e2e/.auth/manager-a.json` for the signed-in ones; contrast
ratios were computed from `src/design/tokens.ts` values rather than sampled from screenshots, so
they hold in any engine. Query states were reached by URL only — no league was joined, no room was
created, no write of any kind was made against the shared database. Read-only review: no source
file changed, no commit made.*
