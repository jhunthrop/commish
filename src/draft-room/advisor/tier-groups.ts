/**
 * TIER GROUPS FOR A POSITION LIST — "Tier 2, 5 of 6 left" above the rows that stand in it, from
 * the games-worth standings the advisor ships per undrafted player. Grouped by tier, board order
 * kept inside a tier, players our board carries no tier for (no projection) last with no header.
 * A mixed-position list has no single ladder, so a caller groups only when one position shows.
 */
import type { TierStandingView } from "@/draft-service/assistant/view";

export interface TierGroup<Row> {
  /** `null` for the trailing unranked rows. */
  readonly header: string | null;
  readonly rows: readonly Row[];
}

export function tierHeaderText(standing: TierStandingView): string {
  return `Tier ${standing.tier}, ${standing.left} of ${standing.size} left`;
}

export function groupByTier<Row>(rows: readonly Row[], playerIdOf: (row: Row) => string, tiers: Readonly<Record<string, TierStandingView>>): readonly TierGroup<Row>[] {
  const byTier = new Map<number, { readonly standing: TierStandingView; readonly rows: Row[] }>();
  const unranked: Row[] = [];
  for (const row of rows) {
    const standing = tiers[playerIdOf(row)];
    if (standing === undefined) {
      unranked.push(row);
      continue;
    }
    const group = byTier.get(standing.tier);
    if (group === undefined) byTier.set(standing.tier, { standing, rows: [row] });
    else group.rows.push(row);
  }
  const ranked = [...byTier.values()].sort((a, b) => a.standing.tier - b.standing.tier).map((group) => ({ header: tierHeaderText(group.standing), rows: group.rows }));
  return unranked.length === 0 ? ranked : [...ranked, { header: null, rows: unranked }];
}
