/**
 * THE LAW REGISTRY — merges each `LawSpec`'s static content (id, position, claim, expected sign,
 * caliper, model path) with the measured evidence `scripts/measure-laws.ts` wrote to
 * `measured.json`, and refuses to hand out a `Law` the evidence does not actually support.
 *
 * `registryFrom(specs, measuredJson)` is the pure, DB-free core — every test in
 * `registry.test.ts` drives THIS function with hand-built fixtures, never the real file.
 * `registry()` is the thin wrapper that reads the committed `measured.json` off disk and calls it;
 * nothing in `registry()` is worth a unit test beyond "the file parses", because all the actual
 * logic lives in the pure function.
 *
 * THREE THINGS THROW, ON PURPOSE, RATHER THAN DEGRADE QUIETLY:
 *   1. A `LawSpec` with no entry in `measuredJson` — a law was added to `LAW_SPECS` and nobody
 *      re-ran `npm run laws:measure`.
 *   2. A `measuredJson` entry with no matching `LawSpec` — a law was removed/renamed from
 *      `LAW_SPECS` and the stale measurement was never cleaned out of the committed file.
 *   3. A stored `verdict` that disagrees with what `verdictForFullWindow` computes fresh from that
 *      same entry's `effect`/`ci`/`heldOutEffect` — the file was hand-edited, or the verdict rule
 *      changed since the file was last regenerated, either way the committed verdict can no longer
 *      be trusted at face value.
 * Any of these is silent drift between the code that claims a law's evidence and the evidence
 * itself, and the whole point of measuring laws instead of asserting them is that drift cannot
 * pass unnoticed (see `populations.ts`'s and `harness.ts`'s own docblocks for the rest of that
 * discipline).
 *
 * OUT-OF-SAMPLE DIRECTION REPLICATION (controller ruling, supersedes an earlier held-out-only
 * measurement). `effect`/`ci`/`sample` are measured over every matched pair in the FULL
 * `MEASURE_SEASONS` window — `harness.ts`'s own `matchedPairsStratified`/`measureEffect`, unchanged.
 * A law is no longer graded on the full window's CI alone, because that window now includes the
 * very seasons `projection-fit.ts` fits the model on, and a law confirmed only there would be
 * confirmed on the model's own training data. `verdictForFullWindow` adds one more requirement on
 * top of `harness.ts`'s `verdictFor`: `confirmed` also needs the HELD-OUT SUBSET of those same
 * matched pairs (the ones whose predictor season+1 lands in `HELD_OUT_SEASONS`) to point the same
 * direction. A law whose full-window evidence is strong but whose held-out slice disagrees, or
 * whose held-out slice matched nothing at all, is capped at `weak` — real enough to keep measuring,
 * not demonstrated on seasons the fit never touched. See `scripts/measure-laws.ts`'s header for how
 * the held-out subset is derived (it is a partition of the SAME matched pairs, not a separate match).
 */

import { readFileSync } from "node:fs";
import { LAW_SPECS, type LawSpec } from "./populations";
import { verdictFor } from "./harness";
import type { Law, LawMeasurement, LawVerdict, PlayerSeasonPoint } from "./types";

/** One `measured.json` entry: the full-window measurement, the held-out subset's effect (`null` if
 *  the held-out subset matched zero pairs — see `verdictForFullWindow`), and the verdict they imply. */
export type MeasuredEntry = LawMeasurement & { readonly heldOutEffect: number | null; readonly verdict: LawVerdict };

/** `measured.json`'s whole shape: every law id the file has evidence for. */
export type MeasuredJson = { readonly [lawId: string]: MeasuredEntry };

/**
 * THE ONE PLACE THE STRATIFICATION RULE LIVES — every law matches within `season` (a 2011 RB and
 * a 2024 WR sharing a `matchKey` caliper share nothing else that matters, see `harness.ts`'s own
 * docblock on `matchedPairsStratified`), and a law whose population spans more than one position
 * additionally stratifies by `position`, because a WR's and a TE's points/game distributions do
 * not overlap enough for one caliper to mean the same thing for both.
 *
 * `LawSpec.position === "all"` is exactly that "spans more than one position" case in this
 * registry today (`play_caller_fingerprint` covers WR+TE, `td_regression` covers QB/RB/WR/TE) —
 * every other law's `position` names the single position its population is drawn from, and needs
 * no extra key. `scripts/measure-laws.ts` calls this for every stratified match it runs, so the
 * rule is written exactly once.
 */
export function stratumKeyFor(spec: Pick<LawSpec, "position">, point: Pick<PlayerSeasonPoint, "season" | "position">): string {
  return spec.position === "all" ? `${point.season}|${point.position}` : `${point.season}`;
}

/**
 * The revised grading rule: `verdictFor`'s full-window CI/sign call, refined by ONE extra step. If
 * the full window alone would call it `confirmed`, that is downgraded to `weak` unless the held-out
 * subset's own effect points the same direction (`heldOutEffect === null` — zero held-out pairs
 * matched — never confirms, exactly like a sign disagreement). `weak` and `debunked` from the
 * full-window rule are untouched: this can only ever pull a `confirmed` down to `weak`, never
 * change a `weak` or a `debunked` into anything else, so every full-window CI/sign case
 * `verdictFor` already handles correctly keeps behaving exactly as it did.
 */
export function verdictForFullWindow(measurement: LawMeasurement, expectedSign: -1 | 1, heldOutEffect: number | null): LawVerdict {
  const fullWindowVerdict = verdictFor(measurement, expectedSign);
  if (fullWindowVerdict !== "confirmed") return fullWindowVerdict;
  const heldOutSignMatches = heldOutEffect !== null && Math.sign(heldOutEffect) === expectedSign;
  return heldOutSignMatches ? "confirmed" : "weak";
}

/** The pure, testable core: merges `specs` with `measuredJson`, throwing on any drift between them. */
export function registryFrom(specs: readonly LawSpec[], measuredJson: MeasuredJson): readonly Law[] {
  const specIds = new Set(specs.map((spec) => spec.id));
  for (const lawId of Object.keys(measuredJson)) {
    if (!specIds.has(lawId)) {
      throw new Error(`registryFrom: measured.json has an entry for "${lawId}" with no matching LawSpec — an orphaned measurement.`);
    }
  }

  return specs.map((spec) => {
    const entry = measuredJson[spec.id];
    if (entry === undefined) {
      throw new Error(`registryFrom: LawSpec "${spec.id}" has no entry in measured.json — run \`npm run laws:measure\`.`);
    }

    const measured: LawMeasurement = { effect: entry.effect, ci: entry.ci, sample: entry.sample, seasons: entry.seasons };
    const expectedVerdict = verdictForFullWindow(measured, spec.expectedSign, entry.heldOutEffect);
    if (entry.verdict !== expectedVerdict) {
      throw new Error(
        `registryFrom: measured.json's verdict for "${spec.id}" is "${entry.verdict}" but verdictForFullWindow computes ` +
          `"${expectedVerdict}" from its own effect/ci/heldOutEffect — the file is stale or was hand-edited. Re-run \`npm run laws:measure\`.`,
      );
    }

    return {
      id: spec.id,
      position: spec.position,
      claim: spec.claim,
      measured,
      verdict: entry.verdict,
      modelPath: spec.modelPath,
    };
  });
}

/**
 * Where `measured.json` lives, relative to the process's working directory — the repo root, for
 * every real caller (`npm run` scripts and `next dev`/`next build` alike) and for `vitest`, which
 * both run from there. The same constant `scripts/measure-laws.ts` writes through, so the reader
 * and the writer can never name two different files.
 */
export const MEASURED_JSON_PATH = "src/projections/laws/measured.json";

/** The thin file-reading wrapper every real caller uses: the committed `LAW_SPECS` against the
 *  committed `measured.json`, read fresh off disk on every call. */
export function registry(): readonly Law[] {
  const raw = readFileSync(MEASURED_JSON_PATH, "utf-8");
  return registryFrom(LAW_SPECS, JSON.parse(raw) as MeasuredJson);
}
