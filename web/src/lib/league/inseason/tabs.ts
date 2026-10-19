/** A followed league's page: its own (/league/[id]) or a screen (/league/[id]/[screen]), the
 * screens sharing one route. Kept with the league's parts, so no other page carries them. */
import { resolve } from '$app/paths';
import { LEAGUE_HOME, type LeaguePage } from '#lib/ui/nav.ts';

/** The query that opens a league's page on its Settings view, the scoring rules' reference. */
export const SETTINGS_VIEW = { name: 'view', value: 'settings' } as const;

/** The anchor of the Settings list of the scoring rules our stats lack (Lane 66t). */
export const UNCOUNTED_ANCHOR = 'uncounted';

/** A league's Settings at the scoring rules our stats lack (Lane 66w, 66t): every basis's "Which
 * five" links here. */
export function leagueSettingsHref(id: string): string {
	return `${tabHref(LEAGUE_HOME, id)}?${SETTINGS_VIEW.name}=${SETTINGS_VIEW.value}#${UNCOUNTED_ANCHOR}`;
}

/** A league's page. */
export function tabHref(page: LeaguePage, id: string): string {
	return page === LEAGUE_HOME
		? resolve('/league/[id]', { id })
		: resolve('/league/[id]/[screen]', { id, screen: page });
}
