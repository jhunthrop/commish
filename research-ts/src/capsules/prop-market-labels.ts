import type { PropMarket } from "@research-ts/projections/odds/props-store";

/**
 * THE ONE ENGLISH NAME FOR EACH PROPS MARKET — split into its own tiny, dependency-free module
 * (dossier plan, Task 4) so a CLIENT component (`league-room/dossier/books-module.tsx`) can
 * value-import it without pulling in `capsules/facts.ts`'s `node:crypto` (`createHash`, used for
 * `factsHash`) through `render.ts`'s own import of `PlayerFacts`. This file imports nothing but a
 * type, so it costs the browser bundle nothing.
 *
 * `render.ts` re-exports from here rather than keeping its own copy — one label map, never two
 * that could quietly drift apart the moment a market is added to `PROP_MARKETS`
 * (`projections/odds/props-store.ts`) and only one of the two copies is updated.
 *
 * Never echoed to the model (or a manager) as `player_reception_yds` (`facts.ts`'s own
 * two-audience rule): a raw market key is exactly the kind of internal vocabulary the p10/p90
 * incident already taught this engine to keep out of a prompt.
 */
export const PROP_MARKET_LABELS: Readonly<Record<PropMarket, string>> = {
  player_pass_yds: "pass yards",
  player_reception_yds: "receiving yards",
  player_receptions: "receptions",
  player_rush_yds: "rush yards",
  player_pass_tds: "pass touchdowns",
};
