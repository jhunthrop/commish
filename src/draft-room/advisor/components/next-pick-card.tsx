import type { Player } from "@/domain/player";
import { survivalBand } from "@/domain/draft-odds";
import { Card, PlayerFace } from "@/components/ui";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { bigOddsText, factsLine, headerLine, pickLabel, stampText } from "../format";
import type { AdvisorActs } from "./advisor-acts";
import { AdvisorVerb } from "./advisor-verb";

export interface NextPickCardProps {
  readonly view: AdvisorView;
  readonly acts: AdvisorActs;
  /** The pick's own player, as the room knows him: name, team, headshot. */
  readonly player: Player | null;
  readonly byeWeek: number | null;
  readonly recomputing: boolean;
}

const EMPTY_COPY = "Nothing on the board fits your roster right now.";
const LAST_TURN_COPY = "Your last turn, so nothing to wait for.";

/** The row's big figure: green at or above the safe band, plain ink otherwise, never red. */
function BigOdds({ view }: { readonly view: AdvisorView }) {
  const odds = view.pick?.makeItBack ?? null;
  if (odds === null || view.odds === null) {
    return <p className="max-w-32 text-right text-xs leading-snug text-text-muted">{LAST_TURN_COPY}</p>;
  }
  const safe = survivalBand(odds.survival) === "safe";
  return (
    <div className="flex shrink-0 flex-col items-end">
      <p data-testid="advisor-odds" data-band={safe ? "safe" : "plain"} className={`font-display text-2xl font-bold leading-none tabular-nums ${safe ? "text-positive" : "text-text-primary"}`}>
        {bigOddsText(odds)}
      </p>
      <p className="text-xs text-text-muted">
        still there at {pickLabel(view.odds.pickNumber, view.teamCount)}
        {view.onTheClock ? " if you pass" : ""}
      </p>
    </div>
  );
}

/**
 * THE LEAD CARD (spec section 7, compacted in the pick count round so its verb never sits below
 * the fold): one header line, one row with his face on his club's colour, his name, position
 * and rank, team and bye, and the odds he is still there at your next turn as the row's big
 * figure, then the why of two sentences, then the verb. Draft when you are on the clock, Queue
 * when you are not. The verb sticks to the bottom of the tab's scroll area on a screen too short
 * for the whole card, so it is reachable without a scroll everywhere.
 */
export function NextPickCard({ view, acts, player, byeWeek, recomputing }: NextPickCardProps) {
  const pick = view.pick;
  return (
    <Card as="section" data-testid="advisor-card" aria-label="Your next pick" data-on-clock={view.onTheClock ? "true" : "false"} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p data-testid="advisor-header" className="font-display text-sm font-semibold text-text-muted">
          {headerLine(view)}
        </p>
        <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-text-faint">
          {recomputing ? <span data-testid="advisor-recomputing">Recomputing</span> : null}
          <span data-testid="advisor-stamp">{stampText(view)}</span>
        </span>
      </div>
      {pick === null || player === null ? (
        <p className="text-sm text-text-faint">{EMPTY_COPY}</p>
      ) : (
        <>
          <div data-testid="advisor-lead-row" className="flex items-center gap-3">
            <PlayerFace player={player} size="md" />
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 data-testid="advisor-name" className="truncate font-display text-lg font-bold leading-tight text-text-primary">
                {player.name}
              </h3>
              <p data-testid="advisor-facts" title={`${pick.valueOverReplacement.toFixed(1)} points over replacement on our board`} className="text-sm text-text-muted">
                {factsLine(pick.position, pick.positionRank, player.nflTeam, byeWeek)}
              </p>
            </div>
            <BigOdds view={view} />
          </div>
          <p data-testid="advisor-why" className="text-sm leading-snug text-text-primary">
            {pick.why}
          </p>
          <div className="sticky bottom-0 -mx-4 -mb-4 rounded-b-lg bg-surface-elevated px-4 pb-4 pt-1">
            <AdvisorVerb playerId={pick.playerId} acts={acts} className="w-full md:w-auto" />
          </div>
        </>
      )}
    </Card>
  );
}
