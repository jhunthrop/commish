import { PROPS_ANCHOR_WEIGHT_ARTIFACT } from "../market/props-anchor-artifact";
import { GAME_VARIANCE_KDEF_ARTIFACT, GAME_VARIANCE_SKILL_ARTIFACT } from "../preseason/game-variance-artifacts";
import type { ModelArtifactSpec } from "./artifacts";

/**
 * EVERY ARTIFACT THE STORE MAY HOLD, by name, with the parser that validates its payload. The
 * publish script refuses a committed record whose name is not here, so a typo in a record's name
 * cannot publish a table nothing reads, and every payload is checked by the same parser the
 * readers run before it is written.
 *
 * Each spec is declared beside its readers (`preseason/game-variance-artifacts.ts`,
 * `market/props-anchor-artifact.ts`); this file only gathers them. A new artifact joins here in
 * the commit that adds its first record.
 */
export const MODEL_ARTIFACT_CATALOG: readonly ModelArtifactSpec<unknown>[] = [
  GAME_VARIANCE_SKILL_ARTIFACT,
  GAME_VARIANCE_KDEF_ARTIFACT,
  PROPS_ANCHOR_WEIGHT_ARTIFACT,
];

/** The catalogued spec for a name, or `null` for a name the code has never heard of. */
export function catalogSpecFor(name: string): ModelArtifactSpec<unknown> | null {
  return MODEL_ARTIFACT_CATALOG.find((spec) => spec.name === name) ?? null;
}
