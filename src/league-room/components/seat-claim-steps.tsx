interface Step {
  readonly number: string;
  readonly timing: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * The mock's three-step strip, verbatim (Phase 3.6, Task 5, Step 2) — the persona panel asked to
 * keep it verbatim, minus the mock's own unverifiable "90 seconds" total, which nobody could
 * reconstruct from the three steps below it and which this task therefore does not print.
 *
 * Step 01's promise ("Your seat holds for 10 minutes") is real as of Task 6's seat hold
 * (`SEAT_HOLD.minutes`, `@/matchmaking/config`) — a promise on the front door with no mechanism
 * behind it is the exact failure this plan exists to stop.
 */
const STEPS: readonly Step[] = [
  { number: "01", timing: "10 SEC", title: "Pick a seat", detail: "Your seat holds for 10 minutes" },
  { number: "02", timing: "30 SEC", title: "Sign in with email", detail: "That is the whole signup" },
  { number: "03", timing: "DONE", title: "You are in the league", detail: "Meet the room, rank your draft slots" },
];

/** No props: every word is the mock's own fixed copy — see this module's own docblock. */
export function SeatClaimSteps() {
  return (
    <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
      {STEPS.map((step) => (
        <li key={step.number} className="flex flex-col gap-1 bg-surface p-4">
          <span className="font-mono text-xs font-bold uppercase tracking-wide text-accent">
            {step.number} &middot; {step.timing}
          </span>
          <span className="font-display text-base font-bold text-text-primary">{step.title}</span>
          <span className="text-sm text-text-muted">{step.detail}</span>
        </li>
      ))}
    </ol>
  );
}
