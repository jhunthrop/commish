// THE ORACLE'S COMMITTED FITS, AS JSON: every fitted constant the TypeScript board reads from a
// committed file rather than from `model_artifacts`, printed under the artifact name the Python
// lane stores it as. `python -m research.model.artifacts seed` reads this output and publishes each
// payload as version 1 of its artifact, so the Python board reads its fits from the store (no file-
// sourced data at runtime) and the values are the oracle's own, number for number: a JavaScript
// double printed by `JSON.stringify` parses back to the same double in Python.
//
//   npx tsx research/parity/ts/artifacts.ts > artifacts.json
import discovered from "@research-ts/projections/laws/discovered.json";
import measured from "@research-ts/projections/laws/measured.json";
import { DISCOVERY_QUANTILES } from "@research-ts/projections/laws/discovery/quantiles";
import { FITTED_BLEND_CONSTANTS } from "@research-ts/projections/market/blend-fitted";
import { FITTED_MARKET_CURVE } from "@research-ts/projections/market/curve-fitted";
import { FITTED_MARKET_CURVE_HALF } from "@research-ts/projections/market/curve-fitted-half";
import { FITTED_MARKET_CURVE_STD } from "@research-ts/projections/market/curve-fitted-std";
import { FIT_SEASONS, HELD_OUT_SEASONS } from "@research-ts/projections/model/fitted";
import { FITTED_MODEL } from "@research-ts/projections/model/source";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@research-ts/projections/preseason/fitted";
import { FITTED_DEFENSE_PRIORS, FITTED_KICKER_PRIORS } from "@research-ts/projections/preseason/kdef-fitted";
import { FITTED_ROOKIE_CURVE } from "@research-ts/projections/preseason/rookie-curve-fitted";
import {
  FITTED_HISTORICAL_ROOKIE_GAMES_RATE,
  FITTED_ROOKIE_CURVE_EVIDENCE,
} from "@research-ts/projections/preseason/rookie-historical-games-fitted";

interface Exported {
  readonly payload: unknown;
  /** The committed file the payload is read from: its last commit is the artifact's fit stamp. */
  readonly file: string;
}

const root = "research-ts/src/projections";

const ARTIFACTS: Readonly<Record<string, Exported>> = {
  "model/weekly-priors": {
    payload: { ...FITTED_MODEL, fitSeasons: FIT_SEASONS, heldOutSeasons: HELD_OUT_SEASONS },
    file: `${root}/model/fitted.ts`,
  },
  "preseason/priors": {
    payload: {
      availability: FITTED_AVAILABILITY_PRIORS,
      rookies: FITTED_ROOKIE_PRIORS,
      depth: FITTED_DEPTH_PRIORS,
      career: FITTED_CAREER_PRIORS,
    },
    file: `${root}/preseason/fitted.ts`,
  },
  "preseason/rookie-curve": { payload: FITTED_ROOKIE_CURVE, file: `${root}/preseason/rookie-curve-fitted.ts` },
  "preseason/rookie-history": {
    payload: { gamesRate: FITTED_HISTORICAL_ROOKIE_GAMES_RATE, curveEvidence: FITTED_ROOKIE_CURVE_EVIDENCE },
    file: `${root}/preseason/rookie-historical-games-fitted.ts`,
  },
  "preseason/kdef-priors": {
    payload: { kicker: FITTED_KICKER_PRIORS, defense: FITTED_DEFENSE_PRIORS },
    file: `${root}/preseason/kdef-fitted.ts`,
  },
  "market/blend-constants": { payload: FITTED_BLEND_CONSTANTS, file: `${root}/market/blend-fitted.ts` },
  "market/curve-ppr": { payload: FITTED_MARKET_CURVE, file: `${root}/market/curve-fitted.ts` },
  "market/curve-half": { payload: FITTED_MARKET_CURVE_HALF, file: `${root}/market/curve-fitted-half.ts` },
  "market/curve-std": { payload: FITTED_MARKET_CURVE_STD, file: `${root}/market/curve-fitted-std.ts` },
  "laws/measured": { payload: measured, file: `${root}/laws/measured.json` },
  "laws/discovered": { payload: discovered, file: `${root}/laws/discovered.json` },
  "laws/discovery-quantiles": { payload: DISCOVERY_QUANTILES, file: `${root}/laws/discovery/quantiles.ts` },
};

process.stdout.write(`${JSON.stringify(ARTIFACTS)}\n`);
