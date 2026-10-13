import type { ReadonlyDb } from "@research-ts/db/client";
import { loadModelArtifact, type ModelArtifactSpec } from "../model/artifacts";
import { VARIANCE_POSITIONS, type GameVariancePriors, type PlayerClass, type VariancePosition } from "./game-variance";

/**
 * THE PER-GAME VARIANCE TABLE AS TWO STORE ARTIFACTS (file-sourced data round, 2026-09-09),
 * replacing the generated `game-variance-fitted.ts` and `kdef-fitted.ts`'s variance slice, and
 * the hand-written `fitted-variance.ts` that composed them.
 *
 * TWO ARTIFACTS BECAUSE TWO SCRIPTS MEASURE THEM FROM TWO STORES, neither able to produce the
 * other's cells: `game-variance-fit.ts` reads `player_week_observations`, which has never held a
 * kicker or a team-defence row, and `kdef-fit.ts` reads the kicking and team-defence archives,
 * which hold nothing else. Each publishes its own half; `loadShippedGameVariance` composes them
 * and refuses an overlapping cell, because a spread that silently picked a winner would replace
 * one measured number with another and look like nothing at all.
 *
 * PARTIAL PER POSITION on purpose, as `GameVariancePriors` is: an absent cell is absent, and
 * `board.ts` reads `?? 0` for the games-only band. The parser therefore accepts a missing
 * position and refuses only what could never be a measurement: an unknown position, a negative or
 * non-finite cell, a missing player class.
 */

const PLAYER_CLASSES: readonly PlayerClass[] = ["rookie", "veteran"];

function isVariancePosition(key: string): key is VariancePosition {
  return (VARIANCE_POSITIONS as readonly string[]).includes(key);
}

function parseClassCells(playerClass: PlayerClass, raw: unknown): Partial<Record<VariancePosition, number>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`game variance: ${playerClass} must be an object of cells.`);
  const cells: Partial<Record<VariancePosition, number>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isVariancePosition(key)) throw new Error(`game variance: ${playerClass}.${key} is not a position the board bands on.`);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`game variance: ${playerClass}.${key} must be a finite, non-negative variance.`);
    cells[key] = value;
  }
  return cells;
}

export function parseGameVariancePriors(payload: unknown): GameVariancePriors {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("game variance: payload must be an object.");
  const record = payload as Record<string, unknown>;
  const parsed = {} as Record<PlayerClass, Partial<Record<VariancePosition, number>>>;
  for (const playerClass of PLAYER_CLASSES) {
    if (!(playerClass in record)) throw new Error(`game variance: ${playerClass} is missing.`);
    parsed[playerClass] = parseClassCells(playerClass, record[playerClass]);
  }
  return parsed;
}

/** The four skill positions, fit by `npm run projections:game-variance:fit`. */
export const GAME_VARIANCE_SKILL_ARTIFACT: ModelArtifactSpec<GameVariancePriors> = {
  name: "preseason/game-variance-skill",
  version: 1,
  parse: parseGameVariancePriors,
};

/** The kicker and team-defence cells, fit by `npm run projections:kdef:fit`. */
export const GAME_VARIANCE_KDEF_ARTIFACT: ModelArtifactSpec<GameVariancePriors> = {
  name: "preseason/game-variance-kdef",
  version: 1,
  parse: parseGameVariancePriors,
};

function composeClass(playerClass: PlayerClass, skill: GameVariancePriors, kdef: GameVariancePriors): Partial<Record<VariancePosition, number>> {
  for (const position of Object.keys(kdef[playerClass])) {
    if (position in skill[playerClass]) {
      throw new Error(`game variance: ${playerClass}.${position} is measured by both halves; neither may overwrite the other.`);
    }
  }
  return { ...skill[playerClass], ...kdef[playerClass] };
}

/** The two halves side by side. Throws on a cell both halves claim. */
export function composeGameVariance(skill: GameVariancePriors, kdef: GameVariancePriors): GameVariancePriors {
  return { rookie: composeClass("rookie", skill, kdef), veteran: composeClass("veteran", skill, kdef) };
}

/** The table `preseasonBoard` bands with: both pinned artifacts, composed. Throws when the store lacks either. */
export async function loadShippedGameVariance(db: ReadonlyDb): Promise<GameVariancePriors> {
  const [skill, kdef] = await Promise.all([loadModelArtifact(db, GAME_VARIANCE_SKILL_ARTIFACT), loadModelArtifact(db, GAME_VARIANCE_KDEF_ARTIFACT)]);
  return composeGameVariance(skill, kdef);
}
