/** What a room page says when something went wrong: the truth in our words, and what to do next.
 * Pure, so every page reads an error the same way. */
import { resolve } from '$app/paths';
import { ApiError, signInHref } from './api.ts';
import { MOCK } from './mock-words.ts';
import { LOBBY } from './lobby-words.ts';
import { keepsWayOut } from './notice-way-out.ts';

/** The page that hit the error: the reader's own mock or its report, a shared link, a lobby, setup. */
export type NoticeSubject = 'mock' | 'share' | 'lobby' | 'setup';

export interface NoticeLink {
	label: string;
	href: string;
}

/** A failure read again in place, beside the notice's way out. */
export interface NoticeRetry {
	label: string;
	run: () => void;
}

export interface NoticeView {
	text: string;
	/** The way forward, as the solid verb. */
	verb?: NoticeLink;
	/** A second way, quiet. */
	quiet?: NoticeLink;
}

const HTTP = {
	badRequest: 400,
	unauthorized: 401,
	forbidden: 403,
	notFound: 404,
	unprocessable: 422
} as const;

/** The API marks a board it could not build for a league's own rules in this field. */
const SCORING_FIELD = 'scoring';

/** The API names the site a refused signed-out start belongs on in this field. */
const SITE_FIELD = 'site';

function newMock(): NoticeLink {
	return { label: 'New mock', href: resolve('/mock/new') };
}

function joinLobby(): NoticeLink {
	return { label: LOBBY.joinLobby, href: resolve('/mock/new') };
}

function signIn(returnTo: string, label = 'Sign in'): NoticeLink {
	return { label, href: signInHref(returnTo) };
}

function signedOut(subject: NoticeSubject, returnTo: string): NoticeView {
	switch (subject) {
		case 'lobby':
			return {
				text: LOBBY.signedOut,
				verb: signIn(returnTo)
			};
		case 'setup':
			return {
				text: 'Sign in to join a lobby or save a league. A mock against bots starts without it.',
				verb: signIn(returnTo)
			};
		default:
			return {
				text: 'This mock is not in this browser. A mock started signed out stays with the browser that started it, and one started signed in stays with your account.',
				verb: newMock(),
				quiet: signIn(returnTo, 'Sign in to see your mocks')
			};
	}
}

function gone(subject: NoticeSubject): NoticeView | null {
	switch (subject) {
		case 'mock':
			return { text: 'This mock is gone. It was deleted, or the link is wrong.', verb: newMock() };
		case 'lobby':
			return { text: LOBBY.gone, verb: joinLobby() };
		default:
			return null;
	}
}

/** The site's setup page from the address the API names, or null for anything that is not an http(s)
 * origin: the link is built by the URL parser, so a trailing slash or a path never doubles up. */
function siteSetup(site: string | undefined): { host: string; href: string } | null {
	if (site === undefined || !URL.canParse(site)) return null;
	const url = new URL(site);
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	return { host: url.host, href: new URL('/mock/new', url.origin).href };
}

function refused(error: ApiError, subject: NoticeSubject): NoticeView | null {
	if (error.fields[SITE_FIELD] !== undefined) {
		const setup = siteSetup(error.fields[SITE_FIELD]);
		return {
			text: `${error.message}. Start yours there, signed in or not.`,
			...(setup ? { verb: { label: `Open ${setup.host}`, href: setup.href } } : {})
		};
	}
	if (subject === 'lobby') return { text: LOBBY.noSeat, verb: joinLobby() };
	return null;
}

/** A lobby page that did not load (`read`: its room or report read failed) with no way forward of
 * its own (no signal, the API's own fault) keeps the quiet way back to the lobbies, the apps' Join a
 * lobby beside their Try again. A failed action on a loaded page (Leave, Join another lobby, the
 * draft against bots) already draws its own verb, so it gets none. */
export function noticeFor(
	error: unknown,
	subject: NoticeSubject,
	returnTo: string,
	read = false
): NoticeView {
	const view = noticeOf(error, subject, returnTo);
	return keepsWayOut(view, subject, read) ? { ...view, quiet: joinLobby() } : view;
}

function noticeOf(error: unknown, subject: NoticeSubject, returnTo: string): NoticeView {
	if (!(error instanceof ApiError)) return { text: MOCK.unreachable };
	switch (error.status) {
		case HTTP.unauthorized:
			return signedOut(subject, returnTo);
		case HTTP.notFound:
			return gone(subject) ?? { text: error.message };
		case HTTP.forbidden:
			return refused(error, subject) ?? { text: error.message };
		case HTTP.badRequest:
			if (subject === 'share')
				return {
					text: "That link doesn't hold a draft. Ask for the link again, or set up your own mock.",
					verb: newMock()
				};
			return { text: error.message };
		case HTTP.unprocessable:
			if (error.fields[SCORING_FIELD] === 'refused')
				return {
					text: error.message,
					verb: { label: 'Open the setup page', href: resolve('/mock/new') }
				};
			return { text: error.message };
		case 0:
			return { text: `${error.message}. Check the connection and try again.` };
		default:
			return { text: error.message };
	}
}
