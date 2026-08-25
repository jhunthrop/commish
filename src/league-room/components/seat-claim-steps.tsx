import { EYEBROW, Rise } from "@/components/ui";
import { SEAT_HOLD } from "@/matchmaking/config";

interface Step {
  readonly number: string;
  readonly timing: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * The mock's three-step strip (Phase 3.6, Task 5; reshaped by Phase 3.7, Task 7 to the Sunday
 * Standard mock's `.m-step` columns) — the persona panel asked to keep the copy verbatim, minus
 * the mock's own unverifiable "90 seconds" total, which nobody could reconstruct from the three
 * steps below it and which this task therefore does not print. The timing spellings are the
 * mock's sentence case ("1 · 10 seconds"), which retires the old "10 SEC"/"DONE" caps data —
 * the caps charter's (Task 3) last data-side carry.
 *
 * E4: hairline-topped columns, numeral in quiet mono `text-text-faint` — at hero scale an
 * accent numeral competes with the value it labels, so it died with the boxed grid.
 *
 * Step 1's promise ("Your seat holds for 10 minutes") is real as of Task 6's seat hold
 * (`SEAT_HOLD.minutes`, `@/matchmaking/config`) — a promise on the front door with no mechanism
 * behind it is the exact failure this plan exists to stop.
 */
const STEPS: readonly Step[] = [
  { number: "1", timing: "10 seconds", title: "Pick a seat", detail: `Your seat holds for ${SEAT_HOLD.minutes} minutes` },
  { number: "2", timing: "30 seconds", title: "Sign in with email", detail: "That is the whole signup" },
  { number: "3", timing: "done", title: "You are in the league", detail: "Meet the room, rank your draft slots" },
];

/** No props: every word is the mock's own fixed copy — see this module's own docblock. The
 *  strip is the hero band's third riser (`Rise` 3, the mock's `d3`). */
export function SeatClaimSteps() {
  return (
    <Rise step={3}>
      <ol className="grid max-w-4xl gap-4 sm:grid-cols-3 sm:gap-10">
        {STEPS.map((step) => (
          <li key={step.number} className="flex flex-col gap-1 border-t border-line pt-3.5">
            <span className={`${EYEBROW} text-text-faint`}>
              {step.number} &middot; {step.timing}
            </span>
            <span className="font-display text-base font-semibold text-text-primary">{step.title}</span>
            <span className="text-sm text-text-muted">{step.detail}</span>
          </li>
        ))}
      </ol>
    </Rise>
  );
}
