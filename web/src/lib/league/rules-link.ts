/** The way from an in-season basis to the league's Settings list of the scoring rules our stats lack
 * (Lane 66t): its anchor, at which the league page opens on Settings, and the link. Apart from
 * links.ts so the shell's chunk carries none of it. */
import { links } from '#lib/site/links.ts';

export const UNCOUNTED_ANCHOR = 'uncounted';

/** The league's Settings at the scoring rules our stats lack. */
export function leagueRules(id: string): string {
	return `${links.league(id)}#${UNCOUNTED_ANCHOR}`;
}
