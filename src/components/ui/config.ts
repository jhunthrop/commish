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
    /** `Table`'s `density="dense"` vertical cell padding, px — the mocks' own spec. `comfortable`
     *  keeps the table's original, more generous padding for a context that has not adopted the
     *  shell's density. */
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
 * v3 "Sunday Standard" register — sentence case, mono, quiet (the caps charter removed the
 * old all-caps display treatment; `no-uppercase.source.test.ts` keeps it removed). A class
 * CONSTANT, not a component — the element varies (`span`/`h2`/`th`) and the color is often
 * conditional, so a caller composes this with its own color utility rather than a component
 * absorbing a `className` prop for the one thing it varies by.
 */
export const EYEBROW = "font-mono text-xs tracking-wide";
