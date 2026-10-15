import { stamp } from '#lib/server/run.ts';
import type { RequestHandler } from './$types';

/** The run this deploy prerendered, one line. The hourly backstop reads it from the live site and
 * skips the build when it is already the latest run (src/lib/run/deployed.ts). */
export const prerender = true;

export const GET: RequestHandler = async () =>
	new Response(`${(await stamp()).runId}\n`, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
