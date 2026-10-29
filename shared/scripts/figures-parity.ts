/** The League page's figures (Lane 292) as the web's readers draw them (web/src/lib/league/home/
 * figures.ts), for the apps' ports to hold to: the member's Proj gap at each fixture clock (drawn only
 * before the game's kickoff), the power panel over the fixture's power answer, and the start and sit
 * row over each record case. Each case carries the answer's fields it reads, so a port reads the
 * same input the web did. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { REPOSITORY } from "./generated.ts";
import { bugsOf } from "../../web/src/lib/league/home/home.ts";
import {
  gapFigure,
  powerPanel,
  startSitRow,
} from "../../web/src/lib/league/home/figures.ts";
import { withFigures } from "../../web/scripts/inseason-fixture/figures.ts";
import { START_SIT_BASIS } from "../../web/scripts/inseason-fixture/record.ts";
import type { LeagueSync } from "../../web/src/lib/league/api.ts";
import type {
  LeagueRecord,
  Scoreboard,
} from "../../web/src/lib/league/inseason/api.ts";

export const FIGURES_OUTPUT = "shared/fixtures/parity/league-figures.json";

const INSEASON = "shared/fixtures/inseason";

async function answer<T>(file: string): Promise<T> {
  const text = await readFile(join(REPOSITORY, INSEASON, file), "utf8");
  return (JSON.parse(text) as { data: T }).data;
}

const LINEUP: LeagueRecord["lineup"] = {
  qb: 1,
  rb: 2,
  wr: 2,
  te: 1,
  flex: 1,
  super_flex: 0,
  k: 1,
  def: 1,
  bench: 7,
};

/** The record cases: our picks ahead, the member's ahead, level, and an answer with none. */
const RECORDS: readonly { name: string; record: LeagueRecord }[] = [
  { name: "ours-ahead", record: recordOf(5, 3, 12.4) },
  { name: "set-ahead", record: recordOf(4, 1, -3.1) },
  { name: "level", record: recordOf(2, 2, 0) },
  {
    name: "none",
    record: { host: "sleeper", teams: 12, lineup: LINEUP, weeks: [] },
  },
];

function recordOf(
  weeks: number,
  matched: number,
  oursLessSet: number,
): LeagueRecord {
  return {
    host: "espn",
    teams: 12,
    lineup: LINEUP,
    weeks: [],
    start_sit: {
      weeks,
      matched,
      ours_less_set: oursLessSet,
      basis: START_SIT_BASIS,
    },
  };
}

/** The figures over the fixture league at each clock, and the record cases. */
export async function renderFigures(
  about: string,
  league: string,
  zone: string,
  clocks: readonly string[],
  instantOf: (clock: string) => string,
): Promise<string> {
  const sync = await answer<LeagueSync>(`leagues-attached-${league}.json`);
  const gaps: Record<string, unknown> = {};
  let power: unknown = null;
  for (const clock of clocks) {
    const board = withFigures(
      await answer<Scoreboard>(`scoreboard-${league}-${clock}.json`),
      sync,
    );
    const now = instantOf(clock);
    const bugs = bugsOf(board, sync, Date.parse(now), zone, {
      host: sync.host,
      readAt: board.read_at,
    });
    const upcoming = bugs.some((b) => b.mine && b.state === "upcoming");
    gaps[clock] = {
      now,
      upcoming,
      games: board.games.map((g) => ({
        rosters: g.sides.map((s) => s.roster_id),
        projections: g.sides.map((s) => s.projection),
        projection_gap: g.projection_gap ?? null,
      })),
      figure: gapFigure(board, sync.me, upcoming),
    };
    power ??= { answer: board.power, panel: powerPanel(board, sync) };
  }
  const records = Object.fromEntries(
    RECORDS.map(({ name, record }) => [
      name,
      { start_sit: record.start_sit ?? null, row: startSitRow(record) },
    ]),
  );
  return `${JSON.stringify({ about, league, me: sync.me, gaps, power, records }, null, "\t")}\n`;
}
