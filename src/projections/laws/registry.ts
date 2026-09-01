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
 *      same entry's `effect`/`ci`/`foldEffects` — the file was hand-edited, or the verdict rule
 *      changed since the file was last regenerated, either way the committed verdict can no longer
 *      be trusted at face value.
 * Any of these is silent drift between the code that claims a law's evidence and the evidence
 * itself, and the whole point of measuring laws instead of asserting them is that drift cannot
 * pass unnoticed (see `populations.ts`'s and `harness.ts`'s own docblocks for the rest of that
 * discipline).
 *
 * OUT-OF-SAMPLE DIRECTION REPLICATION, ROLLING FOLDS (this wave, 2026-08-31 — supersedes an
 * earlier single held-out-pair measurement). `effect`/`ci`/`sample` are measured over every
 * matched pair in the FULL `MEASURE_SEASONS` window — `harness.ts`'s own
 * `matchedPairsStratified`/`measureEffect`, unchanged. A law is no longer graded on the full
 * window's CI alone, because that window now includes the very seasons `projection-fit.ts` fits
 * the model on, and a law confirmed only there would be confirmed on the model's own training
 * data. `verdictForFullWindow` adds one more requirement on top of `harness.ts`'s `verdictFor`:
 * `confirmed` also needs EVERY REPLICATION FOLD (`config.ts`'s `REPLICATION_FOLDS`, one predictor
 * season each) that matched at least one pair to point the same direction as the full-window
 * effect. A law whose full-window evidence is strong but whose folds disagree with each other, or
 * whose folds all matched zero pairs, is capped at `weak` — real enough to keep measuring, not
 * demonstrated across seasons checked separately. See `scripts/measure-laws.ts`'s header for how
 * each fold's subset is derived (it is a partition of the SAME matched pairs by predictor season,
 * not a separate match).
 */

import { readFileSync } from "node:fs";
import { LAW_SPECS, type LawSpec } from "./populations";
import { verdictFor } from "./harness";
import type { CandidateTemplate } from "./discovery/generate";
import type { Law, LawMeasurement, LawVerdict, PlayerSeasonPoint } from "./types";

/** One replication fold's own effect (`config.ts`'s `REPLICATION_FOLDS`, one entry per predictor
 *  season) — `effect: null` when that fold's predictor season matched zero pairs. See
 *  `verdictForFullWindow`'s docblock for how a list of these combines into a verdict. */
export interface FoldEffect {
  readonly season: number;
  readonly effect: number | null;
}

/** One `measured.json` entry: the full-window measurement, one effect per replication fold, and
 *  the verdict they imply. */
export type MeasuredEntry = LawMeasurement & { readonly foldEffects: readonly FoldEffect[]; readonly verdict: LawVerdict };

/** `measured.json`'s whole shape: every law id the file has evidence for. */
export type MeasuredJson = { readonly [lawId: string]: MeasuredEntry };

const VALID_VERDICTS: ReadonlySet<string> = new Set<LawVerdict>(["confirmed", "weak", "debunked"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The `LawMeasurement & { foldEffects; verdict }` half of a `measured.json`/`discovered.json` entry
 * shape-checked ONE way, shared by `parseMeasuredJson` and `parseDiscoveredJson` (Task 7) — a
 * discovered entry carries every field a measured one does, plus its own origin/position/template/
 * claim/expectedSign fields `parseDiscoveredJson` checks afterward. `prefix` is each caller's own
 * `"malformed <file>.json:"` opener, so the two files' error messages stay distinguishable while the
 * field-by-field checks themselves are written exactly once.
 */
function assertMeasuredEntryShape(prefix: string, lawId: string, record: Record<string, unknown>): void {
  if (!isFiniteNumber(record.effect)) {
    throw new Error(`${prefix} "${lawId}".effect is not a finite number`);
  }
  if (!Array.isArray(record.ci) || record.ci.length !== 2 || !isFiniteNumber(record.ci[0]) || !isFiniteNumber(record.ci[1])) {
    throw new Error(`${prefix} "${lawId}".ci is not a 2-tuple of finite numbers`);
  }
  if (!isFiniteNumber(record.sample)) {
    throw new Error(`${prefix} "${lawId}".sample is not a finite number`);
  }
  if (typeof record.seasons !== "string") {
    throw new Error(`${prefix} "${lawId}".seasons is not a string`);
  }
  if (!Array.isArray(record.foldEffects)) {
    throw new Error(`${prefix} "${lawId}".foldEffects is not an array`);
  }
  for (const fold of record.foldEffects as readonly unknown[]) {
    if (typeof fold !== "object" || fold === null || Array.isArray(fold)) {
      throw new Error(`${prefix} "${lawId}".foldEffects has a non-object entry`);
    }
    const foldRecord = fold as Record<string, unknown>;
    if (!isFiniteNumber(foldRecord.season)) {
      throw new Error(`${prefix} "${lawId}".foldEffects has an entry with a non-finite season`);
    }
    if (foldRecord.effect !== null && !isFiniteNumber(foldRecord.effect)) {
      throw new Error(`${prefix} "${lawId}".foldEffects has an entry with a non-finite effect or null`);
    }
  }
  if (typeof record.verdict !== "string" || !VALID_VERDICTS.has(record.verdict)) {
    throw new Error(`${prefix} "${lawId}".verdict is not one of "confirmed" | "weak" | "debunked"`);
  }
}

const MEASURED_JSON_PREFIX = "malformed measured.json:";

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
    assertMeasuredEntryShape(MEASURED_JSON_PREFIX, lawId, entry as Record<string, unknown>);
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
 * the full window alone would call it `confirmed`, that is downgraded to `weak` unless EVERY fold
 * that matched at least one pair points the same direction as `expectedSign`. A fold whose own
 * `effect` is `null` (zero pairs matched that predictor season) is skipped rather than counted
 * against the law — it contributed no evidence either way — but a law with ZERO folds carrying
 * any pairs at all is capped at `weak` too, the same as a lone disagreeing fold: "nothing checked
 * it" is not "it checked out." `weak` and `debunked` from the full-window rule are untouched: this
 * can only ever pull a `confirmed` down to `weak`, never change a `weak` or a `debunked` into
 * anything else, so every full-window CI/sign case `verdictFor` already handles correctly keeps
 * behaving exactly as it did.
 */
export function verdictForFullWindow(
  measurement: LawMeasurement,
  expectedSign: -1 | 1,
  foldEffects: readonly FoldEffect[],
): LawVerdict {
  const fullWindowVerdict = verdictFor(measurement, expectedSign);
  if (fullWindowVerdict !== "confirmed") return fullWindowVerdict;
  const foldsWithPairs = foldEffects.filter((fold) => fold.effect !== null);
  if (foldsWithPairs.length === 0) return "weak";
  const everyFoldAgrees = foldsWithPairs.every((fold) => Math.sign(fold.effect as number) === expectedSign);
  return everyFoldAgrees ? "confirmed" : "weak";
}

/**
 * THE DISCOVERY TRIAL (Task 7, 2026-08-31) — `discovery/generate.ts`'s 1,737 mechanically generated
 * candidates, false-discovery-controlled and replicated into `discovered.json`. See
 * `discovery/measure.ts`'s own docblock for the full pipeline (train-window screening,
 * Benjamini-Hochberg at q=0.10, full-window replication); the pieces below are the merge/drift-guard
 * half, living here rather than there for the identical reason `verdictForFullWindow` and
 * `stratumKeyFor` do: `registry()` is the one place tribal and discovered evidence both have to
 * agree with what they claim, and every drift-guard test drives these functions with hand-built
 * fixtures, never the real files.
 */

/** The minimum full-window matched-pair sample a BH-surviving discovered candidate needs, on top of
 *  `verdictForFullWindow`'s own CI/sign/fold-agreement bar, before its verdict can read `confirmed`.
 *  BH controls the false-discovery rate at the SCREENING stage across the whole 1,737-candidate
 *  family; a survivor's own full-window sample can still be thin, and this is the pipeline's
 *  additional confirmatory bar against exactly that. 40 is in the same range the six tribal laws'
 *  own `measured.json` samples sit in, not a novel number invented for this rule. */
export const MIN_REPLICATION_PAIRS = 40;

/**
 * A DISCOVERED candidate's verdict: `verdictForFullWindow`'s own CI/sign/fold-agreement rule, plus
 * ONE more gate that function does not apply on its own — `confirmed` also needs at least
 * `MIN_REPLICATION_PAIRS` full-window matched pairs. Exactly like `verdictForFullWindow`'s own
 * relationship to `verdictFor`, this can only ever pull a `confirmed` down to `weak`; a `weak` or
 * `debunked` verdict from `verdictForFullWindow` passes through unchanged.
 */
export function verdictForDiscoveredLaw(
  measurement: LawMeasurement,
  expectedSign: -1 | 1,
  foldEffects: readonly FoldEffect[],
): LawVerdict {
  const base = verdictForFullWindow(measurement, expectedSign, foldEffects);
  if (base !== "confirmed") return base;
  return measurement.sample >= MIN_REPLICATION_PAIRS ? "confirmed" : "weak";
}

/** One `discovered.json` law entry: everything a `MeasuredEntry` carries, plus what makes it a
 *  DISCOVERED law rather than a tribal one — its origin tag, which position/template it was
 *  generated for, its rendered (sign-committed) claim, and the sign its own train-window effect
 *  determined rather than a person asserting one up front. */
export type DiscoveredEntry = MeasuredEntry & {
  readonly origin: "discovered";
  readonly position: Law["position"];
  readonly template: CandidateTemplate;
  readonly claim: string;
  readonly expectedSign: -1 | 1;
};

/** The discovery pipeline's own accounting, at the top level of `discovered.json` — see
 *  `discovery/measure.ts`'s `runDiscoveryPipeline` for how each count is derived. `tested` is the
 *  whole candidate family `discovery/generate.ts` produced (1,737 today); `untestable` is the subset
 *  whose train-window population matched zero pairs (expected for narrow AND conditions, never an
 *  error); `bhSurvivors` is how many of the remaining TESTABLE candidates survived
 *  Benjamini-Hochberg at q=0.10; `replicated` is how many of those survivors' full-window
 *  measurement came back `confirmed` under `verdictForDiscoveredLaw`. */
export interface PipelineCounts {
  readonly tested: number;
  readonly untestable: number;
  readonly bhSurvivors: number;
  readonly replicated: number;
}

/** `discovered.json`'s whole shape: the pipeline's own accounting, plus one `DiscoveredEntry` per
 *  BH survivor (confirmed and non-confirmed alike — a survivor that failed replication stays in the
 *  file with its own non-confirmed verdict; see `discovery/measure.ts`'s docblock for why that is
 *  the honest record rather than a row to drop). */
export interface DiscoveredJson {
  readonly counts: PipelineCounts;
  readonly laws: { readonly [lawId: string]: DiscoveredEntry };
}

const DISCOVERED_JSON_PREFIX = "malformed discovered.json:";
const VALID_POSITIONS: ReadonlySet<string> = new Set(["QB", "RB", "WR", "TE", "all"]);
const VALID_TEMPLATES: ReadonlySet<string> = new Set(["threshold", "delta", "and"]);

/**
 * Explicit shape validation for `discovered.json`, mirroring `parseMeasuredJson`'s own discipline
 * (see that function's docblock) plus the discovered-only fields: `assertMeasuredEntryShape` covers
 * the `MeasuredEntry` half every law entry carries; the checks below cover `counts` and the
 * origin/position/template/claim/expectedSign half that makes an entry a `DiscoveredEntry`.
 */
export function parseDiscoveredJson(raw: string): DiscoveredJson {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("malformed discovered.json: root is not an object");
  }
  const root = parsed as Record<string, unknown>;

  const counts = root.counts;
  if (typeof counts !== "object" || counts === null || Array.isArray(counts)) {
    throw new Error("malformed discovered.json: counts is not an object");
  }
  const countsRecord = counts as Record<string, unknown>;
  for (const field of ["tested", "untestable", "bhSurvivors", "replicated"] as const) {
    if (!isFiniteNumber(countsRecord[field])) {
      throw new Error(`malformed discovered.json: counts.${field} is not a finite number`);
    }
  }

  const laws = root.laws;
  if (typeof laws !== "object" || laws === null || Array.isArray(laws)) {
    throw new Error("malformed discovered.json: laws is not an object");
  }

  for (const [lawId, entry] of Object.entries(laws as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`malformed discovered.json: laws."${lawId}" is not an object`);
    }
    const record = entry as Record<string, unknown>;
    assertMeasuredEntryShape(DISCOVERED_JSON_PREFIX, lawId, record);

    if (record.origin !== "discovered") {
      throw new Error(`malformed discovered.json: "${lawId}".origin is not "discovered"`);
    }
    if (typeof record.position !== "string" || !VALID_POSITIONS.has(record.position)) {
      throw new Error(`malformed discovered.json: "${lawId}".position is not a valid Law position`);
    }
    if (typeof record.template !== "string" || !VALID_TEMPLATES.has(record.template)) {
      throw new Error(`malformed discovered.json: "${lawId}".template is not one of "threshold" | "delta" | "and"`);
    }
    if (typeof record.claim !== "string") {
      throw new Error(`malformed discovered.json: "${lawId}".claim is not a string`);
    }
    if (record.expectedSign !== -1 && record.expectedSign !== 1) {
      throw new Error(`malformed discovered.json: "${lawId}".expectedSign is not -1 or 1`);
    }
  }

  return parsed as DiscoveredJson;
}

/**
 * The pure, testable core for the DISCOVERED half of the registry: one `Law` per `discovered.json`
 * entry, `origin: "discovered"` throughout, `modelPath: null` throughout (a discovered law gets
 * wired to a fitted feature the same way a confirmed tribal law would, in a model round of its own —
 * see `LawSpec.modelPath`'s own docblock; nothing here builds or re-fits a model). Drift-checked the
 * same way `registryFrom` checks tribal entries: the stored `verdict` must equal what
 * `verdictForDiscoveredLaw` computes fresh from that same entry's own effect/ci/sample/foldEffects.
 */
export function discoveredLawsFrom(discoveredJson: DiscoveredJson): readonly Law[] {
  return Object.entries(discoveredJson.laws).map(([id, entry]) => {
    const measured: LawMeasurement = { effect: entry.effect, ci: entry.ci, sample: entry.sample, seasons: entry.seasons };
    const expectedVerdict = verdictForDiscoveredLaw(measured, entry.expectedSign, entry.foldEffects);
    if (entry.verdict !== expectedVerdict) {
      throw new Error(
        `discoveredLawsFrom: discovered.json's verdict for "${id}" is "${entry.verdict}" but verdictForDiscoveredLaw computes ` +
          `"${expectedVerdict}" from its own effect/ci/sample/foldEffects — the file is stale or was hand-edited. Re-run \`npm run laws:discover\`.`,
      );
    }

    return {
      id,
      position: entry.position,
      claim: entry.claim,
      measured,
      verdict: entry.verdict,
      modelPath: null,
      hasFoldEvidence: entry.foldEffects.some((fold) => fold.effect !== null),
      origin: "discovered" as const,
    };
  });
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
    const expectedVerdict = verdictForFullWindow(measured, spec.expectedSign, entry.foldEffects);
    if (entry.verdict !== expectedVerdict) {
      throw new Error(
        `registryFrom: measured.json's verdict for "${spec.id}" is "${entry.verdict}" but verdictForFullWindow computes ` +
          `"${expectedVerdict}" from its own effect/ci/foldEffects — the file is stale or was hand-edited. Re-run \`npm run laws:measure\`.`,
      );
    }

    return {
      id: spec.id,
      position: spec.position,
      claim: spec.claim,
      measured,
      verdict: entry.verdict,
      modelPath: spec.modelPath,
      hasFoldEvidence: entry.foldEffects.some((fold) => fold.effect !== null),
      origin: "tribal" as const,
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

/** Where `discovered.json` lives — the same repo-root-relative convention as `MEASURED_JSON_PATH`,
 *  written through by `scripts/discover-laws.ts`. */
export const DISCOVERED_JSON_PATH = "src/projections/laws/discovered.json";

/** The thin file-reading wrapper every real caller uses: the committed `LAW_SPECS` against the
 *  committed `measured.json` (shape-validated by `parseMeasuredJson`, drift-checked by
 *  `registryFrom`), merged with `discovered.json`'s own BH survivors (shape-validated by
 *  `parseDiscoveredJson`, drift-checked by `discoveredLawsFrom`) — both read fresh off disk on
 *  every call. Tribal laws come first, in `LAW_SPECS`' own order, exactly as before Task 7; discovered
 *  laws follow, in `discovered.json`'s own key order (BH-survivor id order, itself deterministic —
 *  see `discovery/measure.ts`'s docblock). */
export function registry(): readonly Law[] {
  const measuredRaw = readFileSync(MEASURED_JSON_PATH, "utf-8");
  const discoveredRaw = readFileSync(DISCOVERED_JSON_PATH, "utf-8");
  return [
    ...registryFrom(LAW_SPECS, parseMeasuredJson(measuredRaw)),
    ...discoveredLawsFrom(parseDiscoveredJson(discoveredRaw)),
  ];
}
