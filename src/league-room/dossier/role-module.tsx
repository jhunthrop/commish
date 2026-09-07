import type { PlayerFactsRankedStat, PlayerFactsTrend, PlayerFactsUsage } from "@/capsules/facts";
import type { Position } from "@/domain/player";
import { Card, Stat } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { formatTenth, formatWhole } from "../lib/format";
import type { DefenseSeasonFacts, KdefSeasonLine, KickerSeasonFacts } from "@/projections/kdef/season-lines";

export interface RoleModuleProps {
  /** Not part of the dossier plan's own two-prop shorthand, but required by the format it binds
   *  ("{POS}{rank} of {n}") — a share rank carries no position of its own, only his. Added here
   *  rather than assumed from context, since a presentational module should own every fact its
   *  own copy states. */
  readonly position: Position;
  /** `null` for a player the prior-season usage store carries nothing for (a rookie, most often)
   *  — every share row then reads "not tracked for him", the identical text an individually
   *  absent share already prints. */
  readonly usage: PlayerFactsUsage | null;
  readonly trend: PlayerFactsTrend | null;
  /**
   * A KICKER'S OR A TEAM DEFENSE'S MEASURED SEASON (the 2026-09-06 round), when this is one of
   * those two positions and the archive holds a season for him. It REPLACES the share rows rather
   * than joining them: snap, target and red-zone share are all questions about an offensive role,
   * and neither of these two positions has one. `null`, and the module is exactly what it was.
   */
  readonly kdef?: KdefSeasonLine | null;
  /** THE WRITTEN TREND LINE (`narrativeSlot(capsule, "trend")`) — the writer's own sentence about
   *  the year-over-year move, rendered INSTEAD of the templated one below when the sweep produced
   *  and validated one. The two seasons and the delta are still shown by the template's own
   *  figures when there is no written line; a stat is never replaced by prose, only stated once. */
  readonly writtenTrend?: string | null;
  /** THE WRITTEN ABSENCE NOTE (`narrativeSlot(capsule, "absence:usage")`) — for a player the usage
   *  store carries nothing about at all. Absence said in a human voice instead of three rows of
   *  "not tracked for him". The rows stay: they are the shape of what is missing. */
  readonly absenceSentence?: string | null;
}

interface ShareRow {
  readonly key: string;
  readonly label: string;
  readonly share: number | null;
  readonly rank: PlayerFactsRankedStat | null;
}

function shareRows(usage: PlayerFactsUsage | null): readonly ShareRow[] {
  return [
    { key: "snap", label: "Snap share", share: usage?.snapShare ?? null, rank: usage?.snapShareRank ?? null },
    { key: "target", label: "Target share", share: usage?.targetShare ?? null, rank: usage?.targetShareRank ?? null },
    { key: "redzone", label: "Red-zone share", share: usage?.redZoneShare ?? null, rank: usage?.redZoneShareRank ?? null },
  ];
}

/** "62% · RB4 of 32", or the honest "not tracked for him" — never a bar with no number beside it
 *  (`meter.tsx`'s own rule, kept here by hand since this is not a `Meter`). A share with no real
 *  rank (the store has the share itself but never ranked it) still states the raw percentage. */
function shareValueText(position: Position, share: number | null, rank: PlayerFactsRankedStat | null): string {
  if (share === null) return "not tracked for him";
  const pct = Math.round(share * 100);
  return rank === null ? `${pct}%` : `${pct}% · ${position}${rank.positionRank} of ${rank.qualifierCount}`;
}

/**
 * THE TREND SENTENCE — "18.1 a game in 2024 fell to 14.3 in 2025, down 3.8. A real move, not
 * noise." Rendered ONLY when `trend.pointsPerGame` is both present and `material` (`trend.ts`'s
 * own honesty rule: a delta this small against the position's real spread is noise, and this
 * sentence exists specifically to state the ones that are not). The delta figure is the ONE
 * number on this module carrying the magnitude channel — routed through `Stat`, the only file
 * this product lets name a `-mag-` colour (`magnitude-budget.source.test.ts`), never a hand-rolled
 * class here. `percentile` is chosen to land the rise/decline cleanly inside `Stat`'s own "good"
 * (rise) or "weak" (decline) bands rather than "strong"/"bad" — a year-over-year move earns
 * attention, not the ramp's most extreme step, which this module has no evidence to claim.
 */
function trendSentence(priorSeason: number, priorValue: number, recentSeason: number, recentValue: number, delta: number) {
  const rising = delta > 0;
  const direction = rising ? "up" : "down";
  const verb = rising ? "rose" : "fell";
  return {
    // The direction word rides INSIDE the tinted `Stat` value (`${direction} ${delta}`, "down
    // 3.8") rather than sitting in this plain-text lead-in — `Stat` always prefixes a caret to a
    // non-neutral value, and splitting the word from its number would put that caret between
    // "down" and "3.8" in the rendered text, breaking the phrase a reader (or a screen reader)
    // sees as one unit.
    before: `${formatTenth(priorValue)} a game in ${priorSeason} ${verb} to ${formatTenth(recentValue)} in ${recentSeason},`,
    delta: `${direction} ${formatTenth(Math.abs(delta))}`,
    percentile: rising ? 0.75 : 0.25,
  };
}

/** One labelled figure, the shape every kicker and team defense row below takes. */
interface FactRow {
  readonly label: string;
  readonly value: string;
}

/** `24 of 28 · 86%`, or `0 of 0` with no rate at all, because a rate over no attempts is not 0%. */
function madeOf(made: number, attempted: number): string {
  return attempted === 0 ? `${made} of ${attempted}` : `${made} of ${attempted} · ${Math.round((made / attempted) * 100)}%`;
}

function perGame(total: number, games: number): string {
  return games === 0 ? "no games on record" : formatTenth(total / games);
}

/**
 * A KICKER'S SEASON, in the terms a kicker is judged in: how many he made of how many he tried,
 * banded by distance, and his extra points.
 *
 * THE LONGEST ROW NAMES A BAND AND NOT A DISTANCE. The published file records makes and misses in
 * brackets, never the yardage of any one kick, so "his longest was 56" is a number this product
 * does not hold. The band it can back is the band it states.
 */
function kickerRows(facts: KickerSeasonFacts): readonly FactRow[] {
  return [
    { label: "Field goals", value: madeOf(facts.fieldGoalsMade, facts.fieldGoalsAttempted) },
    ...facts.distanceBands.map((band) => ({ label: `${band.label} yards`, value: madeOf(band.made, band.attempted) })),
    { label: "Extra points", value: madeOf(facts.extraPointsMade, facts.extraPointsAttempted) },
    { label: "Longest make", value: facts.longestMadeBand === null ? "he made none" : `${facts.longestMadeBand} yards` },
  ];
}

/**
 * A TEAM DEFENSE'S SEASON, per game, because a defense that played fourteen weeks and one that
 * played seventeen are not comparable on totals.
 *
 * POINTS ALLOWED IS STATED OVER THE GAMES THAT CARRY IT, and the row says how many that was. A
 * defense week the archive has no scoreline for is scored without the points-allowed bracket at
 * all, so averaging it in as a zero would flatter it twice over.
 */
function defenseRows(facts: DefenseSeasonFacts, games: number): readonly FactRow[] {
  return [
    { label: "Sacks a game", value: perGame(facts.sacks, games) },
    { label: "Takeaways a game", value: perGame(facts.takeaways, games) },
    { label: "Defensive touchdowns", value: String(facts.defensiveTouchdowns) },
    {
      label: "Yards allowed a game",
      value: facts.gamesWithYardsAllowed === 0 ? "not recorded for these games" : formatWhole(facts.yardsAllowed / facts.gamesWithYardsAllowed),
    },
    {
      label: "Points allowed a game",
      value:
        facts.pointsAllowed === null
          ? "not recorded for any of these games"
          : `${perGame(facts.pointsAllowed, facts.gamesWithPointsAllowed)} over ${facts.gamesWithPointsAllowed} games`,
    },
  ];
}

/** How many of his games landed in each scoring bracket, the brackets the engine itself scores
 *  (`pointsAllowedBands`). Only the brackets he actually reached, so the row is a shape rather
 *  than a table of zeros. */
function BandMix({ facts }: { readonly facts: DefenseSeasonFacts }) {
  const reached = facts.pointsAllowedBandGames.filter((band) => band.games > 0);
  if (reached.length === 0) return null;
  return (
    <p className="text-sm text-text-muted" data-role="points-allowed-bands">
      <span className={`${MICRO_LABEL} text-text-faint`}>Points allowed, by bracket</span>{" "}
      {reached.map((band) => `${band.label} in ${band.games}`).join(", ")}
    </p>
  );
}

/** The measured season's own rows, whichever of the two positions this is. */
function KdefRows({ line }: { readonly line: KdefSeasonLine }) {
  const rows = line.facts.kind === "K" ? kickerRows(line.facts) : defenseRows(line.facts, line.games);
  return (
    <div className="flex flex-col gap-3">
      <p className={`${MICRO_LABEL} text-text-faint`}>
        {line.facts.kind === "K" ? "Kicker" : "Team defense"}, {line.season}, {line.games} games
      </p>
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-2 text-sm" data-role-fact={row.label}>
          <span className={`${MICRO_LABEL} text-text-faint`}>{row.label}</span>
          <span className="tabular-nums text-text-muted">{row.value}</span>
        </div>
      ))}
      {line.facts.kind === "DEF" ? <BandMix facts={line.facts} /> : null}
      {line.weeksMissingPointsAllowed === 0 ? null : (
        <p className="text-sm text-text-muted" data-role="points-allowed-gap">
          {line.weeksMissingPointsAllowed} of these games have no final score on record, and are scored without the points-allowed bracket.
        </p>
      )}
    </div>
  );
}

/**
 * THE ROLE MODULE (dossier plan, Task 4) — last season's usage, plain: a share bar per metric,
 * each stating its own percentage and position rank with the rank's own qualifier count, and the
 * year-over-year trend sentence when the store has one worth stating.
 *
 * ABSENCE IS A ROW, NOT A GAP — a share the store never tracked prints "not tracked for him" in
 * the same slot a real number would occupy, so the module's shape never depends on which shares
 * happen to exist. The trend line is genuinely absent (no row at all) when there is nothing
 * material to say, matching every other "nothing to say" surface on this product.
 */
export function RoleModule({ position, usage, trend, kdef = null, writtenTrend = null, absenceSentence = null }: RoleModuleProps) {
  const pointsPerGame = trend?.pointsPerGame ?? null;
  const trendMetric = pointsPerGame !== null && pointsPerGame.material ? pointsPerGame : null;

  if (kdef !== null) {
    return (
      <Card as="section" aria-label="Role" className="flex flex-col gap-4">
        <KdefRows line={kdef} />
      </Card>
    );
  }

  return (
    <Card as="section" aria-label="Role" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {shareRows(usage).map((row) => {
          const pct = row.share === null ? 0 : Math.round(row.share * 100);
          return (
            <div key={row.key} className="flex flex-col gap-1" data-role-share={row.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className={`${MICRO_LABEL} text-text-faint`}>{row.label}</span>
                <span className="tabular-nums text-text-muted">{shareValueText(position, row.share, row.rank)}</span>
              </div>
              <div className="h-1.5 w-full rounded-pill bg-surface-inset">
                <div className="h-full rounded-pill bg-text-muted" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      {usage !== null || absenceSentence === null ? null : (
        <p className="text-sm text-text-muted" data-role="usage-absence">
          {absenceSentence}
        </p>
      )}
      {trendMetric === null ? null : (
        <p className="flex flex-wrap items-baseline gap-1 text-sm text-text-muted" data-role="trend">
          {(() => {
            const { before, delta, percentile } = trendSentence(trendMetric.priorSeason, trendMetric.priorValue, trendMetric.recentSeason, trendMetric.recentValue, trendMetric.delta);
            return (
              <>
                <span>{before}</span>
                {/* THE SENTENCE ENDS ON THE NUMBER (dossier-voice round §3.4). The delta and its
                    full stop sit in one gapless inline box, so the period hugs "3.8" instead of
                    riding the row's own `gap-1` into ". A real move" with a space in front of it.
                    The closing clause is then an ordinary next word, one space along. */}
                <span className="inline-flex items-baseline" data-trend="delta">
                  <Stat
                    label="Year-over-year change"
                    srOnlyLabel
                    value={delta}
                    orientation="inline"
                    size="sm"
                    comparison={{ percentile, population: "the position's own year-over-year spread" }}
                  />
                  <span>.</span>
                </span>
                <span data-trend="close">A real move, not noise.</span>
              </>
            );
          })()}
        </p>
      )}
      {/* THE WRITER ACCOMPANIES THE STAT (review I3) — the two seasons, the delta and its tinted
          `Stat` stay exactly where they are, and the written line sits beneath them, the same
          shape `SeasonStrip` and the Books module already use. Rendered only where there is a
          measured trend to accompany: a sentence about a move the page is not showing would be a
          claim with nothing under it. */}
      {writtenTrend === null || trendMetric === null ? null : (
        <p className="text-sm text-text-muted" data-role="trend-written">
          {writtenTrend}
        </p>
      )}
    </Card>
  );
}
