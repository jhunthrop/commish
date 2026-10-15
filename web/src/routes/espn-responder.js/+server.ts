import { responderSource } from '#lib/hosts/espn-responder.ts';
import type { RequestHandler } from './$types';

/** The responder page's script, written as a static file at build: it appends Disney's responder
 * only when it runs on the sign-in origin (ESPN_SIGN_IN_ORIGIN). */
export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(responderSource(), {
		headers: { 'content-type': 'text/javascript; charset=utf-8' }
	});
