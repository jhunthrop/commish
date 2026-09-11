// Dev-only: seeds a SMALL, clearly-bounded synthetic current-season fixture — a handful of
// weeks, a few hundred `player_stat_lines` rows — so a player card has something to show for
// the CURRENT season on a local machine, without fabricating a whole seventeen-week league.
//
// Run: ALLOW_DESTRUCTIVE_SEED=1 dotenv -e .env.local -- tsx scripts/dev-seed-stat-fixtures.ts
//
// FOUNDER LAW (2026-09-04, after today's prod leak of a fully fabricated season): fabricated
// stat data NEVER leaves localhost. `assertLocalSeedTarget` is not a formality here — it is the
// entire reason this script is safe to keep in the repository. It throws unless the operator has
// explicitly opted in (`ALLOW_DESTRUCTIVE_SEED=1`) AND `DATABASE_URL` resolves to a loopback
// host; anything else (unset, unparseable, remote) refuses. There is no override for the second
// check and there must never be one — see the guard's own docblock.
//
// WHY THIS EXISTS INSTEAD OF THE OLD HABIT: before today, exercising the current-season path
// locally meant a fully fabricated seventeen-week season for a synthetic 250-player roster
// (`src/stats/mock/generate-dataset.ts`, `PLAYER_COUNT * SEASON_WEEKS` = 4,250 lines) — which is
// exactly the shape of data that leaked into production. This script seeds REAL local players
// (whatever `players` already holds from `seed-players.ts`), a HANDFUL of weeks, and stops there.
// It reuses that same file's `statLineFor` for realistic per-position magnitudes — the ranges are
// proven and tested there — but writes only `WEEK_COUNT * PLAYER_CAP` rows, capped well below
// "few hundred" on purpose: this is a fixture for the player-card season widening, not a season.
import { getDb } from "@/db/client";
import { players, playerStatLines, statWeeks } from "@/db/schema";
import { excludedSetFor } from "@/db/upsert";
import { assertLocalSeedTarget } from "@/data/seed/guard";
import { mulberry32 } from "@/lib/random/mulberry32";
import { statLineFor } from "@/stats/mock/generate-dataset";

/** A handful, not a season — three weeks is enough to draw a chart with more than one bar and
 *  exercise "did not play" (a player capped out of the roster slice, or the ~6% bye/inactive
 *  chance `statLineFor` already rolls) without pretending an NFL season happened locally. */
const WEEKS: readonly number[] = [1, 2, 3];

/** Bounded so `WEEKS.length * PLAYER_CAP` stays a few hundred rows regardless of how many real
 *  players the local database holds — never the whole roster. */
const PLAYER_CAP = 100;

/** A fixture-specific seed, distinct from the mock dataset's own `DATASET_SEED`: re-running this
 *  script always produces the same rows (an upsert, not an accumulation), and a shared seed would
 *  make the two generators silently correlated for no reason. */
const FIXTURE_SEED = 20260904;

async function main(): Promise<void> {
  assertLocalSeedTarget();
  const db = getDb();

  const roster = await db
    .select({ id: players.id, name: players.name, position: players.position, nflTeam: players.nflTeam, headshotUrl: players.headshotUrl, adp: players.adp })
    .from(players)
    .limit(PLAYER_CAP);

  if (roster.length === 0) {
    console.log("No players in the local database yet. Seed players first (see `src/data/seed/seed-players.ts`), then re-run this script.");
    return;
  }

  const rand = mulberry32(FIXTURE_SEED);
  const rows = WEEKS.flatMap((week) => roster.map((player) => ({ ...statLineFor(rand, player, week) })));

  await db
    .insert(statWeeks)
    .values(WEEKS.map((week) => ({ week, status: "final" as const })))
    // Only `status` is asserted here — `version`/`gamesTotal`/`gamesFinal` are real pipeline
    // bookkeeping this fixture has no business resetting on a re-run.
    .onConflictDoUpdate({ target: statWeeks.week, set: { status: "final" as const } });

  await db
    .insert(playerStatLines)
    .values(rows)
    .onConflictDoUpdate({
      target: [playerStatLines.playerId, playerStatLines.week],
      set: excludedSetFor(playerStatLines, ["playerId", "week"]),
    });

  console.log(
    `Seeded ${rows.length} stat line(s) across ${WEEKS.length} week(s) (${WEEKS.join(", ")}) for ${roster.length} player(s). ` +
      "Fabricated data, localhost only. Never point this script at anything but a disposable local database.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
