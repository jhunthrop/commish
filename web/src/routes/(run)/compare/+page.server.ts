import { restCaption, restLead } from '#lib/run/rest-words.ts';
import { manifest, seasonReach } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** The comparison page is built once with no players chosen. The two players come from the query
 * string in the browser (?a=chris-olave&b=nico-collins), which a prerendered page cannot read at build.
 * It carries every format the run has, the default first, so it compares in the context's (the
 * selected league's) when the run carries it. */
export const load: PageServerLoad = async () => {
	const [run, reach] = await Promise.all([manifest(), seasonReach()]);
	// Each format's lead, and in season the figure's caption, built here: in season both name the
	// rest of the season, its first week and the refresh, and the in-season number is never captioned
	// with expected games (a preseason figure's caption takes his games in the browser).
	const words = Object.fromEntries(
		run.formats.map((format) => {
			const lead =
				restLead(format, reach, run.season) ??
				`Our ${format.label} board · ${String(run.season)} season`;
			return [format.id, { lead, caption: restCaption(format, run.season) }] as const;
		})
	);
	return { formats: run.formats, words };
};
