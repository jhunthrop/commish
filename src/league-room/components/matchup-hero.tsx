import type { MatchupSide, MatchupSummary } from "../contract";
import { Crest, Movement, NOT_STARTED_DASH, Pill, PointsShareBar, Scoreboard } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { LiveMarker } from "@/components/ui/live-marker";
import { formatPoints, formatRecord } from "../lib/format";
import { benchPoints, remainingToPlay } from "../lib/matchup-facts";

/**
 * A team's standings line, keyed by team id — `LeagueHomeBody.standings` reshaped by the page,
 * which already reads it. The matchup wire has never carried a record and does not learn to here:
 * the pages hold both reads, so they are the one place that can join them.
 *
 * `rank`/`previousRank` ride along for law 2 (Sunday v5). They cost nothing: the same standings
 * rows the record comes from already carry both, and a scoreboard that prints a seed and what it
 * did last week is telling the reader the one thing two scores cannot.
 */
export type RecordsByTeamId = Readonly<
  Record<
    string,
    {
      readonly wins: number;
      readonly losses: number;
      readonly ties: number;
      readonly rank: number;
      readonly previousRank: number | null;
    }
  >
>;

/**
 * The record as the hero prints it, or an empty string when the caller could not name one.
 *
 * `Scoreboard` requires the string, and an empty one renders an empty micro-label rather than a
 * fabricated "0-0" — a team the standings do not carry a row for has no record, and inventing the
 * neutral-looking one would be the same lie as a zero beside a player who has not kicked off.
 */
function recordFor(records: RecordsByTeamId | undefined, teamId: string): string {
  const row = records?.[teamId];
  return row === undefined ? "" : formatRecord(row);
}

/** The score, or the product's one glyph for "there is no number yet". Never a zero: a team that
 *  has not kicked off has not scored nothing, it has scored nothing YET. */
function scoreText(score: number | null): string {
  return score === null ? NOT_STARTED_DASH : formatPoints(score);
}

/**
 * The chips that answer "can I still win?" for one side — rendered BESIDE THAT SIDE'S OWN LINEUP,
 * never in the hero's middle column.
 *
 * That placement is a correction from looking at the rendered page rather than a preference. Two
 * "8 to play" chips stacked between the two scores are two identical sentences with nothing
 * saying which is whose, and a reader's honest conclusion is that the interface is repeating
 * itself. Sitting on its own team's lineup heading, the same chip needs no label at all: the team
 * name is already the thing it is attached to.
 *
 * SUNDAY v5, THE LIVE CHANNEL. Yet-to-play is the definition of channel three: points that can
 * still arrive are the only thing on a settled-looking screen that is still moving. It used to be
 * `Pill tone="hot"`, which resolved to the `negative` family — the same ink as a failed write —
 * and it is now `LiveMarker`, which is `live` and means nothing else ever. A side with nobody left
 * to play gets no marker at all rather than "0 to play": the absence IS the fact, and a chip
 * stating zero is noise on the one screen this product cannot afford noise on.
 *
 * The bench figure stays a plain `Pill`. It is regret, and regret is settled: those points cannot
 * arrive any more, so painting them in the live pigment would say the opposite of what they mean.
 * It renders only for the viewer's own side, because another manager's bench is not this manager's
 * regret and printing it for both sides turns a confession into a scoreboard stat.
 */
export function SideChips({ side, mine, weekStatus }: {
  readonly side: MatchupSide;
  readonly mine: boolean;
  /** The week's own state, so a settled week prints no live marker — see `remainingToPlay`. */
  readonly weekStatus: MatchupSummary["weekStatus"];
}) {
  const left = remainingToPlay(side, weekStatus);
  const bench = mine ? benchPoints(side) : null;
  if (left === 0 && bench === null) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {left === 0 ? null : <LiveMarker mono>{`${left} to play`}</LiveMarker>}
      {bench === null ? null : <Pill>{`${formatPoints(bench)} on your bench`}</Pill>}
    </span>
  );
}

export interface MatchupHeroProps {
  /**
   * The flattened matchup. A `MatchupSummary` rather than a `MatchupDetail` on purpose: the two
   * surfaces that render this hero hold different things. The matchup page has whole lineups; the
   * league home has only the week's fixture. Everything the hero itself draws — two names, two
   * ids, two scores, the margin — lives on the summary, so taking the smaller shape is what lets
   * one hero serve both instead of the league home keeping a second, quieter scoreboard of its own.
   */
  readonly matchup: MatchupSummary;
  readonly myTeamId: string | null;
  readonly records?: RecordsByTeamId;
}

/**
 * THE MATCHUP HERO — the screen's largest thing, and the reason law 2 was written.
 *
 * *"A score is 84px; its label is 11px. If the largest thing on a screen is not a number or a
 * name, the screen is wrong."* This is `Scoreboard` spent rather than admired: two 84px figures,
 * an 11px "Score" under each, and nothing else on the card allowed to grow into them.
 *
 * WHAT THE MIDDLE CARRIES, AND WHY IT IS NOW ONE THING AND NOT TWO. `Scoreboard`'s middle is a
 * slot because *"the middle is where a matchup's own story goes and every week's is different"*,
 * and it holds the points share: real arithmetic over points already on the board. Nothing here is
 * modelled — `PointsShareBar`'s own docblock says out loud that it is not a win probability, and
 * this file adds no forecast of its own.
 *
 * THE MARGIN SENTENCE IS GONE (Sunday v5, subtraction). *"You are up 3.00."* used to sit between
 * the two scores, which made the hero say one fact three times: the two 84px figures say who is
 * ahead, the share bar says by how much of the board, and the sentence said both again in words. A
 * previous track flagged it and this pass closes it. The margin did not leave the screen — it
 * moved to the lower third and became the DELTA it always was (`+3.00`), which is law 1's whole
 * point: a comparison is the figure that earns chroma, and a comparison dressed as a sentence is
 * neither a number nor a story.
 *
 * THE LEAD IS NOT A COLOUR, AND THAT DECISION STANDS. `SideProps.comparison` is deliberately not
 * passed. A matchup's population is a PAIR, so a percentile inside it is fully determined by who
 * is ahead — the leader is 1.0 and the trailer 0.0 whether the margin is 0.2 points or 60 — which
 * would paint a one-point lead in a blowout's ink and announce "Top 1% of the two teams in this
 * matchup" to a screen reader. The lead is carried by the larger figure, the "Leading"
 * micro-label `Scoreboard` prints, and `data-winning`. Every one of those survives a monochrome
 * screen.
 *
 * THE PROJECTED FINAL IS A DASH, ON PURPOSE. See `../lib/matchup-facts.ts`: no weekly per-player
 * projection reaches this layer, and Gameday's honesty clause forbids drawing one. The dash is
 * the product's own glyph for "there is no number yet", and it is the slot the projection lands
 * in the day the engine emits one.
 */
export function MatchupHero({ matchup, myTeamId, records }: MatchupHeroProps) {
  const { homeScore, awayScore, homeTeamId, awayTeamId, homeTeamName, awayTeamName } = matchup;
  const decided = homeScore !== null && awayScore !== null;
  const iAmAway = awayTeamId === myTeamId;
  const watching = myTeamId === homeTeamId || iAmAway;

  // `mine`/`theirs` for the share bar, from the viewer's own seat. A viewer with no team in this
  // matchup (a commissioner reading somebody else's game) gets the home side as "mine" and both
  // labels are team names, so the bar still divides the right two numbers under the right two
  // words — it just has no second person to speak to.
  const mineScore = iAmAway ? awayScore : homeScore;
  const theirsScore = iAmAway ? homeScore : awayScore;
  const theirsName = iAmAway ? homeTeamName : awayTeamName;
  const mineName = iAmAway ? awayTeamName : homeTeamName;

  // The seed and its movement, IN the bug's identity block rather than a spread-out row of its
  // own — the founder's centering note killed the old `SeedLine`, whose two halves sat 1,400px
  // apart under two scores that already were. Same data, same honesty gates: no records row, no
  // seed; no settled prior week, no arrow.
  const seedFor = (teamId: string) => {
    const row = records?.[teamId];
    if (row === undefined || row.rank === undefined) return undefined;
    return (
      <>
        <span className="font-display text-base font-bold tabular-nums text-text-muted">
          <span aria-hidden="true">{`#${row.rank}`}</span>
          <span className="sr-only">{`Seed ${row.rank}`}</span>
        </span>
        {row.previousRank === null ? null : <Movement places={row.previousRank - row.rank} against="last week" />}
      </>
    );
  };

  const sideFor = (name: string, teamId: string, score: number | null, otherScore: number | null) => ({
    name,
    record: recordFor(records, teamId),
    score: scoreText(score),
    // NO projected prop (founder, 2026-08-28): a projection exists nowhere in the product, and
    // "Proj —" printed on every hero was a label without a fact. The Scoreboard row returns the
    // day the engine publishes a weekly number this layer can read.
    crest: <Crest id={teamId} name={name} size={32} />,
    winning: decided && (score ?? 0) > (otherScore ?? 0),
    sub: seedFor(teamId),
  });

  return (
    <div className="flex flex-col gap-3">
      <Scoreboard
        home={sideFor(homeTeamName, homeTeamId, homeScore, awayScore)}
        away={sideFor(awayTeamName, awayTeamId, awayScore, homeScore)}
        middle={
          <div className="flex flex-col items-center gap-3 sm:w-52">
            <PointsShareBar
              className="w-full"
              mineLabel={watching ? "You" : mineName}
              theirsLabel={theirsName}
              mine={mineScore ?? 0}
              theirs={theirsScore ?? 0}
            />
          </div>
        }
      />
    </div>
  );
}
