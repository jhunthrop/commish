// Refreshes the historical player universe and rebuilds the crosswalk between the two id spaces
// this product holds, then reports what it could not place and why.
// Run: npm run projections:crosswalk
//
// THE SCRIPT THAT MAKES THE ENGINE'S NUMBERS ADDRESSABLE. Everything the projection engine knows is
// keyed to a gsis id and everything a manager looks at is keyed to the stats provider's id, and
// until `player_crosswalk` was filled there was no join between them anywhere in the schema — which
// is precisely why a player's screen printed a dash where expert consensus and our own board belong.
//
// It refetches the nflverse universe first, for one reason: the `espn_id` column that bridges the
// two spaces was in the release from the first backfill and was discarded by the mapper, so every
// row already in `nfl_players` carries a null there until it is read again.
//
// THE MATCH RATE IS PRINTED, AND SO IS EVERY MISS. A crosswalk that reported only its successes
// would report 100% every time. The unmatched are listed by reason and named, because an absent
// player is otherwise indistinguishable from one nobody asked about.
import { createDb } from "@/db/client";
import { createNflverseClient } from "@/projections/nflverse/client";
import { ingestPlayerUniverse } from "@/projections/nflverse/ingest";
import {
  CROSSWALK_METHOD,
  crosswalkInputs,
  crosswalkRows,
  recordCrosswalk,
  resolveCrosswalk,
  seedTeamDefenseUniverse,
  type CrosswalkMiss,
  type UnmatchedReason,
} from "@/projections/crosswalk";

/** How many of each kind of miss to name. Enough to see the shape without a thousand-line report. */
const NAMED_MISSES = 12;

const REASON_MEANING: Readonly<Record<UnmatchedReason, string>> = {
  not_an_nfl_player: "a defence id no team code answers to, or a seed row that was never a player",
  no_team_defense_row: "a real defence whose synthetic universe row is missing; the seed step did not run",
  no_espn_id: "nobody in the universe carries this id — fringe, undrafted, or a fabricated seed row",
  ambiguous_espn_id: "two universe rows claim the id; refused rather than guessed at",
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:crosswalk\`, which loads .env.local.`);
  }
  return value;
}

function percent(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}

function groupByReason(misses: readonly CrosswalkMiss[]): ReadonlyMap<UnmatchedReason, readonly CrosswalkMiss[]> {
  const grouped = new Map<UnmatchedReason, CrosswalkMiss[]>();
  for (const miss of misses) {
    const already = grouped.get(miss.reason);
    if (already === undefined) grouped.set(miss.reason, [miss]);
    else already.push(miss);
  }
  return grouped;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));

  console.log("refreshing the historical player universe (the release carries the bridging id)...");
  await ingestPlayerUniverse(db, createNflverseClient());

  // The 32 synthetic team-defence rows, seeded BEFORE the resolve so the edges have somewhere to
  // point. See `seedTeamDefenseUniverse`'s own docblock for why a synthetic row in a table of real
  // people is the right shape here.
  console.log("seeding the 32 synthetic team-defence universe rows...");
  console.log(`  ${await seedTeamDefenseUniverse(db)} written (0 means they were already there)`);

  const { providers, universe, teamDefenses } = await crosswalkInputs(db);
  const resolution = resolveCrosswalk(providers, universe, teamDefenses);
  const written = await recordCrosswalk(db, crosswalkRows(resolution, new Date()));

  console.log(`\n${"=".repeat(88)}`);
  console.log("PLAYER CROSSWALK: the stats provider's id space against the historical universe");
  console.log(`${"=".repeat(88)}\n`);
  console.log(`universe rows carrying an ESPN id   ${universe.length}`);
  console.log(`league players                      ${providers.length}`);
  console.log(`matched                             ${resolution.matched.length}`);
  console.log(`rows written                        ${written}`);
  console.log(`match rate, all league players      ${percent(resolution.matchRate)}`);
  console.log(`match rate, people only             ${percent(resolution.matchRateOfPeople)}`);

  // The two populations this round exists for, counted separately, because "the rate went up" is
  // not evidence that either of them landed.
  const defenceEdges = resolution.matched.filter((match) => match.method === CROSSWALK_METHOD.teamDefense).length;
  console.log(`team defences placed                ${defenceEdges} of 32`);
  const kickers = new Set(providers.filter((provider) => provider.position === "K").map((provider) => provider.id));
  const kickersPlaced = resolution.matched.filter((match) => kickers.has(match.playerId)).length;
  console.log(`kickers placed                      ${kickersPlaced} of ${kickers.size}`);

  console.log("\nUNMATCHED, by reason. Recorded, never dropped.");
  for (const [reason, misses] of groupByReason(resolution.unmatched)) {
    console.log(`\n  ${reason} (${misses.length}) — ${REASON_MEANING[reason]}`);
    for (const miss of misses.slice(0, NAMED_MISSES)) {
      console.log(`    ${miss.playerId.padEnd(12)} ${miss.position.padEnd(4)} ${miss.name}`);
    }
    if (misses.length > NAMED_MISSES) console.log(`    ... and ${misses.length - NAMED_MISSES} more`);
  }

  // The audit that decides whether the id join is real. Every disagreement here is either a
  // nickname or a person on the wrong screen, and only a human can tell which.
  const disagreements = resolution.matched.filter((match) => !match.nameAgrees);
  console.log(`\nNAMES THAT DISAGREE ACROSS A MATCHED ID: ${disagreements.length} of ${resolution.matched.length}`);
  console.log("Each is either a nickname or a person on the wrong screen. Read them.");
  for (const match of disagreements) {
    console.log(`    ${match.playerId.padEnd(12)} ${match.providerName.padEnd(26)} <-> ${match.universeName}`);
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
