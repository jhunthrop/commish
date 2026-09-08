import type { Player } from "@/domain/player";
import { survivalBand } from "@/domain/draft-odds";
import { Button, Card, PlayerFace } from "@/components/ui";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { bigOddsText, factsLine, headerLine, pickLabel, stampText } from "../format";
import type { AdvisorActs } from "./advisor-acts";

export interface NextPickCardProps {
  readonly view: AdvisorView;
  readonly acts: AdvisorActs;
  /** The pick's own player, as the room knows him: name, team, headshot. */
  readonly player: Player | null;
  readonly byeWeek: number | null;
  readonly recomputing: boolean;
  /** The post-pick beat, when this seat's own pick just landed. */
  readonly beat: string | null;
}

const EMPTY_COPY = "Nothing on the board fits your roster right now.";

function Verb({ playerId, acts }: { readonly playerId: string; readonly acts: AdvisorActs }) {
  if (acts.canDraft) {
    return (
      <Button variant="verb" disabled={acts.submitting} className="w-full md:w-auto" onClick={() => acts.onDraft(playerId)}>
        Draft
      </Button>
    );
  }
  const place = acts.queueOrder.get(playerId) ?? null;
  return (
    <Button variant="secondary" disabled={acts.submitting} aria-pressed={place !== null} className="w-full md:w-auto" onClick={() => acts.onQueueToggle(playerId)}>
      {place === null ? "Queue" : `Queued ${place}`}
    </Button>
  );
}

/** The one big number: green at or above the safe band, plain ink otherwise, never red. */
function BigOdds({ view }: { readonly view: AdvisorView }) {
  const odds = view.pick?.makeItBack ?? null;
  if (odds === null || view.odds === null) {
    return <p className="text-sm text-text-muted">This is your last turn, so there is no next pick to wait for.</p>;
  }
  const safe = survivalBand(odds.survival) === "safe";
  return (
    <div className="flex flex-col">
      <p data-testid="advisor-odds" data-band={safe ? "safe" : "plain"} className={`font-display text-display-lg leading-display tabular-nums ${safe ? "text-positive" : "text-text-primary"}`}>
        {bigOddsText(odds)}
      </p>
      <p className="text-xs text-text-muted">
        still there at your next pick, {pickLabel(view.odds.pickNumber, view.teamCount)}
        {view.onTheClock ? ", if you pass on him" : ""}
      </p>
    </div>
  );
}

/**
 * THE ONE CARD (spec section 7): the next pick the manager should make, led by his face on his
 * club's colour, his name the largest text on the card, position and rank, team and bye under
 * it, one big number for the odds he is still there at your next turn as runs over runs, one
 * why of two sentences, and the verb: Draft when you are on the clock, Queue when you are not.
 * Warm treatment per v6: the soft card, real padding, the shadow token. Nothing here competes
 * with Draft when it shows.
 */
export function NextPickCard({ view, acts, player, byeWeek, recomputing, beat }: NextPickCardProps) {
  const pick = view.pick;
  return (
    <Card as="section" data-testid="advisor-card" aria-label="Your next pick" data-on-clock={view.onTheClock ? "true" : "false"} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p data-testid="advisor-header" className="font-display text-sm font-semibold text-text-muted">
          {headerLine(view)}
        </p>
        <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-text-faint">
          {recomputing ? <span data-testid="advisor-recomputing">Recomputing</span> : null}
          <span data-testid="advisor-stamp">{stampText(view)}</span>
        </span>
      </div>
      {beat === null ? null : (
        <p data-testid="assistant-beat" className="rounded-md bg-surface-raised px-2.5 py-1.5 text-sm font-semibold text-text-primary">
          {beat}
        </p>
      )}
      {pick === null || player === null ? (
        <p className="text-sm text-text-faint">{EMPTY_COPY}</p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <PlayerFace player={player} size="xl" />
            <div className="flex min-w-0 flex-col gap-1">
              <h3 data-testid="advisor-name" className="font-display text-2xl font-bold leading-tight text-text-primary">
                {player.name}
              </h3>
              <p data-testid="advisor-facts" title={`${pick.valueOverReplacement.toFixed(1)} points over replacement on our board`} className="text-sm text-text-muted">
                {factsLine(pick.position, pick.positionRank, player.nflTeam, byeWeek)}
              </p>
            </div>
          </div>
          <BigOdds view={view} />
          <p data-testid="advisor-why" className="text-md leading-snug text-text-primary">
            {pick.why}
          </p>
          <Verb playerId={pick.playerId} acts={acts} />
        </>
      )}
    </Card>
  );
}
