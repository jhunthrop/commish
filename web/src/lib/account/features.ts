/** What an account may use, read only from the features /me reports (the API's Can). A page never
 * decides from which product is held. */
import type { components } from '#lib/api/types.ts';

export type Feature = components['schemas']['Feature'];

export function hasFeature(features: readonly Feature[], feature: Feature): boolean {
	return features.includes(feature);
}

/** Whether the account has every feature a product unlocks. */
export function hasEvery(features: readonly Feature[], wanted: readonly Feature[]): boolean {
	return wanted.every((feature) => features.includes(feature));
}
