import Link from "next/link";
import type { ReactNode } from "react";
import { Rise } from "@/components/ui";
import type { ProofStats } from "@/matchmaking/contract";

export interface ProofStripProps {
  readonly stats: ProofStats;
}

interface ScoreChipProps {
  readonly number: string | number;
  /** `text-negative` is reserved for the one LIVE count (rooms filling now) — every other
   *  chip's number is plain ink, exactly like the mock's `.score.liveN` singling. */
  readonly numberTone?: "ink" | "live";
  readonly label: ReactNode;
}

/**
 * One of the mock's score chips: hairline border, tabular number, quiet label — the number OVER
 * the label at the display scale, which is the shape a scoreboard has and the shape this strip
 * did not have (the fun pass, Task 12).
 *
 * Before the fun pass these numbers were 22px beside a 14px label. That is 1.6x, against a spec
 * whose third named cause of "it feels like a legal website" is "sports interfaces live on
 * roughly 10x scale contrast — a huge number, a tiny label." These are the only numbers on the
 * front door, and they are the ones a stranger is being asked to believe. Range from SIZE alone:
 * `font-semibold` is 600 and rule 2's cap did not move. Responsive, because 44px is a desktop
 * scoreboard and never a 360px phone.
 *
 * NOT a `Stat`, and the reason is worth stating because `Stat` is otherwise this pass's one way
 * to set a number. Two things rule it out. These numbers have no comparison set at all — there is
 * nothing to rank "247 leagues filled" inside — and a `Stat` with no comparison is correct but
 * carries no more than this does. And one of them is genuinely LIVE, which rule 1 paints in the
 * red family; a `Stat`'s ink is reserved for magnitude, so routing this chip through it would
 * either drop that meaning or put two different meanings on one strip's hues. The FACE is shared
 * either way: display, tabular, sentence case.
 */
function ScoreChip({ number, numberTone = "ink", label }: ScoreChipProps) {
  return (
    <p className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface-elevated px-4 py-2.5">
      <span
        className={`font-display text-display-md font-semibold leading-display tabular-nums sm:text-display-lg ${numberTone === "live" ? "text-negative" : "text-text-primary"}`}
      >
        {number}
      </span>
      <span className="text-sm text-text-muted">{label}</span>
    </p>
  );
}

/**
 * "N seat(s) left in the tightest room" — the tightest-room chip's label, pluralized honestly
 * rather than a bare number nobody could parse (storefront review R1).
 */
function tightestRoomLabel(seatsRemaining: number): string {
  return `seat${seatsRemaining === 1 ? "" : "s"} left in the tightest room`;
}

/**
 * The front door's scoreboard (Phase 3.6, Task 4 built `proofStats`; Phase 3.7, Task 7
 * re-renders it as the Sunday Standard mock's score chips). Every number here is a query or it
 * is not on the page — `stats.any` is `false` exactly when every one of the three floored
 * numbers sat below its own credibility floor (`MATCHMAKING_CONFIG.proof.floors`), and this
 * component renders NOTHING at all in that case: never a placeholder, never a rounded-up
 * substitute, never "coming soon". The tightest-room chip never changes that: it rides a strip
 * the floored numbers earned (`ProofStats.tightestRoomSeatsRemaining`'s own docblock) and is
 * itself omitted when nothing is filling — real or absent, never dressed up.
 *
 * Storefront review R1: the chip repoints from "N hours until the next draft" (a countdown to a
 * chosen kickoff the sit-and-go shelf no longer produces) to "N seats left in the tightest room"
 * — no clock, no `nowIso` needed any more, because a seat count does not go stale the way a
 * future instant would.
 *
 * The rating links to `/reviews`, with its own review count folded into the link's accessible
 * name rather than sitting beside it as sighted-only context — "Read all 63 member reviews" tells
 * a screen reader exactly what pressing it does and how many reviews back the number up, in one
 * sentence.
 *
 * The strip is the hero band's fourth riser (`Rise` 4, the mock's `d4`).
 */
export function ProofStrip({ stats }: ProofStripProps) {
  if (!stats.any) return null;

  return (
    <Rise step={4} className="flex flex-wrap gap-3">
      {stats.leaguesFilled === null ? null : <ScoreChip number={stats.leaguesFilled} label="leagues filled this season" />}
      {stats.roomsFillingNow === null ? null : <ScoreChip number={stats.roomsFillingNow} numberTone="live" label="rooms filling right now" />}
      {stats.tightestRoomSeatsRemaining === null ? null : (
        <ScoreChip number={stats.tightestRoomSeatsRemaining} label={tightestRoomLabel(stats.tightestRoomSeatsRemaining)} />
      )}
      {stats.rating === null ? null : (
        <ScoreChip
          number={stats.rating.average}
          label={
            <>
              member rating{" "}
              <Link href="/reviews" className="font-medium text-accent underline">
                {`Read all ${stats.rating.count} member reviews`}
              </Link>
            </>
          }
        />
      )}
    </Rise>
  );
}
