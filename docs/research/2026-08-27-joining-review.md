# The joining funnel — first full design review (2026-08-27)

Four surfaces, never reviewed, that together are the only way a stranger becomes a member:
`/app/join/[code]` (the public invite landing and its nine designed states),
`/join/[leagueId]/hold` (the paid-seat interstitial, running money-dark), the first-run experience
on `/app` for a leagueless account (`src/identity/first-run.ts` + `FirstRunPanel`), and league
creation (`CreateLeagueForm`, wherever it mounts). Judged in the same format and against the same
bar as `docs/research/2026-08-26-draft-room-design-review.md` and
`docs/research/2026-08-26-mock-lobby-review.md`: "most premium experience in the fantasy
world... sleek, modern, beautifully simplistic but high information density... maximize full
screen width... most efficient workflows... best app I've ever seen or used."

The stakes are the whole funnel. The room review raised the room; the lobby review raised the
practice doorway. This cluster is everything in front of both of them — and it contains the only
page under `/app` a signed-out human can reach (`middleware.ts`'s single exemption), the only
screen that says what a real league costs and commits you to, and the first signed-in view any
account ever sees. The founder's own question for this pass was specific: **the mock setup form
just got a measure and field groups — does the real creation form hold the same bar?** It does
not, and the gap is measured below.

## Method

Judged the real rendered pages, not the code's intentions. The real built app at
`http://localhost:3102` (worktree `phase4p5-mock-drafts`, branch `worktree-ive-campaign`), driven
with Playwright/Chromium against real Postgres and real SSR reads. A fresh private league and a
fresh public league were commissioned through the real `POST /api/leagues` as `manager-a`, and two
real invite codes minted through the real `POST /api/leagues/[leagueId]/invites` — no seeded data
touched, no source file changed, no server started or killed, no commit. Seventeen driven states
at 1440px and 360px, dark plus a light spot-check: the open invite landing signed out, signed in
as a non-member, and signed in as the league's own commissioner; the dead-code landing signed out
and signed in; the already-member panel reached by actually pressing Join; the hold interstitial
signed out; the first-run panel on a leagueless account with its advanced drawer both closed and
open; the returning-manager disclosure; and the creation form with its own API aborted, to see
where a failure lands. Geometry, computed styles, `aria-invalid`/`aria-describedby` wiring and
ink-pill counts were read out of the live DOM rather than eyeballed. Contrast ratios were computed
from `src/design/tokens.ts` arithmetically, not sampled from a screenshot. Shots (this machine):
`/private/tmp/claude-501/-Users-jh-code-fantasy/d1b45147-2ef6-4dae-8e60-c0a2d552f0c5/scratchpad/revC-join/`
(`j1`–`j17`).

Two harness artifacts to discount when reading them. The `manager-zero` top bar carries an unread
notices badge reading "11" on an account with zero leagues — that account is fresh-ish, not fresh,
and the badge is its history, not a defect of this surface. And the hold page's 360px shot says
"1 seat is being claimed right now" because the 1440px shot's own hold was still live in the
database; the desktop shot's plain "1 of 12 seated" is the honest first-visit render.

## Executive verdict

The words in this funnel are genuinely good — "That seat went to someone else while you were
signing in", "Joining puts you in the draft and the season that follows", the safety net quoted
verbatim on the hold page — and the state model behind the invite landing was thought about
harder than most products think about anything. But the surfaces do not deliver those words: the
terms panel every stranger sees is **visually broken in the exact help mode the page forces on
every signed-out visitor** (the ⓘ floats 28px above the value it annotates and three of seven
labels orphan onto their own line), a member who re-taps their own invite link is offered an ink
pill inviting them to join a league they are already in, and the creation form pins "We could not
reach the server" to the League name field as a validation error. The first signed-in screen in
the product is five stacked cards, two ink pills and 600px of profile form standing between a
headline that says "Pick how you want to get started" and the first thing anyone can pick. And
the answer to the founder's question is no: `MockSetupForm` has a measure, three named groups and
a real pill; `CreateLeagueForm` has a 1,310 × 40 ink bar, a 649px select holding the words "Invite
only", and no groups at all. A compact fix pass closes five defects and the creation form's
measure; the composition pass is where this funnel stops being four honest forms and starts being
the front of a product somebody wants to be inside.

## Findings

| # | Class | Sev | Finding | File | Remediation (one line) |
|---|---|---|---|---|---|
| D1 | DEFECT | HIGH | The terms panel is **visually broken in guided help, which is what every signed-out visitor is forced into** (`page.tsx`: `preferences?.helpLevel ?? "guided"`). The `<dd>` is `inline-flex items-center` and the guided `InfoTip` is a two-line column inside it, so a one-line value centers against it: measured at 1440 dark, the Format ⓘ sits at y=210 while "Snake" sits at y=238 — 28px above the word it annotates — and Stake (`dt` y=280 vs `dd` y=298) and Scoring (`dt` y=437 vs `dd` y=456) orphan their labels onto their own line entirely. Three baselines per row, three of seven rows broken. Worse at 360, where "Half PPR" also wraps under its own floating ⓘ | `src/league-room/components/league-terms-panel.tsx` | The value and its ⓘ share one inline baseline; the guided note drops to its own line below (or the row becomes a two-column grid); add a rendered-geometry test that asserts label and value share a baseline in BOTH help levels |
| D2 | DEFECT | HIGH | `already-member` is a designed state that can never be a landing. `stateFor` maps only `ok → open`, so a member re-opening their own invite link gets the full terms and an ink pill reading "Join {league}" — **verified live as the league's own commissioner** (`j6`) — and learns the truth only after pressing it and spending an API write (`j17`). The page already holds both the user and the league; nothing has to be guessed | `src/app/app/(public)/join/[code]/page.tsx` | Resolve membership server-side in `stateFor` and land the "Already a member" panel on first paint; keep the client transition as the race fallback |
| D3 | DEFECT | HIGH | `CreateLeagueForm` pins **every** server refusal to the League name field (`error={error ?? undefined}` on the `<Input>`). Verified live with `POST /api/leagues` aborted: the name input goes `aria-invalid="true"` and is `aria-describedby` a message reading "We could not reach the server. Check your connection and try again." A screen-reader user is told a valid league name is invalid because the network dropped — and the same shape would pin the creation gate's own tier refusal ("Open it to everyone instead") to a field that is not the problem. `MockSetupForm` and `JoinForm` both already render their error as an independent `role="alert"` paragraph | `src/league-room/components/create-league-form.tsx` | Field errors stay on the field; every other refusal becomes a `role="alert"` paragraph above the submit, the spelling the other two forms already use |
| D4 | DEFECT (design law) | MEDIUM | `SeatMeter`'s unfilled track is invisible in dark: `surfaceInset` on `surface` computes **1.03:1** and on `surfaceElevated` **1.04:1** (arithmetic from `tokens.ts`; light is 1.13:1). The v3 mock's segment bar — rule 1's entire money spend — therefore renders as one green dash with no visible extent on the invite landing, the hold page and every league row (`j15`), so "of 12" is carried only by the sentence beside it and the bar communicates nothing | `src/components/ui/seat-meter.tsx`, `src/design/tokens.ts` | Give the unfilled segment a role that clears a visible floor against both grounds (a `line`-weight track, or an `edge`-derived tint), and add it to `tokens.test.ts`'s band matrix as a non-text visual-boundary check |
| D5 | DEFECT (design law) | LOW | Rule 5 broken on the product's first signed-in view: **two ink pills** on the first-run panel — "Save" (profile card) and "Create league" (start-a-league card) — measured at both 1440 and 360 | `src/league-room/components/first-run-panel.tsx` | The panel owns the budget: one ink action for the whole view (Save goes quiet, or the profile card does), with a component test asserting at most one ink pill per rendered first-run panel |
| E1 | EXECUTION | HIGH | **The real creation form does not hold the mock setup form's bar** (the founder's own question). Measured at 1440 on `/app`: "League name" input **1,310 × 40**, "Create league" ink pill **1,310 × 40** (32.8:1 — the lobby review's E1 defect, unfixed here), the "Try a mock draft" quiet pill also 1,310 × 40, and the two promoted selects **649px each** to hold "Invite only" and "Open to everyone". `MockSetupForm` answered this exact question on 2026-08-26: `max-w-2xl`, three `EYEBROW` groups (Room · Rules · You), and `className="self-start"` on the submit so it stays a pill | `create-league-form.tsx` | Give the form the same measure and the same idiom — groups (Name · Who · Rules), submit sized to its label, drawer inside the measure |
| E2 | EXECUTION | HIGH | First-run leads with a form, not a pick. The headline says "Pick how you want to get started." and then **600px (1440) / 940px (360)** of profile form — an eight-tile avatar grid, display name, experience select, Save — before the first path. At 360 the entire first viewport is an avatar picker and all four paths are below the fold (document 2,180px). And the Experience select in that card is the very input `firstRunPathOrder` uses to order the paths below it, which do not reorder when it changes | `first-run-panel.tsx`, `src/identity/first-run.ts` | Paths first, profile as a quiet aside or a second step; if experience must be asked, ask it as one question at the top and let the order actually respond |
| E3 | EXECUTION | HIGH | Rule 4 broken by construction in the one place a brand-new account is guaranteed to land: the first-run panel is **five stacked `Card` boxes**, 1,502px at 1440 and 2,180px at 360 — the card stack the founder overturned on 2026-08-24 ("horizontal row elements instead of these cards - my eyes don't know where to focus") and the lobby review's own D2, whose answer already exists in this repo as `LEAGUE_ROW_GRID` + `LeagueRowsHeader` | `first-run-panel.tsx` | Hairline-separated sections under one eyebrow, or a two-column composition at `lg`+; zero per-path boxes |
| E4 | EXECUTION | MEDIUM | The hold interstitial shows a stranger **no league terms at all** — name, seat meter, one start-timing line, a ten-minute clock, and a sign-in button. No format, no scoring, no roster, no stake, no commissioner. The *invite* path (a link from a friend, the lower-trust-required case) shows all seven; the *public shelf* path (a stranger claiming a stranger's seat, and the path that will carry an entry fee the day money goes live) shows none, while a countdown pressures them to decide | `src/app/join/[leagueId]/hold/page.tsx` | Render `LeagueTermsPanel` (or its short form) above the hold panel — `publicLeaguePreview` already carries more than this page prints |
| E5 | EXECUTION | MEDIUM | The hold clock never goes hot: `SeatHoldPanel` renders `<Countdown size="xl">` with no `tone`, so a hold at 0:20 reads exactly as calm as one at 10:00 — rule 1 puts clocks in the live family, and the composition pass already solved this shape for the TV board (`spotlightClockTone`, time-hot inside the final 30s). It is also the largest type on the page, louder than the league name it belongs to | `src/league-room/components/seat-hold-panel.tsx` | Reuse the time-based hot threshold; consider `size="lg"` so the clock stops outranking the league |
| E6 | EXECUTION | MEDIUM | The league name appears **three times inside 260px** on the hold page — the `<h1>`, the `Panel` title, and again inside "We are holding a seat for you in {name} while you sign in." — plus a fourth in the sign-in button's accessible name | `hold/page.tsx`, `seat-hold-panel.tsx` | The `<h1>` names the league once; the panel says "Seat held" and the sentence says "for you", not the name again |
| E7 | EXECUTION | MEDIUM | One fact, two polite announcements: `Countdown`'s own `aria-live` sibling says "About 10 minutes left" and the `role="status"` paragraph directly beneath it says "Your hold expires in 10 minutes." A screen-reader user hears the same remaining time twice at every boundary | `seat-hold-panel.tsx` | Keep `Countdown`'s built-in coarse sibling and make the visible line a plain `<p>`, or drop the visible line entirely |
| E8 | EXECUTION | MEDIUM | The dead-code landing spends nothing. All three refusals (`invalid`/`expired`/`exhausted`) render one dashed `border-line` box whose only action is a 13.5px underlined "Browse open leagues" — **zero ink pills in the view** — while the `<h1>` above it still reads "Join a league". For a signed-out stranger holding a broken link this is the entire funnel recovery | `src/league-room/components/invite-landing.tsx` | The recovery action becomes the view's one ink pill; the page title stops promising the act the panel is refusing |
| E9 | EXECUTION | MEDIUM | The invite landing's desktop composition: `max-w-md` (measured `<main>` 448px, card 416px) centered in 1440px — 69% empty ground, document exactly one viewport tall. Every other public surface in this product is a full-bleed frame, and the one live fact this page owns (seats filling) is a 96px sliver inside a definition list | `src/app/app/(public)/join/[code]/page.tsx` | Compose for the width it has: the decision column beside the league's own facts, seats as a real meter rather than a `<dl>` row — one-column stack unchanged below `lg` |
| E10 | EXECUTION | MEDIUM | UTC on the stranger's first screen: "Thursday 3 September, 1:55 PM UTC (in 7 days)" on the invite landing, and the same formatter prints "Friday 28 August, 1:59 AM UTC (in 12 hours)" on the shelf (`j15`). A person deciding whether to join a league is asked to do timezone arithmetic | the shared draft-time formatter (product-wide, surfaces here) | Render in the viewer's own zone with the coarse "(in 7 days)" clause kept as the honest fallback |
| E11 | EXECUTION | MEDIUM | The safety net is on the wrong path. C3's sentence ("The room picks for you from your queue if your clock runs out.") renders on the hold interstitial but **nowhere on the invite landing**, so a first-timer joining a friend's league that drafts in seven days is never told what happens if they miss it — the exact question that path invites, asked at the exact moment they are deciding | `invite-landing.tsx` | Quote the phrase verbatim beside the draft row, the same way the hold panel already does |
| E12 | EXECUTION | LOW | The Stake row says one thing twice and uses a word strangers will misread: the guided ⓘ line "A label for how competitive a league is. No money changes hands." sits directly above `stakeDisclosure`'s "Stake tiers are labels only in this preview. No money changes hands." — "No money changes hands" twice in 40px, and "preview" is product-internal (a visitor reads it as a preview of *this league*) | `league-terms-panel.tsx`, `MATCHMAKING_CONFIG.stakeDisclosure` | One sentence at the control, said once; replace "in this preview" with what is actually true this season |
| E13 | EXECUTION | LOW | The advanced drawer steps the column sideways: outer form fields sit at x=97, the drawer's own fields at x=110 (the `<details>`' `p-3`), so opening it shifts every control 13px right | `create-league-form.tsx` | The drawer's inner grid aligns to the form's own column |
| E14 | EXECUTION | LOW | The ink pill restates the heading above it: "Join Ive Review Invite League" sits 12px under an `<h2>` reading "Ive Review Invite League", and at 416px wide it is a bar, not a pill | `join-form.tsx` | "Join this league" (the league is named directly above), sized to its label |
| E15 | EXECUTION | LOW | A leagueless account's league rail is a 64px column holding one 32px "+" tile and nothing else, standing beside a page that already IS create, join and browse | `src/components/app-shell/app-shell.tsx` | Collapse the rail entirely while `firstRunPlan` is non-null |
| R1 | DIRECTION | HIGH (for 4.5) | **The invite landing never sells and offers no second door.** It is a terms table and a button. It does not say the league is free, does not name a time commitment beyond one sentence, and if the visitor decides no, the only exit is the footer. The `practice` path — the thing Phase 4.5 built to convert exactly this person — is invisible on the one public page a friend-of-a-member actually lands on, and `PracticeEntryLink` already exists signed-out-capable | `invite-landing.tsx`, `practice-entry-link.tsx` | One vetted promise sentence beside the terms, and a quiet "not sure yet — try a mock draft first" exit that keeps the code in the URL |
| R2 | DIRECTION | HIGH (for 4.5) | **Five of nine designed states never render as a landing, and three can never render at all.** `draft-started` and `tier-refused` are unreachable on the invite path by its own precondition (`join-form.tsx`'s docblock says so outright); `already-member` and `league-full` are client-only (D2). The nine-state story is really a four-state page carrying five branches for a door that has not grown the checks | `invite-landing.tsx`, `join/[code]/page.tsx` | Decide once: promote the SSR-decidable states into `stateFor`, and either wire the two the invite door cannot reach or delete them with the reasoning recorded |
| R3 | DIRECTION | — | The first-run panel should not be five cards; it should be the row shelf this product already owns, or a two-column composition — the pick left, the profile a quiet aside right — so the headline's promise ("Pick how you want to get started") is followed by picks rather than by a form. Mock both against the founder's row-shelf ruling before choosing | `first-run-panel.tsx` | Mock shelf-idiom vs two-column at 1440 and 360 before building |
| R4 | DIRECTION | — | No wire anywhere in the funnel. `Wire` serves the front door and `MockWire` proved the signed-in sibling; the invite landing is where a real, honest line ("this league filled 4 minutes ago", "3 mocks running now") would do the most work, and it renders a static table instead. Same honesty contract, third surface | `invite-landing.tsx`, `src/league-service/wire.ts` | Design an invite-landing wire line against the existing request-time/real-or-nothing/actor-free contract |
| R5 | DIRECTION | — | The hold interstitial claims a real seat **on mount**, for anyone or anything that opens the URL — a link preview, a prefetch, a crawler, a curious tab. Ten minutes of a twelve-seat league is a real cost. Recorded as a question, not a defect: the interstitial's whole premise is that the seat is safe during sign-in | `seat-hold-panel.tsx` | Decide whether the claim waits for an intent gesture, and record the ruling either way |

Counts: **5 DEFECT · 15 EXECUTION · 5 DIRECTION.**

## The per-state walk

Shots referenced by filename in the scratchpad `revC-join/` directory.

**S1 · Open invite, signed out, 1440 dark (`j1`).** The bones are right: slim `PublicBar`, one
`<h1>`, one honest sentence about what joining means, the terms, one ink pill, the four trust
links. Then you look at the terms and the panel is debris — the ⓘ hovering above "Snake", the
word "Stake" alone on its own line with "Free" 40px below it and to the right, the Scoring row
doing the same, three baselines competing in every annotated row (D1). This is the render every
signed-out stranger gets, by construction. Beside that: the draft time is in UTC (E10), "No money
changes hands" is printed twice (E12), the seat bar is a 96px sliver with an invisible track (D4),
and 992px of the screen is empty ground (E9).

**S2 · Open invite, 360 dark (`j2`).** The same faults, louder. "Half PPR" wraps to two lines under
its own floating ⓘ; the UTC draft line wraps to two. No horizontal overflow (scrollWidth 360),
document 936px — the page is at least honest about its size. The stacked card reads acceptably;
the definition list does not.

**S3 · Open invite, light 1440 (`j3`).** Structurally identical, same faults. Light does not
rescue the meter (1.13:1) and does not fix the baselines.

**S4 · Open invite, signed in as a non-member (`j4`, `j5`).** The one genuinely correct landing in
the cluster: terms, then one ink pill, "Join {league}". Still guided, so still broken (D1), and
the pill restates the heading above it (E14).

**S5 · Open invite, signed in as the league's own commissioner (`j6`).** The page offers the
commissioner an ink pill to join the league he commissions. Pressing it does the right thing
(`j17`: "Already a member", one ink pill to the league) — after a write, and after the screen
told him something false (D2).

**S6 · Dead code, signed out and signed in (`j7`, `j8`).** A dashed box, an alert triangle, one
true sentence, and a 13.5px underlined link — under an `<h1>` that still says "Join a league".
Zero ink actions in the view (E8). It is not a dead end, but it is the least the product could
have done at the moment it most needs to convert.

**S7 · Hold interstitial, signed out, 1440 (`j9`).** The strongest single element in the cluster is
here: a 9:31 in huge mono over "Your hold expires in 10 minutes." over the safety net quoted
verbatim, with one ink pill. It works. What surrounds it does not: the league is named three
times (E6), the terms are named zero times (E4), the clock never goes hot (E5), the coarse time
is announced twice (E7), and the seat meter above it is a green dash on an invisible track (D4).

**S8 · Hold interstitial, 360 (`j10`).** Holds up — 740px, no overflow, the clock still the hero.
The same four faults.

**S9 · First run, leagueless account, 1440 (`j11`, `j14`).** "Pick how you want to get started."
followed by 600px of profile form, then four bordered cards, 1,502px total (1,781 with the drawer
open). Two ink pills (D5). Every control is full-bleed — a 1,310px input for a league name, a
1,310 × 40 "Create league" bar, a 1,310 × 40 "Try a mock draft" bar, 649px selects holding two
words (E1). The only color on a new manager's first screen is the avatar picker's decorative
green and red.

**S10 · First run, 360 (`j12`).** 2,180px. The first viewport is entirely an avatar grid. Every
path a new manager could pick is below the fold (E2).

**S11 · Creation with the API aborted (`j16`).** "We could not reach the server. Check your
connection and try again." rendered as a validation error on the League name field, with
`aria-invalid="true"` (D3).

## The stranger's first thirty seconds

Her friend texts her a link. Seconds 0–5: a dark, serious page, "Join a league", one sentence that
tells her exactly what she is agreeing to — this is the register working, and it is better than
what most of this category shows a newcomer. Seconds 5–15: she reads the terms and they are
scrambled — a circled ⓘ floating in space above the word "Snake", "Stake" stranded on a line by
itself, an explanation of half-PPR set at a baseline that belongs to nothing (D1). She is not
going to name the defect; she is going to feel that this was not finished. Seconds 15–25: she
finds "Thursday 3 September, 1:55 PM UTC" and does not know when that is (E10), reads that no
money changes hands twice (E12), and sees a seat count with a bar that shows one dash and no
whole (D4). Seconds 25–30: she is not sure. There is nothing on this page for "not sure" — no
free mock draft, no browse, no promise, no second door; the only exit is the footer (R1). She
taps Sign in or she leaves. If she is instead already a member — the friend forwarded the link a
second time — the product invites her to join something she is already in (D2).

Fix D1 and E10 and the first fifteen seconds become what the words already deserve. Add R1 and
the thirty-second exit stops being the browser's back button.

## Prioritized remediation

**Before this funnel meets strangers (the compact fix pass):**
1. **D1** — the terms panel's baselines, in both help levels, with a geometry test.
2. **D2** — resolve membership server-side; land the right panel on first paint.
3. **D3** — creation errors leave the League name field.
4. **E1** — the creation form gets `MockSetupForm`'s measure, groups and pill.
5. **D5** — one ink pill on the first-run view.
6. **E10, E11, E12** — the three copy fixes riding the same pass (local time, the safety net on
   the invite path, the doubled stake sentence).
7. **D4** — the seat meter's track becomes visible in both themes.

**After (the composition pass, in order of leverage):**
1. **R1** — the invite landing sells and offers the practice door.
2. **E2 + E3 + R3** — first run recomposed: picks first, no card stack.
3. **E4 + E5 + E6 + E7** — the hold interstitial composed as a decision screen: terms, one hot
   clock, one name, one announcement.
4. **E8, E9** — the dead-code recovery earns an ink action; the landing earns its width.
5. **R2** — the nine-state model resolved to what the door can actually reach.
6. **R4** — a wire line on the invite landing.
7. **E13, E14, E15** — the three alignment and chrome cleanups.
8. **R5** — the on-mount seat claim ruled on, either way.

---

*Method footnote: all states driven against the running app with real Postgres; the two leagues
and two invite codes were created through the product's own routes and no seeded data was read
destructively or deleted. Geometry and ARIA wiring were measured in Chromium only (the installed
engine); the contrast figures in D4 are arithmetic from `src/design/tokens.ts` and are
engine-independent. D3 was reproduced by aborting `POST /api/leagues` at the browser, which
exercises the component's own `catch` branch exactly as a real connection drop would.*
