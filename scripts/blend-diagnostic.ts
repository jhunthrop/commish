// THE BLEND'S OWN UNLISTED-PRICING DIAGNOSTIC (fix round 2, ruling 3) — committed, re-runnable,
// never a scratch script again. Fix round 1's own diagnostic reported ONE number — the best
// (lowest-numbered) rank any unlisted player reached — and that number looked fine (rank 20/43,
// both inside the "top-100" trigger, correctly flagged for a fix) while hiding a much larger
// regression the fix itself introduced: a single per-position affine rescale, applied uncorrected
// to QB, inflated backup-caliber unlisted quarterbacks toward starter-level output. The best-rank
// number never caught it because it only ever looks at ONE row.
//
// Two metrics catch what the single number could not:
//   1. TOP-100 POSITION MIX, blended vs raw — a position whose SHARE of the board's own top 100
//      balloons after blending (QB going from a normal ~15-20% to over half) is a structural
//      distortion a single best-rank number cannot see at all.
//   2. UNLISTED PLAYERS ABOVE THEIR OWN POSITIONAL TAIL — this should be exactly ZERO on a correct
//      build (`market/blend.ts`'s `rescaledUnlistedPoints` caps every unlisted candidate at
//      `constants.marketTailByPosition[position]` unconditionally), so this metric is the diagnostic
//      re-verifying the structural guarantee LIVE rather than trusting the code that promises it.
//
// Run: npm run projections:blend:diagnose [season ...]   (defaults to 2023, 2024)
import { createDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import type { Position } from "@/domain/player";
import type { LeagueShape } from "@/projections/decide/replacement";
import { shippedPreseasonCandidates } from "@/projections/market/blend";
import { FITTED_BLEND_CONSTANTS } from "@/projections/market/blend-fitted";
import { isCurvePosition } from "@/projections/market/curve";
import { preseasonBoard, type BoardCandidate, type BoardEntry } from "@/projections/preseason/board";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@/projections/preseason/fitted";
import { FITTED_MODEL } from "@/projections/model/source";
import { loadPreseason, type PreseasonPriors } from "@/projections/preseason/source";

const SEASONS = process.argv.slice(2).map(Number);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : [2023, 2024];
const TOP_N = 100;
const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE"];
/** See METRIC 2's own inline comment: the board's displayed points are rounded to the cent at the
 *  end of a round-trip through the synthetic per-game carrier field, which can shift the display by
 *  up to half a cent either way of the true, unrounded tail-capped value. A real violation is off by
 *  whole points, so this tolerance only absorbs the display artifact, never a genuine regression. */
const ROUNDING_TOLERANCE = 0.01;

const SCORED: readonly Position[] = ["QB", "RB", "WR", "TE"];
const SLOTS: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter(
  (slot) => slot.slot === BENCH_SLOT || slot.eligiblePositions.every((position) => SCORED.includes(position)),
).map((slot) => ({ ...slot, eligiblePositions: slot.eligiblePositions.filter((position) => SCORED.includes(position)) }));
const SHAPE: LeagueShape = { teamCount: 12, rosterSlots: SLOTS };

const PRIORS: PreseasonPriors = {
  model: FITTED_MODEL,
  availability: FITTED_AVAILABILITY_PRIORS,
  rookies: FITTED_ROOKIE_PRIORS,
  depth: FITTED_DEPTH_PRIORS,
  career: FITTED_CAREER_PRIORS,
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:blend:diagnose\`, which loads .env.local.`);
  }
  return value;
}

function positionMix(board: readonly BoardEntry[], topN: number): ReadonlyMap<Position, number> {
  const top = board.slice(0, topN);
  const counts = new Map<Position, number>();
  for (const entry of top) counts.set(entry.position, (counts.get(entry.position) ?? 0) + 1);
  return counts;
}

function printPositionMix(label: string, mix: ReadonlyMap<Position, number>, total: number): void {
  const cells = POSITIONS.map((position) => {
    const count = mix.get(position) ?? 0;
    const pct = total === 0 ? 0 : (count / total) * 100;
    return `${position} ${String(count).padStart(3)} (${pct.toFixed(0).padStart(3)}%)`;
  }).join("   ");
  console.log(`  ${label.padEnd(24)} ${cells}`);
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));

  for (const season of TARGET_SEASONS) {
    console.log(`\n=== ${season} ===`);
    const inputs = await loadPreseason(db, season);

    const blendedCandidates = await shippedPreseasonCandidates(db, inputs, PRIORS);
    const rawCandidates = await shippedPreseasonCandidates(db, inputs, PRIORS, { raw: true });

    const blendedBoard = preseasonBoard(blendedCandidates, { season, asOf: inputs.moment, rules: PPR_SCORING, shape: SHAPE });
    const rawBoard = preseasonBoard(rawCandidates, { season, asOf: inputs.moment, rules: PPR_SCORING, shape: SHAPE });

    console.log(`\nMETRIC 1 — TOP ${TOP_N} POSITION MIX, blended vs raw:`);
    printPositionMix("blended", positionMix(blendedBoard, TOP_N), Math.min(TOP_N, blendedBoard.length));
    printPositionMix("raw", positionMix(rawBoard, TOP_N), Math.min(TOP_N, rawBoard.length));

    const unlistedByPlayer = new Map<string, BoardCandidate>(
      blendedCandidates.filter((candidate) => candidate.reasons.some((reason) => reason.code === "market_unlisted")).map((c) => [c.playerId, c]),
    );
    let overTail = 0;
    const offenders: { readonly playerId: string; readonly position: Position; readonly points: number; readonly tail: number }[] = [];
    for (const entry of blendedBoard) {
      const unlisted = unlistedByPlayer.get(entry.playerId);
      if (unlisted === undefined) continue;
      if (!isCurvePosition(entry.position)) continue;
      const tail = FITTED_BLEND_CONSTANTS.marketTailByPosition[entry.position];
      // ROUNDING_TOLERANCE: `entry.projectedPoints` is the board's own DISPLAYED number, rounded to
      // the cent by `computeFantasyPoints`'s `roundPoints` at the END of a round-trip through the
      // synthetic per-game carrier field (`market/blend.ts`'s `pointsOnlyPerGame`: divide the capped
      // season total by games, encode, then `preseasonBoard` multiplies back and rounds again). The
      // UNDERLYING guarantee (`Math.min(rescaled, tail)`) is exact on the unrounded number; that
      // round-trip's own rounding can shift the DISPLAYED cent by up to half a cent either way when
      // the true value sits near a rounding boundary — a real violation would be off by whole points,
      // not a cent, so a tight tolerance here still catches a real regression while not crying wolf
      // over an artifact of the display path.
      if (entry.projectedPoints > tail + ROUNDING_TOLERANCE) {
        overTail += 1;
        offenders.push({ playerId: entry.playerId, position: entry.position, points: entry.projectedPoints, tail });
      }
    }
    console.log(
      `\nMETRIC 2 — unlisted players (${unlistedByPlayer.size} total) priced ABOVE their own positional tail: ${overTail}` +
        (overTail === 0 ? "  (the structural guarantee holds)" : "  (STRUCTURAL GUARANTEE VIOLATED)"),
    );
    for (const offender of offenders.slice(0, 10)) {
      console.log(`    ${offender.position} ${offender.playerId}  ${offender.points.toFixed(1)} pts  (tail ${offender.tail.toFixed(1)})`);
    }
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
