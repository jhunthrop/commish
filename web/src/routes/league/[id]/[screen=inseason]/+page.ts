import type { InSeasonScreen } from '#lib/league/inseason/screens.ts';
import type { PageLoad } from './$types';

/** A followed league's in-season screen. The route's matcher (src/params.ts) lets only start,
 * waivers and trades through, and only while the in-season tools are on. */
export const load: PageLoad = ({ params }) => {
	const screen: InSeasonScreen = params.screen;
	return { screen };
};
