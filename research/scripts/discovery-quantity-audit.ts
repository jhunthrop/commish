// FIRING-COUNT AUDIT for the discovery vocabulary: how often each quantity in `QUANTITY_DEFS`
// actually RESOLVES to a number, per predictor season, over the same full window
// `scripts/discover-laws.ts` measures on and through the identical gated reads.
// Run: npm run laws:discover:audit
// (dotenv -e .env.local -- tsx scripts/discovery-quantity-audit.ts)
//
// A quantity nobody can read measures nothing (the vegas-laws spec's own words). A stamp or a week
// convention that silently returns no rows does not fail anything: every candidate over that
// quantity simply becomes untestable, the run still writes a discovered.json, and the only visible
// trace is a count in a summary line nobody diffs. This script is the check that would catch it —
// run it BEFORE a discovery regeneration, not after.
//
// Rows are counted per player-season FACTS ROW (the `current` half), position-scoped exactly as the
// discovery pipeline scopes them, so the denominators here are the same denominators the candidate
// conditions see.
import { createDb } from "@research/db/client";
import type { ReadonlyDb } from "@research/db/client";
import { allPositions } from "@research/projections/backtest";
import { PPR_SCORING } from "@research/domain/scoring";
import { MEASURE_SEASONS } from "@research/projections/laws/config";
import { discoveryFactsForSeason } from "@research/projections/laws/discovery-facts";
import { QUANTITY_DEFS } from "@research/projections/laws/discovery/templates";
import { preseasonMomentFor } from "@research/projections/preseason/source";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run laws:discover:audit\`, which loads .env.local.`);
  }
  return value;
}

interface Tally {
  resolved: number;
  rows: number;
}

function pct(resolved: number, rows: number): string {
  return rows === 0 ? "n/a" : `${((resolved / rows) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const client = createDb(requireEnv("DATABASE_URL"));
  const db: ReadonlyDb = client;
  const positions = await allPositions(db);

  const overall = new Map<string, Tally>(QUANTITY_DEFS.map((def) => [def.id, { resolved: 0, rows: 0 }] as const));
  const perSeason: { season: number; rows: number; byQuantity: Map<string, Tally> }[] = [];

  for (let season = MEASURE_SEASONS.from; season <= MEASURE_SEASONS.to - 1; season += 1) {
    const incomingAsOf = await preseasonMomentFor(db, season + 1);
    const facts = await discoveryFactsForSeason(db, season, positions, PPR_SCORING, true, incomingAsOf);
    const byQuantity = new Map<string, Tally>(QUANTITY_DEFS.map((def) => [def.id, { resolved: 0, rows: 0 }] as const));
    for (const entry of facts.values()) {
      for (const def of QUANTITY_DEFS) {
        // Position scope, exactly as a candidate over this quantity is scoped: a quantity that means
        // nothing for this position is not a null to explain, it is a row the generator never asks.
        if (!def.positions.includes(entry.position)) continue;
        const tally = byQuantity.get(def.id)!;
        const total = overall.get(def.id)!;
        tally.rows += 1;
        total.rows += 1;
        if (def.get(entry.current) !== null) {
          tally.resolved += 1;
          total.resolved += 1;
        }
      }
    }
    perSeason.push({ season, rows: facts.size, byQuantity });
    console.log(`${season}: ${facts.size} player-season facts rows, incoming gate ${incomingAsOf.toISOString()}`);
  }

  console.log("\nRESOLVED RATE BY QUANTITY (share of in-scope facts rows where the quantity is not null)\n");
  for (const def of QUANTITY_DEFS) {
    const total = overall.get(def.id)!;
    const bySeason = perSeason
      .map(({ season, byQuantity }) => {
        const tally = byQuantity.get(def.id)!;
        return `${season}=${pct(tally.resolved, tally.rows)}`;
      })
      .join("  ");
    console.log(`  ${def.id.padEnd(40)} ${pct(total.resolved, total.rows).padStart(7)}  (${total.resolved}/${total.rows})`);
    console.log(`    ${bySeason}`);
  }

  await client.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
