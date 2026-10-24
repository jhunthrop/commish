/** The public pages a crawler is pointed to, from the run (Lane 169, rulings 4 and 5): every page's
 * canonical address, never a short format slug that redirects or a page kept out of search, and the
 * pages /llms.txt names with one line each. */
import { resolve } from '$app/paths';
import { positionsIn } from '#lib/run/derive.ts';
import type { LlmsPage } from '#lib/site/crawl.ts';
import { HEAD_WORDS } from '#lib/site/head-words.ts';
import { links } from '#lib/site/links.ts';
import { TERMS } from '#lib/legal/terms-words.ts';
import { buildWeekNames } from './build-week.ts';
import { recordDescription } from './pages/head.ts';
import { PAGE_NAME_WORDS } from '#lib/run/week-names.ts';
import { board, clubs, formatById, index, manifest, record, stamp } from './run.ts';

/** Every board view the run carries, at its canonical format id: the whole board and each position. */
async function boardPaths(): Promise<string[]> {
	const { formats } = await manifest();
	const views = await Promise.all(
		formats.map(async (format) => {
			const loaded = await board(format.id);
			return [
				links.board(format.id),
				...positionsIn([...loaded.rows, ...loaded.market]).map((position) =>
					links.board(format.id, position)
				)
			];
		})
	);
	return views.flat();
}

/** Every public page: the front door, the rankings, the record, the boards, ADP, the clubs and the
 * schedule, the free season, the sheet, the legal pages and every player's page. */
export async function publicPaths(): Promise<string[]> {
	const [{ formats }, boards, clubList, players] = await Promise.all([
		manifest(),
		boardPaths(),
		clubs(),
		index()
	]);
	return [
		resolve('/(run)'),
		links.players(),
		links.record(),
		...boards,
		...formats.map((format) => links.adp(format.id)),
		links.clubs(),
		...clubList.map((club) => links.club(club.abbr)),
		links.schedule(),
		links.pass(),
		links.sheet(),
		resolve('/terms'),
		resolve('/privacy'),
		...players.map((player) => links.player(player.slug))
	];
}

/** The sitemap's last change: the run's own stamp. */
export async function lastChanged(): Promise<string> {
	return (await stamp()).runAt;
}

/** The pages /llms.txt names, each line built from the run as the page itself is. */
export async function llmsPages(): Promise<LlmsPage[]> {
	const [run, [first], loaded, names] = await Promise.all([
		stamp(),
		index(),
		record(),
		buildWeekNames()
	]);
	const [format, graded] = await Promise.all([
		formatById(run.formats[0] ?? ''),
		formatById(loaded.format)
	]);
	return [
		{
			name: names?.rankings ?? PAGE_NAME_WORDS.players,
			path: links.players(),
			line:
				run.week === undefined
					? HEAD_WORDS.players(run.season, format.label)
					: HEAD_WORDS.rankings(run.season, run.week)
		},
		{
			name: 'Our record',
			path: links.record(),
			line: recordDescription(loaded, graded.label)
		},
		{
			name: 'How the record is graded',
			path: links.record(),
			line: loaded.method
		},
		...(first === undefined
			? []
			: [
					{
						name: 'Player pages',
						path: links.player(first.slug),
						line: HEAD_WORDS.llmsPlayers
					}
				]),
		{ name: TERMS.title, path: resolve('/terms'), line: TERMS.lead }
	];
}
