/** The not-affiliated line (Lane 310), one wording on the site and in both apps (shared/words
 * not-affiliated.json): every platform a league is read from, switch or not, so the line never
 * changes with a switch. Small caption type beside the connect step, the legal pages' foot and the
 * account's Platforms; never a banner, modal or tip. Apart from hosts.ts so only the pages that say
 * it carry it. */
import { LEAGUE_HOSTS, hostsOrList } from './hosts.ts';

export const NOT_AFFILIATED_LINE = `Commish is not affiliated with or endorsed by ${hostsOrList(LEAGUE_HOSTS)}.`;
