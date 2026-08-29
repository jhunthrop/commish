/** Tunables shared by the UI primitives. No component may inline one of these values. */
export const UI_CONFIG = {
  shell: {
    /**
     * The viewport width, px, at and above which `TOKENS.font.sizeDense` replaces
     * `TOKENS.font.size` (`src/design/generate-css.ts`'s `@media (min-width: …)` block) — the
     * mocks' 13–14px desktop density is deliberate, a 13px body on a 360px phone is not.
     * Matches Tailwind's `lg` breakpoint, the same width the shell's rail grid switches on
     * (Task 2), so density and layout change together rather than at two different widths.
     */
    denseFromPx: 1024,
    /** `AppShell`'s `grid-cols-[var(--rail)_1fr]` column width, px, at `lg` and above — read
     *  into a `--rail` custom property (`AppShell`'s own inline style, the same "a dynamic
     *  value has to reach the DOM as a style, not a class" idiom `UI_CONFIG.infoTip.minTargetPx`
     *  already uses) rather than a Tailwind arbitrary value hardcoded at the call site. */
    railWidthPx: 64,
    /** `LeagueRail`'s crest tile, px — the mocks' own 40px tiles reading "BB", "TS", "GH". */
    crestSizePx: 40,
  },
  countdown: {
    /** How often `useCountdown` re-renders, ms. One second is the smallest unit `Countdown`
     *  displays. Phase 3.5, Task 8: moved from `DRAFT_ROOM_CONFIG.countdownTickMs` when the hook
     *  and its presentation centralized here at their third caller (`WaitingRoom`) — every
     *  countdown in the app now shares this one value rather than the draft room's own. */
    tickMs: 1_000,
    /** The tick interval `useCountdown` uses instead, once `usePrefersReducedMotion` reports
     *  true — a real BRANCH, the same idiom `UI_CONFIG.toast.reducedMotionDismissMs` already
     *  sets: the countdown stays correct, it simply refreshes less often, since a display-only
     *  clock (`useCountdown`'s own docblock) loses nothing by updating less frequently for
     *  someone who asked for less motion. */
    reducedMotionTickMs: 30_000,
    /**
     * Below this, `formatCoarseRemaining`'s screen-reader announcement reads "Under a minute
     * left" rather than a minute count.
     */
    coarseRemainingMinuteMs: 60_000,
    /**
     * At or above this, `formatCoarseRemaining` rounds to the nearest hour instead of the
     * nearest minute — deliberately coarser than `Countdown`'s ticking digits, so the
     * `aria-live` region built on it changes on a boundary crossing, not every second.
     */
    coarseRemainingHourMs: 3_600_000,
    /**
     * At or above this, `formatCoarseDuration` rounds to the nearest day instead of the nearest
     * hour — the bucket a schedule days out needs (`DraftSchedulePanel`'s own "in 7 days"), which
     * the hour bucket alone would render as an unreadable triple-digit hour count.
     */
    coarseRemainingDayMs: 86_400_000,
  },
  toast: {
    /** How long a toast stays up, in ms. */
    dismissMs: 5_000,
    /** Longer dwell for users who asked for reduced motion — they also want more reading time. */
    reducedMotionDismissMs: 10_000,
    /** Oldest toasts beyond this are dropped so the stack can never cover the page. */
    maxVisible: 3,
  },
  frontDoor: {
    /**
     * D3 (Phase 3.7, Task 6, self-ruled at 6): how many MEMBER leagues the front door's shelf
     * shows before the one quiet "See every open league" pill hands off to `/browse` — the
     * capped teaser that kills the audit's 5,800px front door (E2/D3). Member leagues only: the
     * house shelf renders whole, since the factory's own `openAtOnce` already bounds it. Two
     * full rows at the shelf's `lg` three-column tier; `/browse` remains the uncapped, filterable
     * lobby.
     */
    shelfCap: 6,
  },
  openLeagueCard: {
    /**
     * Rule 6, "only true things move" (Phase 3.7, Task 5, self-ruled at 6 hours): a browse
     * card's Drafts value becomes the ticking `Countdown` (tone `hot`) — and its live chip may
     * read "On deck" — only while a SCHEDULED draft's kickoff is within this many ms. Inside a
     * game-day window the minutes are what a shopper acts on; further out, the absolute
     * `draftAt` sentence is the honest register and nothing on the card moves. Measured against
     * `PublicLeagueSummary.draftAtIso` — a card whose summary does not carry the instant simply
     * never enters the window.
     */
    clockWithinMs: 21_600_000,
  },
  stat: {
    /**
     * Where each magnitude step begins, as a percentile floor inside the comparison set the
     * caller stated (1 = best in the population). A value at or above `strong` is strong, at or
     * above `good` is good, and anything below `weak` is bad. The middle band — `neutral`'s floor
     * up to `good`'s — is deliberately the widest: most numbers on any screen are ordinary, and a
     * heat map that tints two thirds of a column has told the reader nothing.
     *
     * A tunable, never a literal in a component: these four numbers are the difference between
     * "a steal" and "a fine pick", and that judgement belongs somewhere a persona review can find
     * it in one file rather than inside whichever surface rendered it first.
     */
    percentileFloors: { strong: 0.85, good: 0.65, neutral: 0.35, weak: 0.15 },
    /**
     * The heat map's own floor: how many real values a comparison set must hold before
     * `comparisonWithin` (`./magnitude.ts`) will rank anything inside it. Below this the set is
     * not a population, it is a handful of numbers, and a percentile across it is arithmetic
     * dressed as a fact — exactly the "designer's feeling about whether 14.2 is a good number"
     * rule 1's magnitude amendment forbids.
     *
     * Four is the smallest set where the five-step ramp can put two values either side of the
     * middle and still mean it. It also decides when heat APPEARS on a Sunday: the matchup page
     * pools only players who have already played, so a position stays plain ink until four of
     * them have a stat line.
     *
     * MOVED HERE FROM `LEAGUE_ROOM_CONFIG.heatMinPopulation` (2026-08-28) with the arithmetic it
     * governs, when `Table` learned to judge a column: a draft-room table asking a league-room
     * config how many numbers make a population was the wrong shape, and duplicating the four
     * would have been worse. It sits beside `percentileFloors` because the two are one decision —
     * where the ramp's steps begin, and whether the ramp may be drawn at all.
     */
    minPopulation: 4,
  },
  seatMeter: {
    /**
     * Below this many remaining seats (and above zero), `SeatMeter` appends its own "{n} seat(s)
     * left" clause to the seat sentence. At or above it, the raw count is not yet the thing a
     * reader needs to act on — the base "{filled} of {total} seated" sentence already answers
     * "how full", and a clause on every render would be noise, not signal.
     */
    lowSeatsThreshold: 3,
  },
  table: {
    /**
     * `Table`'s `density="dense"` vertical cell padding, px. `comfortable` keeps the table's
     * original, more generous padding for a context that has not adopted the shell's density.
     *
     * LAW 4, DENSITY IS RESPECT: 7px, down from v3's 11. The Gameday mock's Sunday table sets
     * `padding: 0.45rem 0.6rem` — 7.2px vertical — and that table is the screen the law was
     * written about: a manager staring at his starters for six hours wants the seventh row on
     * screen, not air around the sixth. Four pixels a row is roughly one more starter visible
     * without scrolling on a phone, which is the whole argument.
     */
    /**
     * SUNDAY v5, law 3: a row is ~44px and a name is 18px, because a broadcast graphic stays
     * readable from the sofa and DROPS A COLUMN rather than shrinking type. This reverses the
     * v4 pass that took it 11px -> 7px chasing density; that pass was right that our tables read
     * as spreadsheets and wrong about why. The cause was full-width tables spreading two related
     * facts 1270px apart, not row height, and that has since been fixed separately.
     */
    denseRowPaddingPx: 11,
  },
  waitingRoom: {
    /**
     * D1, the seating moment (Phase 3.6, Task 9, Step 2b): how long after a manager's own
     * `member_joined` moment the waiting room keeps showing "You're in" before it quietly goes
     * back to being the ordinary room. Derived-only — there is no stored flag this ages out, the
     * window itself is the whole mechanism.
     */
    justSeatedMinutes: 5,
    /**
     * D3, the room going full: how long the completed fill `Meter` stays the hero, once the last
     * seat lands, before the `xl` `Countdown` to the grace-window kickoff replaces it — the pause
     * that makes the state change a moment rather than a flicker. `usePrefersReducedMotion`
     * (Task 13 Step 5's branch) skips this entirely: the meter completes and the countdown
     * appears with no transition at all.
     */
    fillCelebrationMs: 1_500,
  },
  wire: {
    /**
     * Phase 3.7, Task 8 (self-ruled: 3): fewer real items than this and `Wire`
     * (`@/league-room/components/wire`) renders `null` — a quiet product shows a clean
     * hairline under the nav, never filler (the plan's own "no mock data on a real surface"
     * rule, applied to a marquee that would otherwise loop two lonely sentences). The
     * reduced-motion branch also shows exactly this many as its static row: the count that
     * makes the wire worth showing is the count a non-scrolling row can honestly show.
     */
    minItems: 3,
  },
  infoTip: {
    /**
     * WCAG 2.2 SC 2.5.8 (Target Size, Minimum — Level AA): a pointer target must be at least
     * 24x24 CSS pixels on each axis, even when the visible glyph inside stays smaller. `InfoTip`
     * applies this as the trigger's `min-width`/`min-height`, not a Tailwind size class — a
     * dynamic `h-[${…}px]` string is invisible to Tailwind's static class scanner and would
     * silently ship no rule at all, so the number has to reach the DOM as an inline style.
     */
    minTargetPx: 24,
  },
  skeleton: {
    /**
     * `AppShellSkeleton`'s `shape="content"` geometry: how many placeholder blocks fill the
     * content column below its title bar while a `(shell)` page's own data loads (Phase 3.6
     * addendum, Task 21, F8's content-column-only ruling). A count, not a guess at any one real
     * page's card layout — the per-page-skeleton alternative is refused for the same reason
     * `docs/superpowers/plans/2026-08-23-phase3p6-addendum-whole-site.md` refuses it.
     */
    contentBlockCount: 3,
    /**
     * `shape="public"`'s top band height, px — mirrors `PublicBar`'s own rendered header height
     * (`py-3` around a `text-xl` wordmark line) so the swap from skeleton to the real bar causes
     * no jump. The same "a dynamic value has to reach the DOM as a style, not a class" idiom
     * `infoTip.minTargetPx` already uses, since a Tailwind arbitrary value cannot read a JS
     * constant.
     */
    publicBarHeightPx: 57,
    /**
     * `shape="room"`'s top band height, px — mirrors `RoomRail`'s own `lg:min-h-20` (80px) so
     * the room skeleton's rail-shaped band matches the real one it is standing in for.
     */
    roomRailHeightPx: 80,
  },
} as const;

/**
 * The section-label treatment: a board header, a roster/queue heading, a sticky column header.
 * Sentence case, mono, quiet. A class CONSTANT, not a component — the element varies
 * (`span`/`h2`/`th`) and the color is often conditional, so a caller composes this with its own
 * color utility rather than a component absorbing a `className` prop for the one thing it
 * varies by.
 */
export const EYEBROW = "font-mono text-xs tracking-wide";

/**
 * THE MICRO-LABEL — the product's one sanctioned all-caps register, and the ONLY place law 2's
 * "sentence case in prose" gives way.
 *
 * Gameday keeps v3's caps charter almost intact and carves out exactly one exception, stated in
 * "What stays": *"Sentence case in prose. Uppercase survives only in mono micro-labels, where
 * every sports interface has always put it."* That is the mock's `.lbl` — 11px Geist Mono, 0.11em
 * tracking, the faint ink — and it appears on the things a scoreboard has always shouted quietly:
 * a column header, a slot name, `248 LEFT`, `Q3`, the eyebrow over a stat block.
 *
 * WHY IT LIVES HERE AND NOWHERE ELSE. `no-uppercase.source.test.ts` bans the literal word
 * `uppercase` from every `.tsx` in the product, and that ban does not relax — it now has exactly
 * one address instead of none. A component that wants the register imports this constant; a
 * component that spells the class itself still fails the sweep. The charter's real target was
 * forty-three hand-rolled all-caps treatments drifting apart from each other, and one shared
 * constant is the opposite of that, not a hole in it.
 *
 * Distinct from `EYEBROW` on purpose: an eyebrow is a sentence-case label above a block, a
 * micro-label is a shouted key beside data. Both are mono and small; only one is capitals, and
 * collapsing them would put capitals back on the prose labels the charter cleared.
 */
export const MICRO_LABEL = "font-mono text-xs uppercase tracking-[0.11em]";

/**
 * THE RAIL REGISTER — the caps charter's second sanctioned address (Sunday v5, 2026-08-28).
 *
 * The broadcast rail's navigation speaks in the condensed face, small caps, tracked: the way
 * every sports network sets its own chrome, and the register the approved timing-tower render
 * uses for BOARD / ROOMS / LEAGUES. Distinct from `MICRO_LABEL` on purpose: a micro-label is a
 * mono key shouted beside data; a rail label is a display-face destination a person presses.
 * Same enforcement mechanism as `MICRO_LABEL` — a component imports this constant, and one that
 * hand-rolls the class still fails `no-uppercase.source.test.ts`.
 */
export const RAIL_LABEL = "font-display text-sm font-semibold uppercase tracking-[0.08em]";
