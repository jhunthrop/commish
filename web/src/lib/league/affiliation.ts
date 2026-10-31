/** The not-affiliated line (Lane 310), one wording on the site and in both apps (shared/words
 * not-affiliated.json): every platform a league is read from, switch or not, so the line never
 * changes with a switch. Small caption type beside the connect step, the legal pages' foot and the
 * account's Platforms; never a banner, modal or tip. It reads the platforms' names (names.ts, in the
 * naming order hosts.ts LEAGUE_HOSTS holds, which hosts.test.ts checks) rather than hosts.ts, so the
 * legal pages never pull the hosts' flags into the chunk every page loads. */
import { listWords } from '#lib/format/list.ts';
import { HOST_WORDS } from './names.ts';

export const NOT_AFFILIATED_LINE = `Commish is not affiliated with or endorsed by ${listWords(Object.values(HOST_WORDS), 'or')}.`;
