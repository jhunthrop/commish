// THE TYPESCRIPT CASES, one per Python case of the same name (`research/parity/cases/`).
import { createNflverseClient } from "@/projections/nflverse/client";
import { ingestPlayerUniverse, ingestSeason, scheduleWeekAsOf } from "@/projections/nflverse/ingest";
import type { TsCase } from "./run";

/** `realIngestStats` (`src/jobs/season-week/deps.ts`) for one season: the season-week job's path. */
function seasonCase(season: number): TsCase {
  return async ({ db }) => {
    const client = createNflverseClient();
    const universe = await ingestPlayerUniverse(db, client);
    const scheduleAsOf = (await scheduleWeekAsOf([season])).get(season);
    await ingestSeason(db, client, universe, season, scheduleAsOf);
  };
}

export const TS_CASES: Readonly<Record<string, TsCase>> = {
  "nflverse-universe": async ({ db }) => {
    await ingestPlayerUniverse(db, createNflverseClient());
  },
  "nflverse-season-2024": seasonCase(2024),
  "nflverse-season-2012": seasonCase(2012),
  "nflverse-season-2025": seasonCase(2025),
};
