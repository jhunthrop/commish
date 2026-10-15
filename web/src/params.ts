/** The site's route parameter matchers. */
import { defineParams } from '@sveltejs/kit/params';
import { screenOf } from '#lib/league/inseason/screens.ts';
import { FLAGS } from '#lib/site/flags.ts';

export const params = defineParams({
	/** A followed league's in-season screen (start, waivers, trades) while the in-season tools are
	 * on. Any other segment, or any segment with the tools off, matches no route, so the site's own
	 * not-found answers. */
	inseason: (segment: string) => screenOf(segment, FLAGS) ?? undefined
});
