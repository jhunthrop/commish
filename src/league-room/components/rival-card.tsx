import Link from "next/link";
import { BigNumber, Card, Manager } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { HeadToHeadRecord } from "@/league";
import type { LeagueHomeBody, MatchupDetail, MatchupWeekBody } from "../contract";
import { formatWeek } from "../lib/format";
import { headToHeadLine, rivalFacts, type RivalFacts, type RivalSide } from "../lib/rival";
import { weekStoryFor, type WeekStory } from "../lib/week-story";

export interface RivalCardProps {
  readonly home: LeagueHomeBody;
  readonly week: MatchupWeekBody | null;
  readonly myMatchupDetail: MatchupDetail | null;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
  readonly regularSeasonWeeks: number | null;
  /** The viewer's own settled history against each opponent, keyed by that opponent's team id. */
  readonly headToHead: ReadonlyMap<string, HeadToHeadRecord>;
}

function SideRow({ side, ring }: { readonly side: RivalSide; readonly ring: "self" | "rival" }) {
  return (
    <Manager
      name={side.owner?.name ?? side.teamName}
      avatar={side.owner?.avatar ?? null}
      ring={ring}
      size="lg"
      meta={side.owner === null ? undefined : side.teamName}
      trailing={<BigNumber size="sm" value={side.figure.value} basis={side.figure.basis} />}
    />
  );
}

/** What to say when you have no game this week, from the league's own facts. */
function noGameSentence(story: WeekStory, weekNumber: number): string {
  switch (story.kind) {
    case "season-over":
      return story.champion === null ? `The season is over after ${formatWeek(story.finalWeek).toLowerCase()}.` : `The season is over. ${story.champion} won it.`;
    case "playoffs-out":
      return `You are out of the playoffs. ${story.roundLabel} is on without you this week.`;
    case "quiet-week":
      return `No game for you in ${formatWeek(story.weekNumber).toLowerCase()}.`;
    default:
      return `No schedule yet for ${formatWeek(weekNumber).toLowerCase()}.`;
  }
}

/**
 * YOUR RIVAL, ALWAYS IN THE FRAME (P6): your opponent this week with a face, a name and a score,
 * at the top of the league's front page, above the standings and everything else. You wear the
 * amber ring, they wear the rose one. Each side's one number names its basis (final, so far,
 * projected, or a dash that says why). With no game this week the card says so in the league's
 * own words rather than showing an empty pairing.
 */
export function RivalCard({ home, week, myMatchupDetail, projectionsByPlayerId, regularSeasonWeeks, headToHead }: RivalCardProps) {
  const facts = rivalFacts({ matchup: myMatchupDetail, myTeamId: home.myTeamId, teams: home.teams, weekStatus: home.weekStatus, projectionsByPlayerId });
  if (facts === null) {
    const story = weekStoryFor({ week, hasMyMatchup: false, standings: home.standings, regularSeasonWeeks });
    return (
      <Card as="section" aria-label="Your game this week" data-testid="rival-card" className="flex flex-col gap-1">
        <p className={`${MICRO_LABEL} text-text-faint`}>This week</p>
        <p className="text-md text-text-primary">{noGameSentence(story, home.currentWeek)}</p>
      </Card>
    );
  }
  return (
    <Card as="section" aria-label="Your game this week" data-testid="rival-card" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className={`${MICRO_LABEL} text-text-faint`}>{formatWeek(facts.weekNumber)}, your game</p>
        <Link href={`/app/leagues/${home.leagueId}/matchups/${facts.weekNumber}`} className="text-sm font-semibold text-accent">
          Open the matchup
        </Link>
      </div>
      <SideRow side={facts.mine} ring="self" />
      <SideRow side={facts.theirs} ring="rival" />
      <HeadToHead facts={facts} headToHead={headToHead} />
    </Card>
  );
}

/**
 * WHAT HAS HAPPENED BETWEEN THE TWO OF YOU (P6), under the two faces it is about. Renders only
 * when there is a settled game to count: no line, no rule, no reserved space — a card between two
 * managers meeting for the first time simply does not have this part.
 */
function HeadToHead({ facts, headToHead }: { readonly facts: RivalFacts; readonly headToHead: ReadonlyMap<string, HeadToHeadRecord> }) {
  const line = headToHeadLine(headToHead.get(facts.theirs.teamId) ?? null, facts.theirs.owner?.name ?? facts.theirs.teamName);
  if (line === null) return null;
  return (
    <div data-testid="head-to-head" className="flex flex-col gap-0.5 border-t border-line pt-3">
      <p className="text-md font-semibold text-text-primary">{line.text}</p>
      <p className={`${MICRO_LABEL} text-text-faint`}>{line.basis}</p>
    </div>
  );
}
