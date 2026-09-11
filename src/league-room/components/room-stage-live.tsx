"use client";

import Link from "next/link";
import { BigNumber, ButtonLink, Card, LiveChip, LowerThird, Manager, PlayerFace, PositionBadge, ScoreBug } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { ROW_META_CLASS, ROW_NAME_CLASS, rowShellClass } from "@/components/ui/player-row";
import { useValueChangeHighlight } from "@/design/use-value-change-highlight";
import { TOKENS } from "@/design/tokens";
import type { FixtureLabel } from "@/league-service/nfl-schedule";
import type { MatchupDetail, MatchupLineupEntry, MatchupSide, MatchupWeekBody } from "../contract";
import { useLiveScores } from "../hooks/use-live-scores";
import { formatPoints } from "../lib/format";
import type { ManagersByTeamId } from "../lib/managers";
import { remainingToPlay } from "../lib/matchup-facts";
import { playerOf } from "../lib/player";

export interface RoomStageLiveProps {
  readonly leagueId: string;
  readonly week: MatchupWeekBody;
  readonly myMatchupDetail: MatchupDetail;
  readonly myTeamId: string;
  readonly fixturesByNflTeam: ReadonlyMap<string, FixtureLabel>;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
  /** Every team's manager. Omitted (a test that does not care) falls back to the team name as the
   *  person's name, which is honest about what the surface was handed rather than inventing one. */
  readonly managers?: ManagersByTeamId;
}

function initialScores(week: MatchupWeekBody): readonly { readonly teamId: string; readonly points: number }[] {
  return week.matchups.flatMap((matchup) => [
    ...(matchup.home.score === null ? [] : [{ teamId: matchup.home.teamId, points: matchup.home.score }]),
    ...(matchup.away.score === null ? [] : [{ teamId: matchup.away.teamId, points: matchup.away.score }]),
  ]);
}

/** The highest-projected starter on a side who has not scored yet — the honest "who is left" this
 *  product can compute from current-week projections, with nothing invented. */
function bestLeft(side: MatchupSide, projections: ReadonlyMap<string, number>): MatchupLineupEntry | null {
  let top: MatchupLineupEntry | null = null;
  let topProjection = Number.NEGATIVE_INFINITY;
  for (const entry of side.starters) {
    if (entry.playerId === null || entry.points !== null) continue;
    const projection = projections.get(entry.playerId);
    if (projection === undefined || projection <= topProjection) continue;
    top = entry;
    topProjection = projection;
  }
  return top;
}

/** A player's surname, which is how anybody in a group chat says his name once the room knows who
 *  he is. "Skattebo", not "Cam Skattebo". */
function lastName(name: string): string {
  const parts = name.trim().split(" ");
  return parts[parts.length - 1] ?? name;
}

/**
 * THE BORROWED SENTENCE: *"You need 11.4 from Cook"* (section 5 of the first-principles document,
 * Sunday only). It is arithmetic and never a forecast, which is the only reason it is allowed to
 * be this confident: the gap is two numbers already on the board subtracted, and the name is the
 * highest-projected starter on that side who has not played. Both inputs are printed or beside it
 * on the same screen.
 *
 * It speaks to whoever is BEHIND, because that is who has a question. Level with nobody left, or a
 * week with no scores yet, returns `null` and the strip is plain facts and one verb, which is what
 * the lower third is off Sunday anyway.
 */
function needSentence(
  mine: MatchupSide,
  theirs: MatchupSide,
  myScore: number | null,
  theirScore: number | null,
  theirManager: string,
  projections: ReadonlyMap<string, number>,
): string | null {
  if (myScore === null || theirScore === null) return null;
  const margin = myScore - theirScore;
  if (margin < 0) {
    const man = bestLeft(mine, projections);
    if (man === null || man.playerName === null) return null;
    return `You need ${formatPoints(Math.abs(margin))} from ${lastName(man.playerName)} to catch ${theirManager}.`;
  }
  const man = bestLeft(theirs, projections);
  if (man === null || man.playerName === null) return null;
  return `${theirManager} needs ${formatPoints(margin)} from ${lastName(man.playerName)} to catch you.`;
}

/**
 * ONE STARTER ON SUNDAY: his face, his name, where his game is, and the one number with its basis.
 *
 * PER-PLAYER POINTS ARE REQUEST-TIME, and this row says so by what it does NOT do: `score.update`
 * carries team totals only, never a per-player breakdown, so no highlight is armed here. Arming a
 * wash on a value that cannot change under the reader is a promise of motion the data never keeps
 * — the same refusal `LiveMatchupWeek` already makes about its yet-to-play counts.
 */
function StarterRow({
  entry,
  fixture,
  projection,
}: {
  readonly entry: MatchupLineupEntry;
  readonly fixture: FixtureLabel | null;
  readonly projection: number | null;
}) {
  const player = playerOf(entry);
  const live = fixture?.status === "in_progress";
  const waiting = entry.points === null;
  const figure = waiting
    ? { value: projection === null ? null : formatPoints(projection), basis: projection === null ? "no projection" : "projected, PPR" }
    : { value: formatPoints(entry.points ?? 0), basis: fixture?.status === "final" ? "PPR, final" : "PPR so far" };
  return (
    <div className={rowShellClass(false, waiting ? "opacity-70" : "")}>
      {player === null ? (
        <span aria-hidden="true" className="size-9 shrink-0 rounded-pill border border-dashed border-edge" />
      ) : (
        <PlayerFace player={player} size="md" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`${ROW_NAME_CLASS}${player === null ? " text-text-muted" : ""}`}>{entry.playerName ?? "Empty slot"}</span>
        <span className={ROW_META_CLASS}>
          {entry.position === null ? null : <PositionBadge position={entry.position} size="sm" />}
          {live ? <LiveChip>Playing</LiveChip> : fixture === null ? null : <span className="truncate">{fixture.when}</span>}
        </span>
      </div>
      <BigNumber value={figure.value} basis={figure.basis} size="sm" className="shrink-0" />
    </div>
  );
}

/** One other fixture in the week, as two managers and two live numbers. The row washes for 600ms
 *  when either score changes, which on this page is the ONLY per-row value the wire moves. */
function AroundRow({ href, home, away }: {
  readonly href: string;
  readonly home: { readonly name: string; readonly avatar: string | null; readonly score: number | null };
  readonly away: { readonly name: string; readonly avatar: string | null; readonly score: number | null };
}) {
  const changed = useValueChangeHighlight(`${home.score ?? "-"}:${away.score ?? "-"}`);
  return (
    <Link
      href={href}
      className={`flex min-h-12 items-center gap-3 rounded-md px-2.5 py-1 transition-colors ${changed ? "bg-live-glow" : "hover:bg-surface"}`}
      style={{ transitionDuration: `${TOKENS.motion.duration.highlight}ms` }}
    >
      <Manager name={home.name} avatar={home.avatar} size="sm" className="flex-1" trailing={<span className="font-display font-bold tabular-nums">{home.score === null ? "–" : formatPoints(home.score)}</span>} />
      <span aria-hidden="true" className="shrink-0 text-text-faint">·</span>
      <Manager name={away.name} avatar={away.avatar} size="sm" className="flex-1" trailing={<span className="font-display font-bold tabular-nums">{away.score === null ? "–" : formatPoints(away.score)}</span>} />
    </Link>
  );
}

/**
 * SUNDAY'S STAGE.
 *
 * The two bounded borrowings from Under the Lights land here and nowhere else (section 5 of
 * `docs/design/2026-09-10-first-principles.md`): the SCORE BUG at the top, with a manager's face
 * on each side and the two figures flanking the margin, and the LOWER THIRD at the foot carrying
 * the one sentence the afternoon has come down to. Everything between them is Sideline: 48px rows,
 * 36px faces, one number per row with its basis.
 *
 * P4, MEASURED. Live team totals ride the SSE stream (`useLiveScores`). Exactly three things on
 * this page are wired to a change: the two team scores in the bug, the margin between them, and
 * each around-the-league row. Every one of them slides or washes its OWN element; nothing on the
 * page changes size when a frame lands, which is what keeps the layout shift at zero. Per-player
 * figures are request-time and are deliberately not wired — see `StarterRow`.
 *
 * There is no projected final and no win probability anywhere on this surface, because nothing in
 * the platform computes one.
 */
export function RoomStageLive(props: RoomStageLiveProps) {
  const { leagueId, week, myMatchupDetail, myTeamId, fixturesByNflTeam, projectionsByPlayerId, managers } = props;
  const live = useLiveScores(leagueId, {
    week: week.weekNumber,
    status: week.weekStatus,
    scores: initialScores(week),
    gamesFinal: week.gamesFinal,
    gamesTotal: week.gamesTotal,
  });

  const iAmHome = myMatchupDetail.home.teamId === myTeamId;
  const mySide = iAmHome ? myMatchupDetail.home : myMatchupDetail.away;
  const theirSide = iAmHome ? myMatchupDetail.away : myMatchupDetail.home;
  const myScore = live.scores.get(mySide.teamId) ?? mySide.score;
  const theirScore = live.scores.get(theirSide.teamId) ?? theirSide.score;
  const margin = myScore === null || theirScore === null ? null : myScore - theirScore;
  const myRemaining = remainingToPlay(mySide, live.status);
  const theirRemaining = remainingToPlay(theirSide, live.status);

  // `String`, never the number: `null` is a real state here (no score yet), and coercing it to a
  // zero would flash the figure the instant the first score landed, reporting a change from a
  // number that never existed.
  const myFlash = useValueChangeHighlight(String(myScore));
  const theirFlash = useValueChangeHighlight(String(theirScore));
  const marginFlash = useValueChangeHighlight(String(margin));

  const managerOf = (teamId: string, teamName: string) => managers?.[teamId] ?? { name: teamName, avatar: null, record: "" };
  const myManager = managerOf(mySide.teamId, mySide.teamName);
  const theirManager = managerOf(theirSide.teamId, theirSide.teamName);

  const otherMatchups = week.matchups.filter(
    (matchup) => matchup.home.teamId !== myTeamId && matchup.away.teamId !== myTeamId,
  );

  const fixtureOf = (entry: MatchupLineupEntry): FixtureLabel | null =>
    entry.nflTeam === null ? null : (fixturesByNflTeam.get(entry.nflTeam) ?? null);
  const projectionOf = (entry: MatchupLineupEntry): number | null =>
    entry.playerId === null ? null : (projectionsByPlayerId.get(entry.playerId) ?? null);

  const isLive = live.status === "in_progress";
  const say = needSentence(mySide, theirSide, myScore, theirScore, theirManager.name, projectionsByPlayerId);

  return (
    // `data-week` is a TEST CONTRACT: `useLiveScores` refuses a `score.update` frame for any week
    // but this one, and the Sunday spec has no other way to learn which week the stage is showing.
    <div data-testid="live-stage" data-week={week.weekNumber} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <ScoreBug
        live={isLive}
        mine={{
          teamId: mySide.teamId,
          managerName: myManager.name,
          managerAvatar: myManager.avatar,
          teamName: mySide.teamName,
          record: myManager.record,
          score: myScore === null ? null : formatPoints(myScore),
          basis: "yours, PPR",
          changed: myFlash,
          ring: "self",
        }}
        theirs={{
          teamId: theirSide.teamId,
          managerName: theirManager.name,
          managerAvatar: theirManager.avatar,
          teamName: theirSide.teamName,
          record: theirManager.record,
          score: theirScore === null ? null : formatPoints(theirScore),
          basis: "theirs, PPR",
          changed: theirFlash,
          ring: "rival",
        }}
        margin={margin === null ? null : `${margin >= 0 ? "+" : "−"}${formatPoints(Math.abs(margin))}`}
        marginLabel={margin === null ? "Margin" : margin >= 0 ? "Your lead" : "Their lead"}
        marginChanged={marginFlash}
        meta={`${live.gamesFinal} of ${live.gamesTotal} games final`}
      />

      {/* Both lineups, head to head. The person owns the column heading, not the team. */}
      <div className="grid min-h-0 flex-1 content-start gap-3 md:grid-cols-2">
        <Card padding="compact" className="flex flex-col gap-0.5">
          <p className={`${MICRO_LABEL} flex items-center gap-2 px-2.5 pb-1 text-text-faint`}>
            Yours
            {myRemaining === 0 ? null : <span className="normal-case tracking-normal">{`${myRemaining} still to play`}</span>}
          </p>
          {mySide.starters.map((entry) => (
            <StarterRow key={`${entry.slot}-${entry.slotIndex}`} entry={entry} fixture={fixtureOf(entry)} projection={projectionOf(entry)} />
          ))}
        </Card>
        <Card padding="compact" className="flex flex-col gap-0.5">
          <p className={`${MICRO_LABEL} flex items-center gap-2 px-2.5 pb-1 text-text-faint`}>
            {`${theirManager.name}'s`}
            {theirRemaining === 0 ? null : <span className="normal-case tracking-normal">{`${theirRemaining} still to play`}</span>}
          </p>
          {theirSide.starters.map((entry) => (
            <StarterRow key={`${entry.slot}-${entry.slotIndex}`} entry={entry} fixture={fixtureOf(entry)} projection={projectionOf(entry)} />
          ))}
        </Card>
      </div>

      {otherMatchups.length === 0 ? null : (
        <Card padding="compact" className="flex flex-col gap-0.5">
          <p className={`${MICRO_LABEL} px-2.5 pb-1 text-text-faint`}>Around the league</p>
          {otherMatchups.map((matchup) => (
            <AroundRow
              key={`${matchup.home.teamId}-${matchup.away.teamId}`}
              href={`/app/leagues/${leagueId}/matchups/${week.weekNumber}`}
              home={{ ...managerOf(matchup.home.teamId, matchup.home.teamName), score: live.scores.get(matchup.home.teamId) ?? matchup.home.score }}
              away={{ ...managerOf(matchup.away.teamId, matchup.away.teamName), score: live.scores.get(matchup.away.teamId) ?? matchup.away.score }}
            />
          ))}
        </Card>
      )}

      {/* THE LOWER THIRD, Sunday only. The sentence, the facts it rests on, and the one verb. */}
      <LowerThird
        live={isLive}
        say={say ?? undefined}
        cells={[
          ...(live.gamesTotal === 0 ? [] : [{ label: "Games final", value: `${live.gamesFinal}/${live.gamesTotal}` }]),
          { label: "Your margin", value: margin === null ? "–" : `${margin >= 0 ? "+" : "−"}${formatPoints(Math.abs(margin))}` },
          ...(myRemaining === 0 ? [] : [{ label: "Still to play", value: <span className="text-live">{myRemaining}</span> }]),
        ]}
        action={
          <ButtonLink href={`/app/leagues/${leagueId}/team`} variant="verb" size="sm">
            Open your team
          </ButtonLink>
        }
      />
    </div>
  );
}
