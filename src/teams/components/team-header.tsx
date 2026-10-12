import { Card, PlayerFace, Stat } from "@/components/ui";
import type { Player } from "@research/domain/player";
import type { TeamPageData } from "../contract";
import { formatStampedDate, formatTeamRecord } from "./format";

interface HeaderFigure {
  readonly label: string;
  readonly value: string;
}

/** The figures the header states, each only when held (law 7). Pure. */
export function headerFigures(data: TeamPageData): readonly HeaderFigure[] {
  const figures: HeaderFigure[] = [];
  const record = data.lastSeason?.record ?? null;
  const allowed = data.lastSeason?.pointsAllowed ?? null;
  if (record !== null && data.lastSeason !== null) figures.push({ label: `${data.lastSeason.season} record`, value: formatTeamRecord(record) });
  if (allowed !== null && data.lastSeason !== null) figures.push({ label: `${data.lastSeason.season} points allowed, ${allowed.games} games`, value: String(allowed.points) });
  if (data.winTotal !== null) figures.push({ label: `Books win total, ${formatStampedDate(data.winTotal.asOf)}`, value: String(data.winTotal.line) });
  return figures;
}

/**
 * THE CLUB AS AN OBJECT (law 3): its colour as the ring around its initials, the same construction
 * every player's face uses, the city over the nickname at the size a player's own screen gives his
 * name, the code and the bye on the mono line, and the three header figures beside it.
 */
export function TeamHeader({ data }: { readonly data: TeamPageData }) {
  const asFace: Player = { id: data.code, name: `${data.city} ${data.nickname}`, position: "DEF", nflTeam: data.code, headshotUrl: null, adp: null };
  const figures = headerFigures(data);
  return (
    <Card as="header" className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
      <PlayerFace player={asFace} size="xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-xs text-text-muted">{data.byeWeek === null ? data.code : `${data.code} · Bye week ${data.byeWeek}`}</span>
          <h1 className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
            <span className="sr-only">{`${data.city} ${data.nickname}`}</span>
            <span aria-hidden="true" className="text-lg leading-tight text-text-muted">{data.city}</span>
            <span aria-hidden="true" className="font-display text-display-md font-semibold leading-display text-text-primary sm:text-display-lg">{data.nickname}</span>
          </h1>
        </div>
        {figures.length === 0 ? null : (
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {figures.map((figure) => (
              <Stat key={figure.label} label={figure.label} value={figure.value} size="md" />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
