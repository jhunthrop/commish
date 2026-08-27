# The self surfaces — first design review (2026-08-27)

The cluster nobody has ever looked at: `/app/profile` (the account room), `/app/wallet` (money
dark), `/sign-in/problem`, `/support`, `/reviews`, and the notices chrome the top bar carries on
every signed-in page. These are the surfaces a member reaches when the product is about *them*
rather than about a league — the identity room, the money room, and the two rooms people arrive
in with their pulse already up. Design v3 swept them as "retone only" (`docs/design-system.md`,
"Signed-in surfaces and the draft room: retone only", quoting the 2026-08-24 audit's own
diagnosis that "the signed-in board, draft room, and profile already mostly hold the bar"). That
diagnosis was made from the code, not from the rendered page. This is the composition review the
self surfaces never had, judged against the six rules and the founder's bar verbatim: "most
premium experience in the fantasy world... sleek, modern, beautifully simplistic but high
information density... maximize full screen width... best app I've ever seen or used."

## Method

Judged the real running product, not the code's intentions: the live app at `localhost:3102`
against the seeded database, driven with Playwright (Chromium 1.62.1) as `manager-a` (a session
with 20 real notices, a posted review, veteran standing) and signed out where the surface is
signed-out reachable. Six routes × two themes × 1440/360, plus 2000px on the two `(shell)` pages
for the density read, plus the notices panel opened at 1440 and 360, plus computed-style probes
for the claims a screenshot cannot settle (fill contrast, ink-pill counts, panel scroll extents,
dismissal behavior). Both themes were driven two ways at once — OS `colorScheme` and the stored
`commish.theme` preference — so the theme switcher's own resolution was exercised, not assumed.
No source file changed, no server started or stopped, no row written. Shots and probes (this
machine):
`/private/tmp/claude-501/-Users-jh-code-fantasy/d1b45147-2ef6-4dae-8e60-c0a2d552f0c5/scratchpad/revD-shots/`.
Artifacts to discount when reading them: seeded league names carry unix-ms suffixes ("E2E League
1787521484162"), the seeded review is a deliberate 1-star, and "51 seasons finished on Commish"
is fixture data, not a design claim.

## Executive verdict

The words on these surfaces are the best writing in the product — "Nothing about your account
changed," "WorkOS manages your sign-in, not Commish," "Real-money play is not available yet" —
and the discipline behind them (no fake balances, no disabled inputs pretending to be controls,
no invented support timeline) is exactly the honesty the founder's bar is built on. But nothing
here has been *composed*: the account room is four bordered boxes and two forms floating in a
half-empty 2000px page with 940px-wide text fields, the member's own place says nothing about the
member, and the wallet — the surface where honesty is the whole product — is one sentence in a
1340px box on a route that is linked from nowhere in the entire codebase. Three laws break by
construction: two ink pills sit on `/app/profile` at every width in both themes, the theme
switcher's selected chip measures 1.00:1 against its own panel in both themes (the control that
embodies the both-themes ruling cannot show which theme is chosen), and green — the pigment
reserved for money — appears twenty-one times on the profile page without once meaning money. The
notices chrome is the clearest signal-to-noise failure in the product: twenty rows, nineteen of
them the same sentence, each carrying the same "What is your draft queue?" help trigger — nineteen
identical help buttons and zero close buttons, in a 384px window over 3,561px of content that a
phone tap outside will not dismiss. Fix the seven defects and the color grammar before mock drafts
put strangers on these pages; the move from "honest" to "the member's own place" is the direction
work listed last.

## Findings

| # | Class | Sev | Finding | File | Remediation (one line) |
|---|---|---|---|---|---|
| D1 | DEFECT | HIGH | `/app/wallet` is reachable only by typing the URL: a repo-wide sweep finds **zero** links to it — not in `TopBar`, not in `LeagueRail`, not on `/app/profile`; the only occurrences of the path in `src/` are docblock prose. The product's one money surface has no door | `src/components/app-shell/top-bar.tsx`, `league-rail.tsx` | Give the wallet a real entry (top-bar item or an account-room row), and an e2e assertion that every `(shell)` route is reachable by clicking |
| D2 | DEFECT (design law) | HIGH | Rule 5 broken by construction on the account room: `ProfileForm`'s "Save" and `ReviewComposer`'s "Save changes" both render `variant="primary"` — two ink pills in one view, verified by computed class sweep at 1440 and 360 in both themes | `src/account-room/components/profile-form.tsx`, `review-composer.tsx` | One ink action per view: the review composer's submit becomes `secondary` (or the two forms stop sharing a view); add the "at most one ink pill" component assertion the shelf already carries |
| D3 | DEFECT (design law) | HIGH | The theme switcher's selected chip is `bg-surface-elevated` **inside a `Panel`, which is a `Card`, which is `bg-surface-elevated`** — measured identical in both themes (dark `rgb(22,22,25)` on `rgb(22,22,25)`, light `rgb(255,255,255)` on `rgb(255,255,255)`, 1.00:1). Selection is carried by text color alone, on the one control that exists to make the both-themes founder ruling real | `src/account-room/components/theme-switcher.tsx` | Selected chip moves to `bg-surface-raised` (a real depth step against a panel) plus a `border-edge`; add a component test asserting the checked option's fill differs from its container in both themes |
| D4 | DEFECT (honesty) | MEDIUM | The inbox badge states an exact number it cannot know: `unreadCount` is computed from the same 20-row capped page (`notices.filter(readAt === null).length`, over `listNotices`' `.limit(inboxSize)`), so it silently saturates. The seeded account renders the literal ambiguous case: "Notices, 20 unread" | `src/integrity-service/notify.ts` (`listNotices`), `src/components/app-shell/notices-provider.tsx` | Count unread with its own `COUNT(*)`, or render "20+" and say so — the panel is already honest about the cap ("Your last 20 notices."), the badge is not |
| D5 | DEFECT | HIGH (mobile) | The notices panel cannot be dismissed by tapping outside it (`aria-expanded` verified still `true` after a tap 300px below the panel at 360px), has no close control, and no visible title — its only dismissal paths are Escape (no key on a phone) and re-finding the 30px inbox icon. A `role="region"` overlay that a touch user cannot close is a trap | `src/account-room/components/notice-inbox.tsx` | Add outside-pointerdown dismissal and a visible close control in a real panel header ("Notices ×"), keeping Escape and focus-return as they are |
| D6 | DEFECT (copy) | MEDIUM | "Your experience **above** sets this for you" is false at every desktop width: at `lg`+ the Experience control is in the LEFT column, beside the Preferences panel, not above it. The sentence is only true at 360 | `src/app/app/(shell)/profile/page.tsx` (Preferences panel) | Name the control instead of its position ("Your experience setting sets this for you"), the same discipline `describeStartTiming` applies to timing sentences |
| D7 | DEFECT | MEDIUM | `SignInLink` renders a plain `<Link>` to `/sign-in`, which is a **redirecting route handler**, so Next prefetches it: loading `/support` or `/sign-in/problem` fires a real WorkOS authorize-URL generation and logs a CSP violation plus a "Failed to fetch RSC payload" error to the console, on every public page load. Reproduced on all four signed-out shots | `src/components/app-shell/sign-in-link.tsx` | `prefetch={false}` on the one component that spells sign-in (a route handler is never worth prefetching); assert a clean console on the public pages in e2e |
| E1 | EXECUTION | HIGH | The account room does not compose at width, it stretches: at 2000px the "Display name" field is 940px wide for an 11-character name, the three-option Experience `<select>` is 940px, each Notifications row puts its badge 900px from its title, and ~45% of the page is empty ground. At 1440 the entire lower-right quadrant is void. "Maximize full screen width" is the bar; this is width consumed, not used | `src/app/app/(shell)/profile/page.tsx` | Cap control width to the data (a name field is not a paragraph), and use the freed column: standing, notices and review belong in the composition, not stacked in one lane |
| E2 | EXECUTION | HIGH | The inbox is noise by construction: 20 rows, **19 of them the same title** ("We made your pick for you"), each rendering the same `InfoTip term="queue"` — the open panel contains nineteen identical "What is your draft queue?" buttons and zero close buttons, in a 384px window over 3,561px of content (9.3 internal screens on a phone). No grouping, no dedupe, no per-league collapse | `src/account-room/components/notice-inbox.tsx` (`NoticeRow`) | Group repeats by type+league ("We made 6 picks for you in E2E League"), show the tip once per group, and let the panel grow with the viewport instead of a fixed `max-h-96` |
| E3 | EXECUTION | MEDIUM | Notices are timestamped with raw `new Date().toLocaleString()` — "8/27/2026, 8:59:04 AM", seconds included — against a product whose standing idiom is `formatCoarseDuration` and whose wire contract explicitly chooses coarse durations because they stay true. The most machine-looking type in the product sits in its most personal panel | `src/account-room/components/notice-inbox.tsx` (`formatNoticeDate`) | Coarse relative time ("about 3 hours ago") via the existing helper, exact time in the `<time>` element's `title`/`dateTime` |
| E4 | EXECUTION (design law) | HIGH | Rule 1 broken across the self surfaces: a computed sweep of `/app/profile` finds **21 green objects and not one of them is money** — five identical "In the app" badges (every row, same word, zero information), "Veteran", "Verified", the unread-count badge, thirteen rail crest tiles, and the review link. Green is the product's scarcest pigment and the member's own page spends it on furniture | `notification-summary.tsx`, `standing-panel.tsx`, `notice-inbox.tsx`, `avatar.tsx` | Channel badges become quiet text (or vanish while there is only one channel); "Veteran"/"Verified"/the unread count go neutral or ink; keep green for money and seats filling |
| E5 | EXECUTION | MEDIUM | `AVATAR_TONE_CLASS` fills identity tiles with `bg-accent` and `bg-negative` at **full semantic saturation** — the one pigment family LED-2's desaturation ruling never reached (position stickers were re-derived at 60% saturation for exactly this reason). A member who picks "Flame" wears the product's destructive/live red as their identity, and the signed-in rail is a 20-tile column of money-green and live-red blocks down the left edge of every page in this cluster — loudest of all in light theme | `src/components/ui/avatar.tsx` (`AVATAR_TONE_CLASS`), `crest.tsx` | Re-derive the avatar/crest tones the way the position pigments were re-derived (same hue family, dialed down), and revisit `avatar.tsx`'s accent-fill allowlist entry, whose stated rationale ("green fills something that *means* money") an avatar does not meet |
| E6 | EXECUTION | MEDIUM | `/sign-in/problem` pins its `max-w-md` column to the top of the viewport with the footer riding up immediately behind it and ~660px of empty ground below at 1440×900. The one page a person reaches while locked out of their own account is the least composed screen in the product: it reads as content that failed to finish loading | `src/app/sign-in/problem/page.tsx` | Center the recovery column in the viewport (`min-h-dvh` grid, footer pinned to the bottom) — composure is the whole job of a page somebody lands on angry |
| E7 | EXECUTION | MEDIUM | The same destination appears twice on the recovery page: `PublicBar`'s top-right "Sign in" and the page's own "Try again" ink pill both go to `/sign-in`. The chrome competes with the one action the page exists to offer | `src/app/sign-in/problem/page.tsx` | Render `PublicBar` without its sign-in link on this page (wordmark only), so "Try again" is the only sign-in on screen |
| E8 | EXECUTION | HIGH | `/support` is seven undifferentiated paragraphs, every one of them `text-text-muted` at the same size and weight, with no headings, no answer-first ordering and no action. The thing a stressed reader actually needs — *the two things you can report, and where* — is paragraph four; paragraph five is a prose list of features that do not exist. This is the stress page that most lowers pulse | `src/app/support/page.tsx` | Restructure answer-first with real subheadings ("How to reach an operator" / "What happens next" / "What we do not offer yet"), body text at `text-text-primary`, and a link into `/reviews` and the league chat where reporting actually happens |
| E9 | EXECUTION | MEDIUM | On `/reviews` the "Report" link right-aligns to the far edge of a full-bleed frame — measured ~1,300px from the review it belongs to at 1440 (worse at 2000) — while the review body sits at `max-w-prose` on the left. `docs/design-system.md` records E9's fix as "contains the whole review row, Report right-aligned inside it"; the containment is in the DOM but not in the eye | `src/account-room/components/review-feed.tsx` | Bound the review row to its own reading measure so the report affordance lands beside the content it reports |
| E10 | EXECUTION | MEDIUM | Rule 4 ("hairlines, not boxes") loses on the account room: the right column is four rounded, bordered, shadowed `Card`s stacked in a wide empty page. In dark the borders nearly vanish and the boxes read as unmoored; in light `#E8E8EA` on `#FBFBFA` reads as four literal boxes. The four-depth model exists precisely so a panel does not have to draw a line around itself | `src/components/ui/panel.tsx` consumers on `profile/page.tsx` | Consider a `Panel` variant that separates by hairline + depth rather than a full card border on surfaces that stack three or more of them |
| E11 | EXECUTION | LOW | The "Leave a review" section speaks a different register from every block above it: an `h2` at `text-lg font-semibold` beside four mono sentence-case `EYEBROW` panel labels, with no hairline and no container | `src/app/app/(shell)/profile/page.tsx` | Route it through `Panel` like its siblings, or give the other three sections the same free-standing register — one page, one register |
| E12 | EXECUTION | LOW | The signed-in rail's crest column clips mid-tile at the viewport floor (a half-drawn "EL" at 957px) with no scroll affordance and no count — visible on every surface in this cluster | `src/components/app-shell/league-rail.tsx` | Fade or bound the column's last row and give it an internal scroll affordance, the discipline the room's own scrolling regions already carry |
| R1 | DIRECTION | HIGH (for 4.5) | **The dark wallet is the product's biggest wasted trust asset.** Today: one `Panel`, one 12-word sentence, stretched to 1340px, on a route nobody can reach, with no action — a dead end on a surface whose entire subject is "we are not taking your money." `docs/money.md`'s free-season law is a genuinely differentiating story (every league free, no money touched, nothing to charge back) and the wallet says none of it. Never-a-dead-end is a stated principle this page breaks | `src/app/app/(shell)/wallet/wallet-content.tsx` | Design the honest dark wallet: what you have paid this season (nothing), what your leagues cost (nothing), what the closed loop will and will not do when money turns on, and one real action (browse free leagues) |
| R2 | DIRECTION | — | The account room is a settings dump, not the member's own place: an avatar picker, two form fields, a help dropdown, a notification catalog, a standing panel and a theme control. Nothing on it is about the seasons this person has played — the one fact that is ("51 seasons finished on Commish") is a `meta` line on a panel about join eligibility, and the identity moment is a 48px gray crest above a text input | `src/app/app/(shell)/profile/page.tsx` | Open the room with the member: crest at real scale, name, standing, seasons, leagues, the review they wrote. Settings are what you scroll to, not what greets you |
| R3 | DIRECTION | — | Notices have no life outside the panel: no per-league filter, no grouping, no continuity with the per-league "What the platform did" band, and the panel's own cap sentence is the only navigation the history has. A member who misses a week cannot find out what happened to them | `notice-inbox.tsx`, `src/integrity-service/notify.ts` | A real notices surface (grouped by league, cursored) with the panel as its recent slice |
| R4 | DIRECTION | — | `/reviews` publishes every review unfiltered — the right call, and the page's own best sentence — but says nothing in aggregate: no average, no count, no distribution. A feed that will not state its own score reads as one that is hiding it, which is the opposite of the point | `src/account-room/components/review-feed.tsx` | A quiet aggregate line above the feed (average, count) derived from the same read, real-or-nothing below a floor |
| R5 | DIRECTION | — | `/support` honestly says there is no way to contact an operator. The honest next step is not a paragraph listing absences but a case with a reference number — the dispute queue already exists and already records decisions against cases | `src/app/support/page.tsx`, `src/integrity-service/**` | Scope a support case form onto the existing queue; adjudicate against the burned-skeptic persona before building |
| R6 | DIRECTION | — | The theme switcher — the founder's both-themes ruling made real — is the last panel in the right column of one page a member visits rarely. Taste call, recorded rather than assumed: a chrome-level control may be right, or may be clutter | `src/account-room/components/theme-switcher.tsx`, `top-bar.tsx` | Mock both (account-room only vs. a top-bar control) and adjudicate via personas |

Counts: **7 DEFECT · 12 EXECUTION · 6 DIRECTION.**

## The per-surface walk

Shots referenced by filename in the scratchpad `revD-shots/` directory.

**S1 · `/app/profile`, dark and light, 1440 (`profile--dark-w1440.png`, `--light-w1440`).** The
structure is legible and the copy is excellent — the email block in particular ("This is the email
that identifies your account, visible only to you. Commish cannot change it here. WorkOS manages
your sign-in, not Commish.") is a model of saying what is true and what the reader can do about
it, and refusing to render a disabled input that lies about being a control is exactly right. But
the composition is a form on the left, a stack of boxes on the right, and a review block below
both, with the lower-right quadrant simply empty. Two ink pills anchor the two ends of the page
(D2). Five identical green "In the app" badges march down the Notifications panel saying the same
word five times (E4). The Preferences sentence points "above" at a control that is beside it (D6).
Light theme holds the same structure with the same faults, and turns the rail's crest column into
the loudest object on the page (E5).

**S2 · `/app/profile` at 2000 (`profile--dark-w2000.png`).** The density failure is unmistakable
at width: a 940px text field for an 11-character display name, a 940px select with three options,
a Notifications row whose badge is 900px from its title, and a 1,250px void beside the review
composer. This is the screen that most contradicts "sleek, modern, beautifully simplistic but high
information density" (E1).

**S3 · `/app/profile` at 360 (`profile--dark-w360.png`).** 2,544px of honest single-column
linearization; nothing overflows, nothing shrinks, order is sensible. The Preferences copy is the
one thing that is *only* true here. The best-behaved viewport in the cluster.

**S4 · The notices panel, open (`notices-open--dark-w1440.png`, `--dark-w360`).** The image that
settles the signal-vs-noise question: twenty rows, nineteen of them "We made your pick for you,"
each with its own "What is your draft queue?" tip button, machine timestamps to the second, no
title, no close control, no read/unread mark of any kind — and the badge that was the *only*
unread signal is destroyed by the act of opening (mark-read fires on open). At 360 the panel shows
one and a half notices out of twenty and will not close when you tap the page (D5, E2, E3). The
one thing the panel gets right is the cap sentence: "Your last 20 notices." — honest, and quietly
contradicted by the badge above it (D4).

**S5 · `/app/wallet` (`wallet--dark-w1440.png`, `--dark-w360-vp`).** One sentence in a 1,340px box
above 740px of black at 1440, and 500px of black at 360. The sentence is right and the restraint
is right — no fake balance, no dead form, no "coming soon" theater. But it is a dead end on a page
no link in the product points at, which makes the product's honesty about money invisible by
construction (D1, R1). Light theme is identical in structure.

**S6 · `/support` (`support--dark-w1440.png`, `--dark-w360`).** Seven paragraphs, all muted, all
the same size, no headings, no action. The content is genuinely admirable — it names what does not
exist rather than implying it does — and it is arranged so that a person who arrives upset must
read 250 words before learning what they can actually do. At 360 it is a 1,159px scroll of
identical gray prose (E8).

**S7 · `/sign-in/problem` (`signin-problem--dark-w1440.png`, `--dark-w360`).** The best two
sentences in the cluster ("Something interrupted the attempt. Nothing about your account changed.")
sitting in the worst composition: pinned to the ceiling, footer riding up behind it, two-thirds of
the screen empty below, and the same sign-in destination offered twice (E6, E7). Every load also
logs a CSP violation from the prefetched sign-in route (D7) — the page a person reaches when
something already went wrong is the page that quietly throws two more errors.

**S8 · `/reviews`, signed out and signed in (`reviews-out--dark-w1440.png`,
`reviews-in--light-w1440.png`).** Publishing every review unfiltered, readable signed out, is a
real product conviction and the page's framing sentence earns it. Rendered, it is one review, no
aggregate, and a "Report" link marooned 1,300px to the right of the review it reports (E9, R4).

## The member's worst thirty seconds

He cannot get in. The callback failed and he lands on `/sign-in/problem`: two calm sentences at
the top of an otherwise empty screen, with the footer crowded up behind them — correct words,
posture of a page that gave up. "Try again" works, and he is in. The top bar shows a green pill
reading **20** beside an inbox icon; he taps it, and the badge disappears before he has read a
word — all twenty are now permanently read, and nothing in the panel will ever tell him which ones
he had not seen. Inside: the same sentence nineteen times, each with its own little help button he
did not ask for, timestamped to the second like a log file, in a box that shows one and a half of
them and will not close when he taps the page. He gives up, finds "Commish Lab" in the bar, and
lands on his profile: an avatar picker, his name in a 940px-wide box, five green badges that all
say "In the app," and a sentence telling him his experience setting is "above" when it is beside.
He wants to know whether he has been charged anything this season. There is no wallet link
anywhere on the page, or in the bar, or in the rail — the honest answer exists, at a URL he has no
way to find. He tries `/support`: seven gray paragraphs, and the answer he needs is in the fourth.
Verdict: every sentence he read was true, and not one screen was built for him. The words are
already at the founder's bar; the composition is not on the same page as them.

## Prioritized remediation

**Before mock drafts ship (the compact fix pass):**
1. **D1** — give the wallet a door; add the "every shell route is click-reachable" e2e.
2. **D2** — one ink pill on the account room; add the count assertion.
3. **D3** — the theme switcher's selected chip gets a real depth step, both themes tested.
4. **D5** — outside-tap dismissal and a visible close control on the notices panel.
5. **D4** — the unread count stops claiming a number the cap cannot support.
6. **D6, D7** — the "above" sentence, and `prefetch={false}` on `SignInLink`.
7. **E4** — the green budget: channel badges, standing pills and the unread count go quiet.

**After (the composition pass, in order of leverage):**
1. **R1** — the honest dark wallet, designed as the trust surface it should be.
2. **E2 + E3** — grouped, coarsely-timed notices with a read/unread mark that survives opening.
3. **E8** — `/support` restructured answer-first with real hierarchy and a way onward.
4. **E1 + R2** — the account room composed at width, opening with the member.
5. **E6 + E7** — the recovery page centered and single-actioned.
6. **E5** — avatar/crest tones re-derived, the way the position pigments were.
7. **E9, E10, E11, E12** — the row measure, the box-iness, the register, the rail's floor.
8. **R3, R4, R5, R6** — persona-adjudicated scope and taste calls.

---

*Method footnote: every finding above was observed in the running app at `localhost:3102` against
the shared seeded database as `manager-a`, in Chromium only (the installed engine). The three
measured claims — the theme chip's 1.00:1 fill, the two ink pills, and the notices panel's
384px-over-3,561px extent with 19 tips and 0 close controls — come from computed-style and DOM
probes rather than from reading the screenshots. `/app/wallet`'s orphan status is a repo-wide
grep for the path across `src/` and `e2e/`, not an inference from the chrome I happened to look
at.*
