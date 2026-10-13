// Builds the shipped preseason board for one or more seasons and WRITES IT DOWN. The work is
// `persistSeason` (`@research-ts/projections/preseason/persist`), whose docblocks carry the history;
// this file owns only the arguments.
// Run: npm run projections:preseason:persist [season ...]   (defaults to every ingested season)
//      npm run projections:preseason:persist -- --unfreeze   (overrides FROZEN_BOARD_SOURCES, 2027 round)
//      npm run projections:preseason:persist -- --diff-reasons  (prints what would change, writes nothing)
//      npm run projections:preseason:persist -- --formats=half,std  (a subset of the three blended boards)
import { createDb } from "@research-ts/db/client";
import { nflPlayers } from "@research-ts/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { requireEnv } from "@research-ts/lib/env";
import { BOARD_FORMATS, isBoardFormat, type BoardFormat } from "@research-ts/projections/preseason/board-formats";
import { INGESTED_SEASONS, persistSeason } from "@research-ts/projections/preseason/persist";

const ARGUMENTS = process.argv.slice(2);
const UNFREEZE = ARGUMENTS.includes("--unfreeze");
const DIFF_REASONS = ARGUMENTS.includes("--diff-reasons");
const SEASONS = ARGUMENTS.filter((argument) => !argument.startsWith("--")).map(Number);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : INGESTED_SEASONS;
const SYSTEM_CLOCK: Clock = { now: () => new Date().toISOString() };

/** `--formats=half,std` narrows the blended legs; the default is all three. The raw v1 leg is
 *  format-free and always runs. */
function parseFormats(argv: readonly string[]): readonly BoardFormat[] {
  const flag = argv.find((argument) => argument.startsWith("--formats="));
  if (flag === undefined) return BOARD_FORMATS;
  return flag
    .slice("--formats=".length)
    .split(",")
    .map((value) => {
      if (!isBoardFormat(value)) throw new Error(`"${value}" is not a board format (${BOARD_FORMATS.join(", ")}).`);
      return value;
    });
}

async function main(): Promise<void> {
  if (UNFREEZE) {
    console.warn(
      "--unfreeze: OVERRIDING FROZEN_BOARD_SOURCES. This run may retire the live generation the product " +
        "serves and may rewrite an archive's stored reasons. See board-store.ts's FROZEN_BOARD_SOURCES for " +
        "the ruling this lifts, and be sure BOARD_SOURCE is the name you mean to write under.",
    );
  }
  if (DIFF_REASONS) {
    console.log("--diff-reasons: building each board and printing what its stored reasons would become. NOTHING is written.");
  }
  const db = createDb(requireEnv("DATABASE_URL"));
  const names = new Map(
    (await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name] as const),
  );
  const formats = parseFormats(ARGUMENTS);
  for (const season of TARGET_SEASONS) {
    await persistSeason(db, season, SYSTEM_CLOCK, names, { unfrozen: UNFREEZE, formats, diffOnly: DIFF_REASONS });
  }
  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
