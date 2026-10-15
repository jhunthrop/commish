import { webManifest } from '#lib/site/app-manifest.ts';
import type { RequestHandler } from './$types';

/** The installable app's manifest, written as a static file at build (src/lib/site/app-manifest.ts). */
export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(JSON.stringify(webManifest()), {
		headers: { 'Content-Type': 'application/manifest+json' }
	});
