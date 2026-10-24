/** The head the Worker answers with for a page the browser draws (Lane 169, ruling 1; the audit's
 * E3): a league, a mock, a lobby and the live draft render nothing on the server, so their HTML
 * would carry no title or description for an unfurl. Each section's static line from the word
 * table, its address the request's own, kept out of search: every one is a member's own page. */
import { WORKER_HEADS, type WorkerSection } from '#lib/site/head-words.ts';
import { headHtml, pageMeta } from '#lib/site/head.ts';

const isWorkerSection = (segment: string): segment is WorkerSection =>
	Object.hasOwn(WORKER_HEADS, segment);

/** The head's markup for a request's path, null for a path outside the four sections. */
export function workerHeadHtml(pathname: string): string | null {
	const section = pathname.split('/')[1] ?? '';
	if (!isWorkerSection(section)) return null;
	const words = WORKER_HEADS[section];
	return headHtml({
		...pageMeta(words.description, pathname, { noindex: true }),
		title: words.title
	});
}
