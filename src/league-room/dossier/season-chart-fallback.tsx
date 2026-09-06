import type { ReactNode } from "react";
import { SeasonBars } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { PlayerSeasonBody } from "@/league-service/player";
import { weeksFor } from "../lib/player-season-view";

/** The season label, its switcher, and the rookie/no-record/chart branch — the pre-dossier
 *  peek's/full page's own composition, shared (dossier plan, Task 6) so both surfaces render the
 *  identical fallback rather than two copies that could drift. Used as the WHOLE fallback when
 *  `body.dossier` is absent, and as the dossier grid's own "last season" cell when the dossier
 *  exists but carries no `lastSeasonStory` for him (a board-ranked rookie, most often) — the same
 *  honest substitute either way, never a `SeasonStrip` built from a story that does not exist. */
export function SeasonChartFallback({ body, switcher, played }: { readonly body: PlayerSeasonBody; readonly switcher: ReactNode; readonly played: boolean }) {
  return (
    // `gap-6` matches the pre-dossier composition exactly: the label/switcher row and the chart
    // below it were flat siblings under that composition's own `gap-6` column.
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`${MICRO_LABEL} text-text-faint`}>{body.season} season</span>
        {switcher}
      </div>
      {body.isRookie ? (
        // A CONFIRMED rookie (`isRookie`, never inferred from `availableSeasons` alone — see
        // `PlayerSeasonBody`'s own docblock): nothing to chart, so one honest sentence stands in
        // for it rather than an empty chart or a "no data" dead end.
        <p className="text-sm text-text-muted">His first NFL season.</p>
      ) : body.availableSeasons.length === 0 ? (
        // THE THIRD STATE (fix round 1, CRITICAL): not a confirmed rookie, and no season on record
        // either — a crosswalk miss, or a placed veteran the store has no weeks for. Never the
        // rookie sentence, which would assert a biography fact this state lacks.
        <p className="text-sm text-text-muted">No prior seasons on record.</p>
      ) : played ? (
        <SeasonBars label={`${body.player.name}, points by week`} weeks={weeksFor(body)} />
      ) : (
        <p className="text-sm text-text-muted">No scored week for him in the {body.season} season.</p>
      )}
    </div>
  );
}
