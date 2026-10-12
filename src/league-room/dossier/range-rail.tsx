import { Card } from "@/components/ui";
import type { PlayerFactsAvailability, PlayerFactsProjection } from "@research-ts/capsules/facts";

/** The five-point rail needs only the projection's own band and tail fields — never the raw
 *  season totals a caller might also be holding, so a `PlayerFactsProjection` satisfies this
 *  structurally with nothing extra to pick out by hand. */
export type RangeRailProjection = Pick<PlayerFactsProjection, "floorPoints" | "medianPoints" | "ceilingPoints" | "typicalLow" | "typicalHigh">;

export interface RangeRailProps {
  readonly projection: RangeRailProjection;
  /** `null` when the board's own `"availability"` reason never fired for him — the expected-games
   *  chip is simply absent then, never a fabricated season length. */
  readonly availability: PlayerFactsAvailability | null;
}

/** Where `value` sits between `floor` and `ceiling`, 0..100 — the rail's own coordinate space.
 *  Degenerate to the rail's midpoint when the band has no width at all (`ceiling <= floor`,
 *  never a division by zero) rather than throw over a stored row this component cannot fix. */
function railPct(value: number, floor: number, ceiling: number): number {
  if (ceiling <= floor) return 50;
  return Math.min(100, Math.max(0, ((value - floor) / (ceiling - floor)) * 100));
}

/**
 * THE RANGE RAIL (dossier plan, Task 3) — the five-point outcome rail the mock draws: the honest
 * p10/p90 tails as whisker ends, the p25/p75 "most seasons" band between them, and the median
 * tick labeled as our own number. Positions are computed, never hand-tuned, from the SAME three
 * numbers `PlayerFactsProjection.typicalLow`/`typicalHigh` were already derived from
 * (`quartilesFromSeasonBand`, `capsules/facts.ts`) — this component reads them, it does not
 * recompute a band.
 *
 * ACCENT IS RESERVED FOR OUR OWN NUMBER (global color discipline) — the rail track and its tails
 * stay neutral ink; only the median's own printed value carries `text-accent`, never the tick
 * mark itself (a filled accent bar would spend the fill budget `accent-budget.source.test.ts`
 * reserves for a handful of named primitives, none of them this one).
 *
 * The expected-games chip renders only when `availability` is real — see this component's own
 * prop docblock; absence here means the board never fired an `"availability"` reason for him,
 * never a season length this component invented.
 */
export function RangeRail({ projection, availability }: RangeRailProps) {
  const { floorPoints, medianPoints, ceilingPoints, typicalLow, typicalHigh } = projection;
  const median = Math.round(medianPoints);
  const bandStart = railPct(typicalLow, floorPoints, ceilingPoints);
  const bandEnd = railPct(typicalHigh, floorPoints, ceilingPoints);
  const medianPct = railPct(medianPoints, floorPoints, ceilingPoints);

  return (
    <Card as="section" aria-label="Season range" className="flex flex-col gap-3">
      <div
        className="relative h-2 w-full rounded-pill bg-surface-inset"
        role="img"
        aria-label={`Tails run ${Math.round(floorPoints)} to ${Math.round(ceilingPoints)} points. Most seasons land ${Math.round(typicalLow)} to ${Math.round(typicalHigh)}. ${median} is our number.`}
      >
        <div
          className="absolute inset-y-0 rounded-pill bg-text-faint/30"
          style={{ left: `${bandStart}%`, width: `${Math.max(0, bandEnd - bandStart)}%` }}
          data-rail-point="band"
        />
        <div className="absolute inset-y-0 left-0 w-0.5 bg-line" data-rail-point="floor" />
        <div className="absolute inset-y-0 right-0 w-0.5 bg-line" data-rail-point="ceiling" />
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-line"
          style={{ left: `${medianPct}%` }}
          data-rail-point="median"
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-text-faint">
        <span>an injury year</span>
        <span className="text-center text-text-muted">
          most seasons land in the band · <span className="font-medium text-accent">{median}</span> is our number
        </span>
        <span>the smash case</span>
      </div>
      {availability === null ? null : (
        <p className="text-xs text-text-faint" data-rail-chip="expected-games">
          Expected {Math.round(availability.expectedGames)} games, {Math.round(availability.floorGames)} to {Math.round(availability.ceilingGames)}
        </p>
      )}
    </Card>
  );
}
