/**
 * Translates the TypeScript engine's replay pins into JSON for the Go port (Lane 4), and records
 * V8's own answers for the float arithmetic and the string order the engine leans on, so the Go
 * port is checked against the engine that produced the pins rather than against itself.
 *
 *   npx tsx scripts/export-pins.ts
 *
 * Writes `api/testdata/pins/pins.json` and `api/testdata/pins/float-vectors.json`. Run once; the
 * pins inside are the 2026-09-13 recordings and are never regenerated to make a test pass.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { AUTOPICK_CONFIG, DRAFT_CLOCK_SCHEDULE, type DraftAutopickPolicy } from "@/draft-engine";
import { PIN_BOT_DELAYS_MS, PIN_LEGACY_BOT_PICKS, PIN_POOL, PIN_SEED, PIN_SURPLUS_CLOCK_PICKS, PIN_TEAMS } from "@/draft-engine/replay-pins.fixture";
import { assignArchetypes } from "@/mock-draft/archetypes";
import { botDelayStreamKey } from "@/mock-draft/bots";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { createSeededRng, rngFor } from "@/mock-draft/rng";

const OUT_DIR = join(process.cwd(), "api", "testdata", "pins");

/** The exact IEEE-754 bits of a double, as 16 hex digits: what "byte for byte" means for a float. */
function bits(value: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
}

/** The legacy-bot pin's snapshot: today's policy without the ceilings (`bots.test.ts`). */
const LEGACY_SNAPSHOT: DraftAutopickPolicy = Object.fromEntries(Object.entries(AUTOPICK_CONFIG).filter(([key]) => key !== "rosterCeilings")) as DraftAutopickPolicy;

/** The clock pin's snapshot, field by field (`autopick.test.ts`'s SURPLUS_SNAPSHOT). */
const SURPLUS_SNAPSHOT: DraftAutopickPolicy = {
  temperature: AUTOPICK_CONFIG.temperature,
  needPerOpenStartingSlot: AUTOPICK_CONFIG.needPerOpenStartingSlot,
  startersFilledDamp: AUTOPICK_CONFIG.startersFilledDamp,
  rampFullAtRosterFraction: AUTOPICK_CONFIG.rampFullAtRosterFraction,
  surplusDamp: AUTOPICK_CONFIG.surplusDamp,
  lateRoundOnlyRoundsFromEnd: AUTOPICK_CONFIG.lateRoundOnlyRoundsFromEnd,
};

function rngVectors(): readonly { readonly seed: number; readonly key: string; readonly draws: readonly string[] }[] {
  const keys = ["archetypes", "t01", "t07:pin:1", "t12:delay:24", "bot_park", "4a7c-e9:cont:131", "ünïcødé:κλειδί"];
  const seeds = [PIN_SEED, 0, 1, 4294967295, 2147483648, 123456789];
  return seeds.flatMap((seed) =>
    keys.map((key) => {
      const rng = rngFor(seed, key);
      return { seed, key, draws: Array.from({ length: 8 }, () => bits(rng.next())) };
    }),
  );
}

function pinsDocument(): Record<string, unknown> {
  const raw = createSeededRng(PIN_SEED);
  return {
    source: "src/draft-engine/replay-pins.fixture.ts, src/mock-draft/bots.test.ts, src/draft-engine/autopick.test.ts",
    seed: PIN_SEED,
    teams: PIN_TEAMS,
    pool: PIN_POOL,
    slotConfig: STANDARD_ROSTER_SLOTS,
    clockSchedule: DRAFT_CLOCK_SCHEDULE,
    startTimestamp: "2026-09-01T00:00:00.000Z",
    kickoffAt: "2026-09-10T17:00:00.000Z",
    legacyBotSnapshot: LEGACY_SNAPSHOT,
    surplusClockSnapshot: SURPLUS_SNAPSHOT,
    legacyBotPicks: PIN_LEGACY_BOT_PICKS,
    legacyBotPickStreamKey: "<teamId>:pin:<pickNumber>",
    botDelaysMs: PIN_BOT_DELAYS_MS,
    botDelaysBits: PIN_BOT_DELAYS_MS.map(bits),
    botDelayStreamKey: botDelayStreamKey("<teamId>", 0).replace(":0", ":<pickNumber>"),
    botDelayClockSeconds: 60,
    botDelayConfig: MOCK_CONFIG.botDelay,
    surplusClockPicks: PIN_SURPLUS_CLOCK_PICKS,
    archetypeDeal: assignArchetypes(PIN_SEED, PIN_TEAMS),
    rawSeedDraws: Array.from({ length: 16 }, () => bits(raw.next())),
    rngVectors: rngVectors(),
  };
}

/** A deterministic spread of doubles, so the vectors are reproducible from the script alone. */
function spread(seed: number, count: number, lo: number, hi: number): readonly number[] {
  const rng = createSeededRng(seed);
  return Array.from({ length: count }, () => lo + rng.next() * (hi - lo));
}

function floatDocument(): Record<string, unknown> {
  const expInputs = [
    ...Array.from({ length: 4000 }, (_, i) => -i / 3),
    ...Array.from({ length: 400 }, (_, i) => -i / 2.5),
    ...spread(1, 2000, -60, 5),
    ...spread(2, 1000, -1, 1),
    1, -1, 0, -0, 709, 709.8, -745, -746, 1e-9, -1e-9, 0.5 * Math.LN2, 1.5 * Math.LN2,
  ];
  const logInputs = [
    ...spread(3, 3000, 1e-6, 1),
    ...spread(4, 1000, 0.9, 1.1),
    ...spread(5, 1000, 1, 1e6),
    1.5, 0.02, 1, 2, 0.5, 1e-310, Number.MIN_VALUE, Number.MAX_VALUE,
  ];
  // Every (base, exponent) the engine can raise: a damp ramped by `1 - ramp * (1 - damp)`, ramp
  // `rosterLength / (0.5 * slots)` below full, the exponent a count of bodies on that roster
  // (`depthDamp ** benchBodies`, `surplusDamp ** extraSurplusBodies`, `benchBodyDamp ** n`), at
  // most one more than the roster holds. Rosters run to 25 slots (the API's MaxRounds).
  const reachablePow = [0.25].flatMap((damp) =>
    Array.from({ length: 26 }, (_, slots) => slots).flatMap((slots) =>
      Array.from({ length: slots + 1 }, (_, length) => length).flatMap((length) => {
        const base = 1 - Math.min(1, length / (0.5 * slots)) * (1 - damp);
        return Number.isNaN(base) ? [] : Array.from({ length: length + 2 }, (_, n) => [base, n] as const);
      }),
    ),
  );
  const otherPow = [...spread(6, 400, 0, 1), ...spread(7, 100, 1, 4), 0.6, 0.3, 0.7, 0.5].flatMap((base, index) => Array.from({ length: 4 }, (_, k) => [base, (index + k * 7) % 24] as const));
  const ids = ["4362628", "16800", "DST-HOU", "DST-DEN", "dst-hou", "t01", "t10", "t2", "a_b", "a-b", "ab", "aB", "Ab", "A", "a", "", "QB", "RB", "WR", "TE", "K", "DEF", "bot_park", "bot-park", "4a7c-e9", "4A7C-E9", "x1", "x_1", "x-1", "12", "1-2", "1_2"];
  return {
    source: "V8 (Node) Math.exp, Math.log, the ** operator and String.prototype.localeCompare",
    node: process.version,
    v8: process.versions.v8,
    arch: process.arch,
    platform: process.platform,
    exp: expInputs.map((x) => [bits(x), bits(Math.exp(x))]),
    log: logInputs.map((x) => [bits(x), bits(Math.log(x))]),
    powReachable: reachablePow.map(([x, y]) => [bits(x), y, bits(x ** y)]),
    powOther: otherPow.map(([x, y]) => [bits(x), y, bits(x ** y)]),
    collate: ids.flatMap((a) => ids.map((b) => [a, b, Math.sign(a.localeCompare(b))])),
  };
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "pins.json"), `${JSON.stringify(pinsDocument(), null, 1)}\n`);
writeFileSync(join(OUT_DIR, "float-vectors.json"), `${JSON.stringify(floatDocument())}\n`);
console.log(`wrote ${OUT_DIR}/pins.json and float-vectors.json`);
