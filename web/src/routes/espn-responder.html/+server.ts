import { RESPONDER_PAGE } from '#lib/hosts/espn-responder.ts';
import type { RequestHandler } from './$types';

/** The page Disney's sign-in answers the ESPN sign-in window through, written as a static file at
 * build. Its script loads Disney's responder on the workers.dev origin only. */
export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(RESPONDER_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
