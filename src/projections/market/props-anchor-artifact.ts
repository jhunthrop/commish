import type { ModelArtifactSpec } from "../model/artifacts";
import type { BlendConstants } from "./blend";

/**
 * THE PROPS-ANCHOR WEIGHT AS A STORE ARTIFACT (file-sourced data round, 2026-09-09), replacing the
 * generated `props-anchor-fitted.ts`.
 *
 * THE ONE FITTED NUMBER `scripts/blend-fit.ts` CANNOT PRODUCE: its train window (2013-2021)
 * predates the props archive (2023 onward) entirely, so `propsAnchorWeight` is structurally a no-op
 * there. `scripts/props-anchor-fit.ts` fits this one axis on the seasons the archive covers, judges
 * it once on a held-out season, and publishes `{ weight }` here: a number in the unit interval
 * when the judge season beat the incumbent, `null` when it did not. `null` is a measured verdict
 * ("the gate was not beaten"), never an absence, which is why it is a field on an object rather
 * than a missing artifact.
 *
 * `preseason-persist.ts` is the one live-board consumer, through `blendConstantsWithPropsAnchor`:
 * a beaten gate merges the weight onto the blend constants for the BLENDED arm only; an unbeaten
 * one hands the base constants back BY REFERENCE, so a re-fit that lands on the null cell
 * reproduces the incumbent board bit for bit.
 */

export interface PropsAnchorWeight {
  readonly weight: number | null;
}

export function parsePropsAnchorWeight(payload: unknown): PropsAnchorWeight {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("props anchor: payload must be an object.");
  if (!("weight" in payload)) throw new Error("props anchor: weight is required (a number in [0, 1], or null for an unbeaten gate).");
  const { weight } = payload as { weight: unknown };
  if (weight === null) return { weight: null };
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error("props anchor: weight must be a finite number in [0, 1], or null.");
  }
  return { weight };
}

export const PROPS_ANCHOR_WEIGHT_ARTIFACT: ModelArtifactSpec<PropsAnchorWeight> = {
  name: "market/props-anchor-weight",
  version: 1,
  parse: parsePropsAnchorWeight,
};

/** The blended arm's constants: the base with the weight merged on when the gate was beaten, the base itself otherwise. */
export function blendConstantsWithPropsAnchor(base: BlendConstants, anchor: PropsAnchorWeight): BlendConstants {
  return anchor.weight === null ? base : { ...base, propsAnchorWeight: anchor.weight };
}
