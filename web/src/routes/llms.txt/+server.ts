import { llmsPages } from '#lib/server/crawl-pages.ts';
import { llmsTxt } from '#lib/site/crawl.ts';
import type { RequestHandler } from './$types';

/** What the site is and its public pages, for an assistant (Lane 169, ruling 5). The site's full
 * text is hundreds of player pages, so there is no /llms-full.txt. */
export const prerender = true;

export const GET: RequestHandler = async () =>
	new Response(llmsTxt(await llmsPages()), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
