import { popupSource } from '#lib/hosts/espn-window.ts';
import type { RequestHandler } from './$types';

/** The ESPN sign-in window's script, written as a static file at build: it hands Disney's answer to
 * the site's origin alone (SITE_ORIGIN). */
export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(popupSource(), { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
