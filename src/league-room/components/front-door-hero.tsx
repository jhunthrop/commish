import { Rise } from "@/components/ui";

/**
 * The front door's hero (Phase 3.6, Task 5; retoned by Phase 3.7, Task 7 to the Sunday
 * Standard mock, S8 ruling) — headline and sub adopted from `sunday-standard.html` verbatim.
 * The closing phrase and the money line render in `text-positive` (the mock's `.go`/`.free`,
 * money green): the page's energy comes from what is LIVE and REAL, never from decoration.
 * "No account is needed to look." survives as one quiet detail line (S8 — it answered a
 * persona concern and costs one line); the old "Browse the open leagues below." sentence dies
 * with the longer sub it belonged to.
 *
 * E6: the display size takes the responsive step — `text-display-md` at a phone width,
 * `sm:text-display-xl` (58, S3) from the first breakpoint up — so 360px never wears 58px type.
 *
 * Headline rises first, the sub block second (`Rise` 1/2, the mock's `d1`/`d2`); the steps and
 * scoreboard below carry slots 3 and 4 in their own modules.
 *
 * No props: every word here is static marketing copy, never a fact this task could get wrong by
 * quoting stale data — the numbers that CAN be checked live in `ProofStrip`, right below this.
 */
export function FrontDoorHero() {
  return (
    <div className="flex flex-col items-start gap-4">
      <Rise step={1}>
        <h1 className="max-w-3xl text-balance font-display text-display-md font-semibold leading-display text-text-primary sm:text-display-xl">
          Real leagues. Real seats. <span className="text-positive">Drafting this week.</span>
        </h1>
      </Rise>
      <Rise step={2} className="flex flex-col items-start gap-2">
        <p className="max-w-2xl text-lg text-text-muted">
          Season-long fantasy football with a live draft room, real-time scoring, and a platform
          that runs the league so no brother-in-law has to.
        </p>
        <p className="text-md font-medium text-positive">Every league is free this season.</p>
        <p className="text-sm text-text-muted">No account is needed to look.</p>
      </Rise>
    </div>
  );
}
