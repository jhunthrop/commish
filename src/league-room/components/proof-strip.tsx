import Link from "next/link";
import type { ProofStats } from "@/matchmaking/contract";

export interface ProofStripProps {
  readonly stats: ProofStats;
}

/**
 * The front door's proof strip (Phase 3.6, Task 4 built `proofStats`; Task 5 consumes it and
 * renders it). Every number here is a query or it is not on the page — `stats.any` is `false`
 * exactly when every one of the three numbers sat below its own credibility floor
 * (`MATCHMAKING_CONFIG.proof.floors`), and this component renders NOTHING at all in that case:
 * never a placeholder, never a rounded-up substitute, never "coming soon".
 *
 * The rating links to `/reviews`, with its own review count folded into the link's accessible
 * name rather than sitting beside it as sighted-only context — "Read all 63 member reviews" tells
 * a screen reader exactly what pressing it does and how many reviews back the number up, in one
 * sentence.
 */
export function ProofStrip({ stats }: ProofStripProps) {
  if (!stats.any) return null;

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-muted">
      {stats.leaguesFilled === null ? null : (
        <p>
          <span className="font-semibold text-text-primary">{stats.leaguesFilled}</span> leagues filled this season
        </p>
      )}
      {stats.draftsNext48h === null ? null : (
        <p>
          <span className="font-semibold text-text-primary">{stats.draftsNext48h}</span> drafts in the next 48 hours
        </p>
      )}
      {stats.rating === null ? null : (
        <p>
          <span className="font-semibold text-text-primary">{stats.rating.average}</span> member rating{" "}
          <Link href="/reviews" className="font-medium text-accent underline">
            {`Read all ${stats.rating.count} member reviews`}
          </Link>
        </p>
      )}
    </div>
  );
}
