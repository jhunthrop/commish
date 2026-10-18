import { boardBasis, type BasisPart } from '#lib/run/board-basis.ts';
import { adpDrafts } from '#lib/run/adp-drafts.ts';
import { rowFraming } from '#lib/run/row-framing.ts';
import { adp, clubByes, manifest, seasonReach, seasonUnderway } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** The comparison page is built once with no players chosen. The two players come from the query
 * string in the browser (?a=chris-olave&b=nico-collins), which a prerendered page cannot read at build.
 * It carries every format the run has, the default first, so it compares in the context's (the
 * selected league's) when the run carries it, each with its basis said once under the table, and
 * every club's bye for the Bye row. */
export const load: PageServerLoad = async () => {
	const [run, reach, underway, sources, byes] = await Promise.all([
		manifest(),
		seasonReach(),
		seasonUnderway(),
		adp(),
		clubByes()
	]);
	const lastSeason = `${String(run.season - 1)} a game is last season's points a game.`;
	const basis: Record<string, BasisPart[]> = Object.fromEntries(
		run.formats.map((format) => [
			format.id,
			[
				...boardBasis({
					format,
					season: run.season,
					order: 'board',
					adpBasis: adpDrafts(sources.sources, format.id),
					gap: rowFraming(format).compare,
					reach: underway ? reach : null
				}).map((part) => ({ ...part, phone: true })),
				{ text: lastSeason, phone: true }
			]
		])
	);
	return { formats: run.formats, basis, byes, season: run.season, underway };
};
