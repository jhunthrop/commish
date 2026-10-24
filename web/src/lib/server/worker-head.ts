/** The head the Worker answers with for a page the browser draws (Lane 169, ruling 1; the audit's
 * E3): a league, a mock, a lobby and the live draft render nothing on the server, so their HTML
 * would carry no title or description for an unfurl. Each section's static line from the word
 * table, kept out of search: every one is a member's own page. Its canonical address names the
 * section and never a member's id (fix round 1, M1); its og:url is the request's own, so a share
 * opens the member's league or report. The league's line says the free season by the clock /pass
 * reads it with (pass/free-season.ts, M3). */
import { freeSeasonAt } from '#lib/pass/free-season.ts';
import { LEAGUE_FREE, WORKER_HEADS, type WorkerSection } from '#lib/site/head-words.ts';
import { headHtml, pageMeta } from '#lib/site/head.ts';

/** The route words a section's addresses carry between it and a member's id. */
const ROUTE_WORDS: ReadonlySet<string> = new Set(['new', 'share']);

const isWorkerSection = (segment: string): segment is WorkerSection =>
	Object.hasOwn(WORKER_HEADS, segment);

/** "/league/abc/lineup" to "/league/", "/mock/share/x7" to "/mock/share/", "/mock/new" as is: the
 * path up to its first segment that is not a route word. */
export function canonicalPathOf(pathname: string): string {
	const [section = '', ...rest] = pathname.split('/').filter((segment) => segment !== '');
	const words: string[] = [];
	for (const segment of rest) {
		if (!ROUTE_WORDS.has(segment)) return `/${[section, ...words].join('/')}/`;
		words.push(segment);
	}
	return `/${[section, ...words].join('/')}`;
}

/** The head's markup for a request's path at the page's clock, null for a path outside the four
 * sections. */
export function workerHeadHtml(pathname: string, now: Date): string | null {
	const section = pathname.split('/')[1] ?? '';
	if (!isWorkerSection(section)) return null;
	const words = WORKER_HEADS[section];
	const description =
		section === 'league' && freeSeasonAt(now)
			? `${words.description} ${LEAGUE_FREE}`
			: words.description;
	return headHtml({
		...pageMeta(description, canonicalPathOf(pathname), { noindex: true, sharePath: pathname }),
		title: words.title
	});
}
