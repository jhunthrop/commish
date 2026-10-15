import { screenOf } from '#lib/league/inseason/screens.ts';
import { FLAGS } from '#lib/site/flags.ts';
import type { PageLoad } from './$types';

/** A followed league's in-season screen: start, waivers or trades while the in-season tools are on;
 * null for any other segment, or any segment with the tools off, which the page answers with the
 * site's own not-found. Not thrown from here: on this client-rendered route a load's error reloads
 * the page without end (measured), and a param matcher would ship with the app's entry. */
export const load: PageLoad = ({ params }) => ({ screen: screenOf(params.screen, FLAGS) });
