# UX remediation audit — work-list for design v3 "Sunday Standard"

**Date:** 2026-08-24 · **Audited at:** `main` @ `1f966b1` · **Branch:** `audit/ux-remediation`
**Status:** the founder has approved the v3 direction (no uppercase transforms; one solid action
per view, all others quiet). This document is the remediation work-list: complete inventories with
file paths, per-surface findings, and the token-role consumer map.

**Method:** production build served locally (port 3101, `STATS_PROVIDER=mock`), full-page
screenshots at 1600px and 360px of every signed-out surface (`/`, `/browse`, `/reviews`,
`/league-rules`, `/support`, 404, invalid `/app/join/[code]`; dark, plus light front door);
signed-in surfaces audited from source. Screenshots live **uncommitted** in
`docs/research/ux-audit-shots/` (≈5 MB of PNGs, kept out of history; regenerate with a build +
Playwright at the two widths). All line numbers are against `1f966b1`.

---

## Executive diagnosis

The token system, the copy, and the signed-in shell are genuinely premium; what fails the bar is
the public shelf — the exact surface a stranger and the founder judge first. The front door repeats
one identical, 500px-tall, glossary-annotated card twenty times in a two-column band inside a
centered `max-w-6xl` container, so the page is 5,800px tall at 1600 (13,000px at 360) while using
barely 70% of the screen and never more than two cards of width. Three amplifiers turn repetition
into noise: every league name is forced into 22px uppercase display type, every card carries an
identical green-filled CTA plus green badge plus green links (40+ accent elements on one page), and
every card unconditionally prints the same three glossary definition sentences. The result reads as
a poster wall — loud, repetitive, low-information — when the product's own design language promises
"the room, not the poster." The signed-in board, draft room, and profile already mostly hold the
bar; remediation should aim almost entirely at the card shelf and the public pages around it. v3
"Sunday Standard" legislates exactly the two amplifiers the audit found systemic (uppercase and
accent volume); the inventories below are the sweep list.

---

## Inventory 1 — uppercase / display-face (v3 removes ALL uppercase transforms)

43 `uppercase` occurrences in production code (tests excluded), plus 7 `.toUpperCase()` data
transforms. Grouped by how they are fixed.

### A. Central definitions — one edit each, every consumer inherits

| File:line | What it is | Consumers |
|---|---|---|
| `src/components/ui/config.ts:131` | `EYEBROW` class string (`font-display text-xs font-semibold uppercase tracking-wide`) | **61 uses across 19 files** — room-rail (10), league-terms-panel (9), draft-board (9), slot-preference-panel (4), home-league-card (3), room-dock (3), panel.tsx (3), waiting-checklist, open-league-card, median-result, matchup-scoreboard, matchup-panel, league-home, league-board, attention-queue, advisor-panel, slot-chip.tsx, league-chat, info-tip (2 ea/1 ea) |
| `src/components/ui/stat-pill.tsx:20` | `StatPill` forced-uppercase chip (LIVE/FINAL) | `week-status-badge.tsx` |
| `src/components/ui/position-badge.tsx:48` | `PositionBadge` sticker label | every position render in the product |
| `src/components/ui/crest.tsx:39` | `Crest` two-letter tile | 5 callers |
| `src/components/app-shell/public-bar.tsx:34` | wordmark "COMMISH" | all public pages |
| `src/components/app-shell/top-bar.tsx:81` | wordmark "COMMISH" | all shell pages |

Related, not itself a transform: `src/components/ui/info-tip.tsx:62` is a `normal-case` **reset**
against uppercase label contexts (the `1f966b1` fix). Once contexts are mixed-case it becomes dead
armor — removable, low priority.

### B. Display headings and user content — per-call-site sweep (the amplification)

League/team names and section headers; none of these appear in the v2 mocks or decision record
(`docs/decisions/design-v2.md` contains zero uppercase rulings, and `PageTitle` — the sanctioned
h1 — is mixed-case).

| File:line | Content uppercased |
|---|---|
| `src/app/page.tsx:107` | "Open leagues" section header (`text-lg font-display`) |
| `src/app/page.tsx:118` | "Start your own league" header |
| `src/league-room/components/public-league-list.tsx:80` | "Commish house leagues" shelf header |
| `src/league-room/components/open-league-card.tsx:109` | **league name**, `text-2xl`, every public card |
| `src/league-room/components/home-league-card.tsx:29` | **league name**, `text-2xl`, signed-in card |
| `src/league-room/components/home-board.tsx:85` | league name, pre-draft hero |
| `src/league-room/components/home-board.tsx:229` | league name, n=1 board heading |
| `src/league-room/components/matchup-scoreboard.tsx:29` | **team names**, `text-xl` |
| `src/league-room/components/matchup-panel.tsx:47` | team names, `text-lg` |
| `src/league-room/components/league-terms-panel.tsx:62` | league name, `text-2xl` |
| `src/league-room/components/open-seats-panel.tsx:34` | panel heading, `text-lg` |

### C. Room / TV labels — per-call-site sweep

| File:line | Content |
|---|---|
| `src/draft-room/components/room-rail.tsx:65` | `tv` variant league-name class |
| `src/draft-room/components/room-rail.tsx:272` | turn label ("On the clock") |
| `src/draft-room/components/draft-board.tsx:84` | `tv` variant cell class |
| `src/draft-room/components/draft-board.tsx:306` | "You" marker in board gutter |
| `src/draft-room/components/tv-board.tsx:69` | "Now picking" label |

### D. Hand-rolled eyebrow labels (never used `EYEBROW`) — per-call-site sweep

Three divergent spellings already exist (`font-medium` vs `font-semibold` vs `font-mono font-bold
text-accent`); v3 should route all of these through whatever `EYEBROW` becomes.

| File | Lines |
|---|---|
| `src/app/app/(shell)/admin/queue/[flagId]/page.tsx` | 51, 61, 71, 113, 282, 332, 348, 366, 389 (10 with dup) |
| `src/admin-room/components/held-trade-detail.tsx` | 187, 203, 225, 235 |
| `src/admin-room/components/resolution-form.tsx` | 230 |
| `src/league-room/components/open-league-card.tsx` | 153, 166, 170, 174 (the Drafts/Who/Roster/Playoffs labels) |
| `src/league-room/components/seat-claim-steps.tsx` | 31 (mono, accent-colored step numeral "01 · 10 SEC") |

### E. `.toUpperCase()` data transforms — need a v3 ruling, not a blind sweep

Initials and crest letters are semantically capitals, not styled capitals; flag for the
remediation owner rather than auto-removing:

- `src/components/app-shell/shell-data.ts` (×2 — rail initials, e.g. "Bay Bandits" → "BB")
- `src/components/ui/avatar.tsx` (initials fallback)
- `src/components/app-shell/session-watch.ts` (×1)
- Crest label call sites `league.name.slice(0, 2).toUpperCase()`:
  `src/league-room/components/home-board.tsx:84`, `league-board.tsx:99`, `league-home.tsx`,
  `invite-landing.tsx`

---

## Inventory 2 — accent fills (v3: one solid action per view, all others quiet)

### Solid `bg-accent` fills — 17 occurrences

**Primitives (sanctioned; the one-per-view budget is enforced at call sites, not here):**

| File:line | What |
|---|---|
| `src/components/ui/button.tsx:32` | `Button` variant `primary` |
| `src/components/ui/seat-meter.tsx:48` | seat dots (tiny, quiet — keep) |
| `src/components/ui/meter.tsx:30` | meter fill (sanctioned by "meter fill" rule) |
| `src/components/ui/celebration.tsx:24` | `bg-accent/10` self-tint (translucent, quiet) |
| `src/components/ui/avatar.tsx:41` | avatar preset tone `accent` |
| `src/draft-room/components/budget-table.tsx:62` | `bg-accent/10` my-row tint (translucent) |

**Hand-rolled CTA fills — 11 call sites, each currently a copy-pasted ~200-char class string
(no `ButtonLink` primitive exists; drift already visible between `h-10 px-4` and `px-3 py-1.5`).
These are the "all others quiet" work-list:**

| File:line | Surface | v3 note |
|---|---|---|
| `src/app/page.tsx:92` | front-door nav "Take a seat" | candidate to KEEP the view's one fill |
| `src/league-room/components/open-league-card.tsx:215` | every public card's CTA (~20 fills/page rendered) | quiet — the worst offender |
| `src/league-room/components/seat-hold-panel.tsx:102` | hold confirm | likely keeps its view's fill |
| `src/league-room/components/invite-landing.tsx:159,194` | invite accept CTAs | one of the two per branch keeps it |
| `src/league-room/components/league-board.tsx:120` | `ActionCell` — **one fill per table row** | quiet except needs-you rows |
| `src/league-room/components/home-league-card.tsx:74` | per-card next action | quiet |
| `src/app/sign-in/problem/page.tsx:44` | retry sign-in | keeps (only action) |
| `src/app/not-found.tsx:34` | "Go to the home page" | keeps (primary of two) |
| `src/app/global-error.tsx:43` | reload | keeps (only action) |

Also signed-in: `JoinPublicLeagueButton` renders `Button` primary per card (via
`open-league-card.tsx:208`), same per-card multiplication for signed-in browsers.

### Accent as color (`text-accent`, links, rings) — 42 files

Full list in the appendix. The rendered compounding on the front door at `1f966b1`: ~21 filled
buttons + ~6 green outline badges (`Badge tone="accent"`, `open-league-card.tsx:115`) + ~20 green
underlined links ("Browse leagues open to everyone", `open-league-card.tsx:196`) + 3 green mono
step numerals (`seat-claim-steps.tsx:31`) + green seat dots + nav's green "Sign in" link
(`public-bar.tsx`) = **40+ accent elements in one scroll**. The one-per-view rule plus mixed-case
sweeps this to single digits without touching a token.

---

## Inventory 3 — glow / shadow / effect usage

| Kind | File:line | What | v3 disposition guess |
|---|---|---|---|
| Glow ring | `src/components/ui/badge.tsx:27` | `glow` prop → `ring-2 ring-accent-glow` | the only `accentGlow` consumer; quiet-by-default fits v3 |
| Glow ring | `src/components/ui/badge.tsx:28` | `glow` prop → `ring-2 ring-warning-glow` | ditto (`warningGlow`) |
| Glow consumer | `src/league-room/components/week-status-badge.tsx:26` | `StatPill glow` when week in progress | review under v3 |
| Decorative ring | `src/draft-room/components/draft-board.tsx:207` | on-the-clock cell `ring-2 ring-accent` + `animate-spotlight` breath | the draft room's live signal — likely keeps |
| Decorative ring | `src/draft-room/components/draft-board.tsx:298` | my-column header `ring-2 ring-accent text-accent` | review |
| Decorative ring | `src/league-room/components/home-league-card.tsx:23` | draft-live card `ring-2 ring-accent` | review (paired with visible badge) |
| Hover glow-ish | `hover:brightness-110` in **10 files** | every hand-rolled CTA + `Button` | dies with the `ButtonLink` extraction |
| Shadow | `shadow-card` ×7: `card.tsx:9`, `modal.tsx:85`, `toast.tsx:63`, `notice-inbox.tsx:125`, `tv-board.tsx:66`, `held-trade-banner.tsx:22`, `league-home.tsx:177` | paper lift | token-level; retune in `tokens.ts` if v3 changes depth |
| Shadow | `shadow-sticker`: `sticker.tsx`, `draft-board.tsx` | sticker lift | ditto |
| Animation | `celebration.tsx:23` (`animate-celebrate-self/peer`), `draft-board.tsx:178,207` (`sticker-slap`, `spotlight`), `skeleton.tsx:20` + `app-shell-skeleton.tsx:18` (`animate-pulse`), `button.tsx:58` (`animate-spin` loader), `live-state-pill.tsx:53` (flame pulse) | the four sanctioned animations + loaders | no neon loops found — clean |

No `blur`, no `drop-shadow`, no gradient utilities in feature code (checked); the "neon" reading
of the current product comes from accent *volume*, not from effect classes.

---

## Per-surface findings

Severity: **DEFECT** = objectively broken · **EXECUTION** = misuse/amplification of the language ·
**DIRECTION (resolved by v3)** = the old language produced it; noted with what remediation still
has to physically change.

### Front door `/` and `/browse` (shared shelf)

| # | Sev | Where | Finding | Remediation |
|---|---|---|---|---|
| F1 | DEFECT | `open-league-card.tsx:127–147` | Every term after the first renders a **leading** "·" at line start ("· HALF PPR", "· STANDARD") — NEW-3 folded the separator into stacked lines where it separates nothing; reads as a typo on every card at both widths | Delete the `·` spans; the column is the separation |
| F2 | DEFECT | `public-league-list.tsx:80–83` | "COMMISH HOUSE LEAGUES ⓘ" heading's guided caption wraps beneath as a 280px floating fragment indented to the heading's text-width — mid-page text attached to nothing | Caption becomes a normal full-row muted sentence under the heading |
| F3 | DIRECTION — resolved by v3 (density rule) | `open-league-card.tsx:21`, `public-league-list.tsx:16` | `CARD_HELP_LEVEL`/`BROWSE_HELP_LEVEL = "guided"` unconditionally → the same 2–3 glossary sentences printed on all ~20 cards (~50 repeated sentences/page) | Physical change: two constants → `"standard"`, plus one per-page legend row if v3 keeps first-timer guidance |
| F4 | DIRECTION — resolved by v3 (one solid action per view) | `open-league-card.tsx:215`, `page.tsx:92` | ~21 identical green-filled "Take a seat" CTAs per page | Physical change: card CTA to quiet variant; nav (or featured card) keeps the view's one fill; extract `ButtonLink` first (E5) |
| F5 | DIRECTION — resolved by v3 (front-door composition, if v3 ruled on it) | `page.tsx:110–112` docblock ruling "it shows the real one" | Front door renders `/browse`'s full 20-card shelf verbatim → 5,784px page at 1600, 13,015px at 360 | If v3's page spec caps the front-door slice, apply it here; otherwise stands as the largest remaining EXECUTION item |
| F6 | EXECUTION | `open-league-card.tsx:109` + `:112–116` | Title "OPEN 12-TEAM LEAGUE 29" duplicated by adjacent badge "Open 12-team" on every house card | Badge carries only what the title does not (rung/stake) |
| F7 | EXECUTION | `page.tsx:106–110` | Two stacked section headers four lines apart ("OPEN LEAGUES" → "COMMISH HOUSE LEAGUES") | Merge into one header |
| F8 | EXECUTION | `open-league-card.tsx:154` | `describeStartTiming`'s when-full sentence rendered `text-warning` — 5+ full-saturation amber paragraphs per shelf (8 lines each at 360) for a neutral, reassuring scheduling fact | `text-text-muted`; reserve `warning` for tightening clocks |
| F9 | EXECUTION | `info-tip.tsx:46–64` as composed in card term rows | Trigger icon floats above its caption; term label misaligns against the 24px-min trigger column — 3 ragged lines per term | If guided survives anywhere, restructure to label + sentence on one baseline |
| F10 | EXECUTION | `public-bar.tsx` on `/` | Two green CTAs adjacent in nav: filled "Take a seat" + accent "Sign in" link | Sign in becomes quiet (`textMuted`) |
| F11 | EXECUTION | `open-league-card.tsx:127` | Format facts ("SNAKE · HALF PPR") wear the `EYEBROW` label register, so labels and values compete on every card | Facts become plain muted text/chips; one label register per card |

### Signed-in surfaces

| # | Sev | Where | Finding | Remediation |
|---|---|---|---|---|
| S1 | DIRECTION — resolved by v3 (one solid action per view) | `league-board.tsx:114–125` | One green filled `ActionCell` button per table row — ten leagues, ten fills | Needs-you rows keep fill; others `text-accent` link |
| S2 | EXECUTION | see Inventory 1B | League/team names uppercase at display weight across home board, cards, matchup surfaces | The 1B sweep |
| S3 | EXECUTION | see Inventory 1D | Admin room hand-rolled eyebrow spellings drift from `EYEBROW` | Route through the one class |
| S4 | — | draft room, profile, account room | Broadly disciplined: `PageTitle` mixed-case, `Panel`/`Table` primitives used, full-bleed 2-col profile grid; only 1B/1C sweep items apply | Sweep only |

### Public reading and error surfaces

| # | Sev | Where | Finding | Remediation |
|---|---|---|---|---|
| P1 | EXECUTION | `src/app/reviews/page.tsx` (rendered) | Review uncontained; "Report" action floats near page-center on its own line, attached to nothing | Contain each review; right-align Report inside the row |
| P2 | EXECUTION | `src/app/league-rules/page.tsx` (rendered) | Seven ⓘ triggers interrupt sentences mid-flow, one orphaned at a line start, each inserting a gap before punctuation | Prose pages link to a glossary section instead of inline triggers |
| P3 | — | 404, `/app/join/[code]` invalid, `/support`, legal pages | Clean: centered calm cards, two actions, honest copy; join page heading is left-aligned to its centered card (minor) | Minor alignment only |

---

## Width and spacing findings

| # | Where | Finding | Remediation |
|---|---|---|---|
| W1 | `src/app/page.tsx:99,105` | Front door content capped `max-w-6xl` (1152px) → ~230px dead margin per side at 1600, while `/browse` and the shell are full-bleed (the shell's own ruling: "no `max-w-*` at all — the founder's brief in one deletion") | Drop the cap on the shelf band; hero column may keep its own measure |
| W2 | `public-league-list.tsx:84,143` | Card grids are `sm:grid-cols-2` with **no `lg`/`xl` step** — two ~780px cards forever, right half of each card empty at wide widths | `lg:grid-cols-3 xl:grid-cols-4` (or v3's lobby layout) |
| W3 | `front-door-hero.tsx:15` | `text-display-xl` (64px) with no responsive step → 10-word headline wraps to ~10 lines / ~520px at 360 (`front-360.png`) | `text-display-md sm:text-display-xl` |
| W4 | `page.tsx:98–105` | `gap-10` + `py-10 sm:py-14` + `pb-10 pt-8` stack a ~120px dead band between proof strip and shelf at 1600 | Tighten to one spacing step |
| W5 | rendered page heights | `/` = 5,784px @1600 and 13,015px @360; `/browse` = 4,742px @1600 — driven by card height (guided captions F3, amber paragraphs F8, uppercase 2-line titles) × 2-col cap (W2) | Falls out of F3/F8/1B + W2; re-measure after |
| W6 | `open-league-card.tsx:151` | Card's internal 2×2 fact grid occupies ~55% of card width at wide viewports; no wide-card layout | 3–4-up grid (W2) mostly removes the case |

---

## Appendix — files consuming the affected token roles (grep, tests and `src/design/` excluded)

**`bg-accent` (16 files):** listed exhaustively in Inventory 2.

**`text-accent` (42 files):**
`src/account-room/components/notice-inbox.tsx`, `review-composer.tsx`;
`src/admin-room/components/queue-table.tsx`;
`src/app/app/(shell)/profile/page.tsx`, `src/app/browse/page.tsx`, `src/app/global-error.tsx`,
`src/app/join/[leagueId]/hold/page.tsx`, `src/app/not-found.tsx`, `src/app/page.tsx`,
`src/app/reviews/page.tsx`, `src/app/sign-in/problem/page.tsx`, `src/app/support/page.tsx`;
`src/chat-room/components/message-list.tsx`;
`src/components/app-shell/public-bar.tsx`, `session-notice.tsx`;
`src/components/ui/avatar.tsx`, `badge.tsx`, `button.tsx`;
`src/draft-room/components/draft-board.tsx`, `player-pool.tsx`;
`src/league-room/components/activity-feed.tsx`, `attention-queue.tsx`,
`draft-schedule-panel.tsx`, `first-run-panel.tsx`, `home-board.tsx`, `home-league-card.tsx`,
`invite-landing.tsx`, `league-board.tsx`, `league-home.tsx`, `live-state-pill.tsx`,
`matchup-scoreboard.tsx`, `open-league-card.tsx`, `proof-strip.tsx`, `public-league-list.tsx`,
`room-roster.tsx`, `seat-claim-steps.tsx`, `seat-hold-panel.tsx`,
`start-or-join-disclosure.tsx`, `trade-card.tsx`, `trade-inbox-link.tsx`, `waiting-room.tsx`,
`week-nav.tsx`.

**`accent-glow` / `warning-glow` (1 file):** `src/components/ui/badge.tsx` (the only consumer of
both glow tokens; everything else reaches glow through `Badge`/`StatPill`).

**`text-positive` (8 files):** `src/account-room/components/help-level-form.tsx`,
`profile-form.tsx`, `review-composer.tsx`; `src/admin-room/components/held-trade-detail.tsx`,
`resolution-form.tsx`; `src/components/ui/avatar.tsx`, `badge.tsx`;
`src/league-room/components/lineup-editor.tsx`.

**`bg-positive` (1 file):** `src/components/app-shell/league-rail.tsx:28` — the rail's live dot
(tiny, `aria-hidden`, sentence carried by the link name). Quiet already; note it exists.

**`text-warning` (7 files):** `src/chat-room/components/league-chat.tsx`,
`src/components/ui/avatar.tsx`, `badge.tsx`; `src/draft-room/components/room-dock.tsx`,
`room-rail.tsx`; `src/league-room/components/draft-schedule-panel.tsx`,
`open-league-card.tsx` (F8's amber paragraph).

**`shadow-card` / `shadow-sticker`:** listed in Inventory 3.

**Color literals:** none outside `src/design/tokens.ts` (`no-raw-color.source.test.ts` enforces);
any v3 palette change is token-only.
