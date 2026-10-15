import { isScreen } from '#lib/league/inseason/words.ts';
import type { PageLoad } from './$types';

/** A followed league's in-season screen: start, waivers or trades; null for any other segment, which
 * the page answers as not found. */
export const load: PageLoad = ({ params }) => ({
	screen: isScreen(params.screen) ? params.screen : null
});
