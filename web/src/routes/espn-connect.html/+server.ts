import { POPUP_PAGE } from '#lib/hosts/espn-window.ts';
import type { RequestHandler } from './$types';

/** The ESPN sign-in window's page, written as a static file at build. The account page opens it on
 * the workers.dev origin (ESPN_SIGN_IN_ORIGIN), never on the site's. */
export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(POPUP_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
