import Link from "next/link";
import type { ReactNode } from "react";
import { Rise } from "@/components/ui";
import type { ProofStats } from "@/matchmaking/contract";

export interface ProofStripProps {
  readonly stats: ProofStats;
  /** The page's ONE `now` instant (`page.tsx` reads it once and threads it everywhere) — the
   *  next-draft chip's coarse wording is derived from it, never from a second clock read. */
  readonly nowIso: string;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * The coarse wording the ruling asked for — a unit count, never a countdown and never a clock
 * time (a bare "9:04" is ambiguous across time zones; a coarse "5 hours" is not). The same
 * rounding shape as `relativeDraftTime` (`@/league/terms`), reshaped into the chip's
 * number-plus-label anatomy rather than that function's one prose clause. `null` when the
 * instant is absent or already behind `now` (the 60s proof cache can let one slip into the
 * past) — a chip counting down to a draft that already kicked off would be dressing, and the
 * ruling is real or absent.
 */
function coarseUntil(nextDraftAtIso: string | null, nowIso: string): { readonly value: number; readonly label: string } | null {
  if (nextDraftAtIso === null) return null;
  const diffMs = new Date(nextDraftAtIso).getTime() - new Date(nowIso).getTime();
  if (diffMs <= 0) return null;
  if (diffMs < MS_PER_HOUR) {
    const minutes = Math.max(1, Math.round(diffMs / MS_PER_MINUTE));
    return { value: minutes, label: `minute${minutes === 1 ? "" : "s"} until the next draft` };
  }
  const hours = Math.round(diffMs / MS_PER_HOUR);
  return { value: hours, label: `hour${hours === 1 ? "" : "s"} until the next draft` };
}

interface ScoreChipProps {
  readonly number: string | number;
  /** `text-negative` is reserved for the one LIVE count (drafts in the next 48 hours) — every
   *  other chip's number is plain ink, exactly like the mock's `.score.liveN` singling. */
  readonly numberTone?: "ink" | "live";
  readonly label: ReactNode;
}

/** One of the mock's score chips: hairline border, mono tabular number, quiet label. */
function ScoreChip({ number, numberTone = "ink", label }: ScoreChipProps) {
  return (
    <p className="flex items-baseline gap-2 rounded-lg border border-line bg-surface-elevated px-4 py-2.5">
      <span className={`font-mono text-2xl font-semibold tabular-nums ${numberTone === "live" ? "text-negative" : "text-text-primary"}`}>
        {number}
      </span>
      <span className="text-sm text-text-muted">{label}</span>
    </p>
  );
}

/**
 * The front door's scoreboard (Phase 3.6, Task 4 built `proofStats`; Phase 3.7, Task 7
 * re-renders it as the Sunday Standard mock's score chips). Every number here is a query or it
 * is not on the page — `stats.any` is `false` exactly when every one of the three floored
 * numbers sat below its own credibility floor (`MATCHMAKING_CONFIG.proof.floors`), and this
 * component renders NOTHING at all in that case: never a placeholder, never a rounded-up
 * substitute, never "coming soon". The next-draft chip never changes that: it rides a strip the
 * floored numbers earned (`ProofStats.nextDraftAt`'s own docblock) and is itself omitted
 * outside its window — real or absent, never dressed up.
 *
 * The rating links to `/reviews`, with its own review count folded into the link's accessible
 * name rather than sitting beside it as sighted-only context — "Read all 63 member reviews" tells
 * a screen reader exactly what pressing it does and how many reviews back the number up, in one
 * sentence.
 *
 * The strip is the hero band's fourth riser (`Rise` 4, the mock's `d4`).
 */
export function ProofStrip({ stats, nowIso }: ProofStripProps) {
  if (!stats.any) return null;

  const nextDraft = coarseUntil(stats.nextDraftAt, nowIso);

  return (
    <Rise step={4} className="flex flex-wrap gap-3">
      {stats.leaguesFilled === null ? null : <ScoreChip number={stats.leaguesFilled} label="leagues filled this season" />}
      {stats.draftsNext48h === null ? null : <ScoreChip number={stats.draftsNext48h} numberTone="live" label="drafts in the next 48 hours" />}
      {nextDraft === null ? null : <ScoreChip number={nextDraft.value} label={nextDraft.label} />}
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
