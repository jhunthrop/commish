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
/**
 * `absence` is the written "there is nothing here yet" line (`narrativeSlot(capsule,
 * absenceSlotKey(ABSENCE_MODULES.story))`, review I2) — the slot was being generated and never
 * rendered, while this module hard-coded two sentences. It replaces WHICHEVER of the two absence
 * sentences applies and neither of the other branches: a real chart is a stat and is never
 * replaced by prose.
 */
export function SeasonChartFallback({
  body,
  switcher,
  played,
  absence = null,
}: {
  readonly body: PlayerSeasonBody;
  readonly switcher: ReactNode;
  readonly played: boolean;
  readonly absence?: string | null;
}) {
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
        <p className="text-sm text-text-muted" data-season="absence">{absence ?? "His first NFL season."}</p>
      ) : body.availableSeasons.length === 0 ? (
        // THE THIRD STATE (fix round 1, CRITICAL): not a confirmed rookie, and no season on record
        // either — a crosswalk miss, or a placed veteran the store has no weeks for. Never the
        // rookie sentence, which would assert a biography fact this state lacks.
        <p className="text-sm text-text-muted" data-season="absence">{absence ?? "No prior seasons on record."}</p>
      ) : played ? (
        <div className="flex flex-col gap-2">
          <SeasonBars label={`${body.player.name}, points by week`} weeks={weeksFor(body)} />
          {/* NAME THE BASIS, ALWAYS (P2, P11, and fix round 1's own M1). This line used to print for
              a kicker and a team defense alone, so on every other player the only statement of what
              a bar IS lived in `SeasonBars`' `aria-label` and a sighted reader had nothing. That is
              not a cosmetic gap: the call card two inches above this chart says "our model expects
              15" GAMES, and a season with one week played draws one bar reading 15.0. A reader will
              supply an answer when we do not, and the wrong one is right there.

              A KICKER'S AND A TEAM DEFENSE'S CHART SAYS ONE MORE THING (the 2026-09-06 round): his
              bars are read out of their own archive rather than out of this league's live table, and
              the whole point of drawing them is that they are a record of games that were played. */}
          <p className="text-xs text-text-faint" data-testid="season-basis">
            {/* The noun-phrase register every other basis caption on this product uses ("Projected
                for the season, PPR, 2026"), not a sentence about the chart: a caption names what the
                figures ARE and stops. */}
            {`Week by week, ${body.season}, this league's scoring`}
            {body.kdefSeason === null ? "" : ". A record of games that were played, not a forecast."}
          </p>
        </div>
      ) : (
        <p className="text-sm text-text-muted">No scored week for him in the {body.season} season.</p>
      )}
    </div>
  );
}
