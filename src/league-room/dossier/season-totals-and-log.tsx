import { NOT_STARTED_DASH } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { PlayerSeasonBody } from "@/league-service/player";

/** The nine season-total tiles — split out from `SeasonTotalsAndLog` on its own so that
 *  component's body reads as two clear halves rather than one long function. */
function SeasonTotalsBlock({ body }: { readonly body: PlayerSeasonBody }) {
  if (body.totals === null) return null;
  const { totals } = body;
  return (
    <div className="flex flex-col gap-2">
      <h3 className={`${MICRO_LABEL} text-text-faint`}>{`${body.season} totals · under this league's scoring`}</h3>
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        {[
          ["Games", String(totals.games)],
          ["Carries", totals.carries === null ? NOT_STARTED_DASH : String(totals.carries)],
          ["Rush yds", String(totals.rushingYards)],
          ["Targets", totals.targets === null ? NOT_STARTED_DASH : String(totals.targets)],
          ["Rec", String(totals.receptions)],
          ["Rec yds", String(totals.receivingYards)],
          ["Pass yds", String(totals.passingYards)],
          ["TD", String(totals.touchdowns)],
          ["Pts", totals.fantasyPoints.toFixed(2)],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <span className={`${MICRO_LABEL} text-text-faint`}>{label}</span>
            <span className="font-display text-xl font-bold tabular-nums text-text-primary">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The complete game log table — split out from `SeasonTotalsAndLog` for the identical reason
 *  `SeasonTotalsBlock` is. `Carries`/`Targets` print a dash for a PRIOR season (2026-09-04
 *  widening): the observation store never carries them (`PlayerGameLogRow`'s own docblock) — a
 *  dash is the honest "not recorded", never a fabricated zero. */
function GameLogTable({ body }: { readonly body: PlayerSeasonBody }) {
  if (body.log.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className={`${MICRO_LABEL} text-text-faint`}>{`${body.season} game log · under this league's scoring`}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr className={`${MICRO_LABEL} border-b border-line text-text-faint`}>
              <th className="py-1 pr-3 text-left font-normal">Wk</th>
              <th className="py-1 pr-3 text-right font-normal">Car</th>
              <th className="py-1 pr-3 text-right font-normal">Rush</th>
              <th className="py-1 pr-3 text-right font-normal">Tgt</th>
              <th className="py-1 pr-3 text-right font-normal">Rec</th>
              <th className="py-1 pr-3 text-right font-normal">Rec yds</th>
              <th className="py-1 pr-3 text-right font-normal">Pass</th>
              <th className="py-1 pr-3 text-right font-normal">TD</th>
              <th className="py-1 text-right font-normal">Pts</th>
            </tr>
          </thead>
          <tbody>
            {body.log.map((row) => (
              <tr key={row.week} className="border-b border-line/50">
                <td className="py-1.5 pr-3 text-text-muted">{row.week}</td>
                <td className="py-1.5 pr-3 text-right text-text-muted">{row.carries === null ? NOT_STARTED_DASH : row.carries}</td>
                <td className="py-1.5 pr-3 text-right text-text-muted">{row.rushingYards}</td>
                <td className="py-1.5 pr-3 text-right text-text-muted">{row.targets === null ? NOT_STARTED_DASH : row.targets}</td>
                <td className="py-1.5 pr-3 text-right text-text-muted">{row.receptions}</td>
                <td className="py-1.5 pr-3 text-right text-text-muted">{row.receivingYards}</td>
                <td className="py-1.5 pr-3 text-right text-text-muted">{row.passingYards}</td>
                <td className="py-1.5 pr-3 text-right text-text-muted">{row.touchdowns}</td>
                <td className="py-1.5 text-right font-display font-bold text-text-primary">{row.points.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * SEASON TOTALS + GAME LOG (founder, 2026-08-30: ESPN-depth; shared between the peek and the full
 * page, dossier plan, Task 6). Raw production from the harvest block, points under THIS league's
 * scoring rules — named as such on both headers now, the "both bases" law the plan's own Global
 * Constraints state directly (the 12.0-vs-14.28 defect: two scoring bases shown side by side with
 * neither labeled). The dossier's own numbers elsewhere on the page (`SeasonStrip`'s "a game" fact,
 * `CallCard`'s "pts") already name THEIR OWN basis (`dossier.basis.scoringLabel`, the board's
 * standard PPR); this component names the other one.
 *
 * Columns are position-blind on purpose: a zero column is honest and a per-position table is four
 * tables.
 */
export function SeasonTotalsAndLog({ body }: { readonly body: PlayerSeasonBody }) {
  return (
    <>
      <SeasonTotalsBlock body={body} />
      <GameLogTable body={body} />
    </>
  );
}
