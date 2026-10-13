// THE ORACLE'S CAPSULE FACTS, CALLED AS THEY RUN: the TypeScript side of the facts parity cases.
//
//   DATABASE_URL=<dev copy> npx tsx research/parity/ts/capsules.ts board <asOfIso>
//   DATABASE_URL=<dev copy> npx tsx research/parity/ts/capsules.ts one <asOfIso> <playerId>...
//
// `board` is the sweep's own pass (`collectBoardFacts`), one JSON line per player's facts in the
// pass's order and a last line with the pass's counts; `one` is `collectPlayerFacts` (the narrow
// single-player read), one line per id asked (`null` when the board does not rank him, its error
// when the read throws). Both only
// read: the oracle's connection is opened read only.
import { createDb } from "@research-ts/db/client";
import { collectBoardFacts } from "@research-ts/capsules/collect";
import { collectPlayerFacts } from "@research-ts/capsules/collect-one";

const emit = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

async function main(): Promise<void> {
  const [command, asOfIso, ...ids] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (command === undefined || asOfIso === undefined || url === undefined) {
    throw new Error("usage: DATABASE_URL=... tsx capsules.ts board <asOfIso> | one <asOfIso> <playerId>...");
  }
  const db = createDb(url, { max: 4 });
  const asOf = new Date(asOfIso);
  try {
    await db.execute("set session characteristics as transaction read only");
    if (command === "board") {
      const pass = await collectBoardFacts(db, asOf);
      for (const facts of pass.facts) emit({ facts });
      emit({ pass: { priorSeason: pass.priorSeason, priorSeasonPlayerCount: pass.priorSeasonPlayerCount, peerCountByPosition: Object.fromEntries(pass.peerCountByPosition) } });
    } else if (command === "one") {
      // Each id on its own: a read that throws is recorded as its error, and the rest still run.
      for (const id of ids) {
        try {
          emit({ id, facts: await collectPlayerFacts(db, id, asOf) });
        } catch (error) {
          emit({ id, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } else throw new Error(`no command ${command}`);
  } finally {
    await db.$client.end();
  }
}

await main();
