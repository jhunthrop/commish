/**
 * THE LAW REGISTRY — merges each `LawSpec`'s static content (id, position, claim, expected sign,
 * caliper, model path) with the measured evidence `scripts/measure-laws.ts` wrote to
 * `measured.json`, and refuses to hand out a `Law` the evidence does not actually support.
 *
 * `registryFrom(specs, measuredJson)` is the pure, DB-free core — every drift-guard test in
 * `registry.test.ts` drives THIS function with hand-built fixtures, never the real file.
 * `parseMeasuredJson(raw)` is the pure shape-validator `registry()` runs the file's text through
 * before `registryFrom` ever sees it, and is independently testable with a raw string, no file
 * needed. `registry()` itself is the thin wrapper that reads the committed `measured.json` off
 * disk and chains the two — nothing in `registry()` beyond that chaining is worth its own test.
 *
 * FOUR THINGS THROW, ON PURPOSE, RATHER THAN DEGRADE QUIETLY:
 *   1. `measured.json` parses but does not match `MeasuredJson`'s shape (`parseMeasuredJson`) — a
 *      non-finite `effect`, a `ci` that isn't a 2-tuple, a `verdict` outside the union, and so on.
 *      The file is generated, never hand-authored, but a hand edit that slips past `JSON.parse`
 *      deserves a named field and a clear message here, not a `TypeError` several calls deep.
 *   2. A `LawSpec` with no entry in `measuredJson` — a law was added to `LAW_SPECS` and nobody
 *      re-ran `npm run laws:measure`.
 *   3. A `measuredJson` entry with no matching `LawSpec` — a law was removed/renamed from
 *      `LAW_SPECS` and the stale measurement was never cleaned out of the committed file.
 *   4. A stored `verdict` that disagrees with what `verdictForFullWindow` computes fresh from that
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

const VALID_VERDICTS: ReadonlySet<string> = new Set<LawVerdict>(["confirmed", "weak", "debunked"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Explicit shape validation for `JSON.parse`'s untyped output, called before `measured.json`'s
 * content is trusted as `MeasuredJson` anywhere. `measured.json` is generated, never hand-authored
 * — but this module's own docblock has worried about a hand edit surviving since Task 6 shipped,
 * and a hand edit that slips past `JSON.parse` (a `ci` bound typo'd into a string, a `sample` that
 * became `NaN`, a `verdict` outside the union) would otherwise surface as a `TypeError` several
 * calls deep inside `verdictForFullWindow` or a downstream consumer, with no indication which field
 * of which law was wrong. This throws `malformed measured.json: <field>` at the one boundary where
 * untyped JSON becomes a typed `MeasuredJson`, naming the exact law and field.
 */
export function parseMeasuredJson(raw: string): MeasuredJson {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("malformed measured.json: root is not an object");
  }

  for (const [lawId, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`malformed measured.json: "${lawId}" is not an object`);
    }
    const record = entry as Record<string, unknown>;

    if (!isFiniteNumber(record.effect)) {
      throw new Error(`malformed measured.json: "${lawId}".effect is not a finite number`);
    }
    if (!Array.isArray(record.ci) || record.ci.length !== 2 || !isFiniteNumber(record.ci[0]) || !isFiniteNumber(record.ci[1])) {
      throw new Error(`malformed measured.json: "${lawId}".ci is not a 2-tuple of finite numbers`);
    }
    if (!isFiniteNumber(record.sample)) {
      throw new Error(`malformed measured.json: "${lawId}".sample is not a finite number`);
    }
    if (typeof record.seasons !== "string") {
      throw new Error(`malformed measured.json: "${lawId}".seasons is not a string`);
    }
    if (record.heldOutEffect !== null && !isFiniteNumber(record.heldOutEffect)) {
      throw new Error(`malformed measured.json: "${lawId}".heldOutEffect is not a finite number or null`);
    }
    if (typeof record.verdict !== "string" || !VALID_VERDICTS.has(record.verdict)) {
      throw new Error(`malformed measured.json: "${lawId}".verdict is not one of "confirmed" | "weak" | "debunked"`);
    }
  }

  return parsed as MeasuredJson;
}

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
 *  committed `measured.json` — shape-validated (`parseMeasuredJson`) and drift-checked
 *  (`registryFrom`) — read fresh off disk on every call. */
export function registry(): readonly Law[] {
  const raw = readFileSync(MEASURED_JSON_PATH, "utf-8");
  return registryFrom(LAW_SPECS, parseMeasuredJson(raw));
}
