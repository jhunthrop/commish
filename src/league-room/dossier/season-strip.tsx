import type { ReactNode } from "react";
import type { PlayerFactsLastSeasonStory } from "@research/capsules/facts";
import { Card, SeasonBars, type SeasonWeek } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { formatTenth, formatWhole, ordinal } from "../lib/format";

export interface SeasonStripProps {
  readonly story: PlayerFactsLastSeasonStory;
  /** Every week that has happened, in order — the identical `SeasonWeek[]` shape `SeasonBars`
   *  already draws in the current peek, so this module reuses that renderer rather than a second
   *  chart implementation. */
  readonly weeks: readonly SeasonWeek[];
  readonly scoringLabel: string;
  /**
   * The season switcher slot — `player-peek.tsx` mounts `<SeasonSwitcher>` beside a "{season}
   * season" label today; Task 5 composes that same element (or whatever names/steps between
   * seasons) here rather than this module inventing its own switcher. `undefined` (the default)
   * renders nothing, exactly like the peek's own switcher already does for a single-season player.
   */
  readonly switcher?: ReactNode;
  /** THE WRITTEN LAST-SEASON LINE (`narrativeSlot(capsule, "story")`) — one sentence about the
   *  shape of the season, under the five stated facts. The facts are stats and stay exactly as
   *  they are; this only ever adds the sentence a person would say about them. */
  readonly sentence?: string | null;
}

interface SeasonFact {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
}

/** The five facts, in the mock's own order. Every number states its base as a small sub-line —
 *  "of {qualifierCount}" for a rank, the scoring format for a per-game rate, the week for a best
 *  week — never a bare figure. */
function factsFor(story: PlayerFactsLastSeasonStory, scoringLabel: string): readonly SeasonFact[] {
  return [
    { label: "Games", value: String(story.gamesPlayed) },
    { label: "Finish", value: ordinal(story.pointsRank.positionRank), sub: `of ${story.pointsRank.qualifierCount}` },
    { label: "Points per game", value: `${formatTenth(story.pointsPerGame)} a game`, sub: scoringLabel },
    { label: "Best week", value: formatTenth(story.bestWeek.points), sub: `week ${story.bestWeek.week}` },
    { label: "Receiving yards", value: formatWhole(story.receivingYardsRank.value), sub: `${ordinal(story.receivingYardsRank.positionRank)} of ${story.receivingYardsRank.qualifierCount}` },
  ];
}

/**
 * THE SEASON STRIP (dossier plan, Task 4) — last season's story as five stated facts plus the
 * full-season bar chart (`SeasonBars`, already the peek's own right-sized chart: played weeks
 * scaled to the max, missed weeks a flat hole, every column from week one). This module composes
 * `SeasonBars` rather than drawing its own bars — one chart renderer, not two that could drift.
 */
export function SeasonStrip({ story, weeks, scoringLabel, switcher, sentence = null }: SeasonStripProps) {
  const facts = factsFor(story, scoringLabel);
  return (
    <Card as="section" aria-label={`${story.season} season`} className="flex flex-col gap-4">
      {switcher === undefined ? null : <div className="flex justify-end">{switcher}</div>}
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {facts.map((fact) => (
          <div key={fact.label} className="flex flex-col" data-season-fact={fact.label}>
            <span className={`${MICRO_LABEL} text-text-faint`}>{fact.label}</span>
            <span className="font-display text-xl font-bold tabular-nums text-text-primary">{fact.value}</span>
            {fact.sub === undefined ? null : <span className="text-xs text-text-faint">{fact.sub}</span>}
          </div>
        ))}
      </div>
      {sentence === null ? null : (
        <p className="text-sm text-text-muted" data-season="written">
          {sentence}
        </p>
      )}
      <SeasonBars label={`His ${story.season} season, points by week`} weeks={weeks} />
    </Card>
  );
}
