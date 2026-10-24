import { lastChanged, publicPaths } from '#lib/server/crawl-pages.ts';
import { sitemapXml } from '#lib/site/crawl.ts';
import type { RequestHandler } from './$types';

/** Every public page at its canonical address, built with the run (Lane 169, ruling 4). */
export const prerender = true;

export const GET: RequestHandler = async () => {
	const [paths, lastmod] = await Promise.all([publicPaths(), lastChanged()]);
	return new Response(sitemapXml(paths, lastmod), {
		headers: { 'Content-Type': 'application/xml; charset=utf-8' }
	});
};
