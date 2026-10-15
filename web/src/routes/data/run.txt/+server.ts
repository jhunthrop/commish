import { deployedStamp } from '#lib/run/deployed.ts';
import { stamp } from '#lib/server/run.ts';
import type { RequestHandler } from './$types';

/** What this deploy holds, one line: the run it prerendered and the commit it was built from (the
 * build's GITHUB_SHA, read from the build's own environment). The hourly backstop reads it from the
 * live site and skips only when both are the latest (src/lib/run/deployed.ts). */
export const prerender = true;

export const GET: RequestHandler = async () =>
	new Response(deployedStamp((await stamp()).runId, globalThis.process.env.GITHUB_SHA), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
