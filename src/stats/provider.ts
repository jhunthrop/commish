import type { Player, StatLine } from "@/domain/player";

/**
 * The seam between the app and its stats source. Phase 1 uses the deterministic mock;
 * a licensed feed (SportsDataIO / SportRadar / Genius — a business decision, Phase 8)
 * plugs in as another implementation of this interface, not a rewrite.
 */
export interface StatsProvider {
  listPlayers(): Promise<readonly Player[]>;
  getWeeklyStatLines(week: number): Promise<readonly StatLine[]>;
}
