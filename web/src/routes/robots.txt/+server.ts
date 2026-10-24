import { robotsTxt } from '#lib/site/crawl.ts';
import type { RequestHandler } from './$types';

/** Every crawler allowed, the member's own pages kept out, the sitemap named (Lane 169, ruling 4). */
export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(robotsTxt(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
