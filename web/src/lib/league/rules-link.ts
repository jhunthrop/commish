/** The way from a basis's "Which five" to the league's Settings list of the scoring rules our stats
 * lack (Lane 66w, 66t), apart from tabs.ts so the shell's chunk carries none of it. */
import { LEAGUE_HOME } from '#lib/ui/nav.ts';
import { SETTINGS_VIEW, tabHref } from './inseason/tabs.ts';
import { UNCOUNTED_ANCHOR } from './uncounted.ts';

/** A league's Settings at the scoring rules our stats lack. */
export function leagueSettingsHref(id: string): string {
	return `${tabHref(LEAGUE_HOME, id)}?${SETTINGS_VIEW.name}=${SETTINGS_VIEW.value}#${UNCOUNTED_ANCHOR}`;
}
