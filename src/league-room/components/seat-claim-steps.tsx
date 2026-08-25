import { EYEBROW, Rise } from "@/components/ui";
import { SEAT_HOLD } from "@/matchmaking/config";
import { moneyIsLive } from "@/money/states";

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
 * DARK BRANCH ONLY. `moneyIsLive()` ships false (`MONEY_STATES.enabled` is empty), so this is the
 * strip every real render shows today, byte-identical to before Phase 4, Task 13 introduced the
 * `live` prop below — see this module's own test for the literal proof.
 */
const DARK_STEPS: readonly Step[] = [
  { number: "1", timing: "10 seconds", title: "Pick a seat", detail: `Your seat holds for ${SEAT_HOLD.minutes} minutes` },
  { number: "2", timing: "30 seconds", title: "Sign in with email", detail: "That is the whole signup" },
  { number: "3", timing: "done", title: "You are in the league", detail: "Meet the room, rank your draft slots" },
];

/**
 * The LIVE branch (Phase 4, Task 13) — the founder's directive, verbatim: "not all drafts will be
 * free ... we need to add a step for depositing." Three changes from the dark strip, all derived
 * from the same fact (a seat can now cost money), never a second, independent claim:
 *
 *  - Step 2's "That is the whole signup" stops being true the moment a deposit step exists, so it
 *    is replaced rather than kept alongside a step that contradicts it.
 *  - A new step 3, "Cover the entry," is honest for both cases in one sentence: free leagues
 *    still cost nothing, paid leagues draw from the balance the wallet already holds
 *    (`@/money/states`, `renderWalletContent`). Its timing is "1 minute," not "done" or
 *    "instant" — a bank-funded balance clears quickly but is a real step with real latency, and
 *    overclaiming it is the exact failure this task exists to stop.
 *  - "You are in the league" moves to step 4, unchanged, because it is still the last thing that
 *    happens.
 */
const LIVE_STEPS: readonly Step[] = [
  { number: "1", timing: "10 seconds", title: "Pick a seat", detail: `Your seat holds for ${SEAT_HOLD.minutes} minutes` },
  { number: "2", timing: "30 seconds", title: "Sign in with email", detail: "One account for every league" },
  {
    number: "3",
    timing: "1 minute",
    title: "Cover the entry",
    detail: "Free leagues skip this step. Paid leagues draw from your balance.",
  },
  { number: "4", timing: "done", title: "You are in the league", detail: "Meet the room, rank your draft slots" },
];

export interface SeatClaimStepsProps {
  /** Defaults to the real `moneyIsLive()` — injectable so a test can exercise the live, four-step
   *  branch without editing shipped state, the identical `FrontDoorHero` idiom
   *  (`@/league-room/components/front-door-hero`). No production caller, and no test in this task
   *  beyond the live-branch ones, ever passes anything but the default: `MONEY_STATES.enabled`
   *  ships empty, so every real render reaches the dark, three-step branch. */
  readonly live?: boolean;
}

/**
 * The hero band's third riser (`Rise` 3, the mock's `d3`). DERIVED from `moneyIsLive()` rather
 * than a fixed step count, the same "the config and the sentence can never disagree" discipline
 * `FrontDoorHero`'s own money line already holds to: a step strip that promised "the whole
 * signup" and nothing more on the day a league actually charges an entry fee would be the exact
 * stale claim that pattern exists to prevent.
 *
 * The grid holds three columns dark, four live — `sm:grid-cols-3`/`sm:grid-cols-4` is the one
 * class that changes; every other class on the list, and every dark-branch word, is untouched.
 */
export function SeatClaimSteps({ live = moneyIsLive() }: SeatClaimStepsProps = {}) {
  const steps = live ? LIVE_STEPS : DARK_STEPS;
  const columns = live ? "sm:grid-cols-4" : "sm:grid-cols-3";
  return (
    <Rise step={3}>
      <ol className={`grid max-w-4xl gap-4 ${columns} sm:gap-10`}>
        {steps.map((step) => (
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
