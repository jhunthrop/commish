/** The Account's parity (Lane 198): what the web's account page says over the fixture account at the
 * week's clock, which the apps' Account screens are held to. The name and the line under it
 * (account/words.ts displayName, whoLine), the free season's plan card (planWords) and the clock rule
 * of the free season (pass/free-season.ts freeSeasonAt), each attached league's row
 * (league/attached-rows.ts attachedRow) and the table head's count, a read's age in words
 * (hosts/platform-rows.ts readWords), and each paired device's line (hosts/device-words.ts). */
import type { Account } from '../../web/src/lib/account/account-api.ts';
import { displayName, planWords, whoLine } from '../../web/src/lib/account/words.ts';
import { FREE_SEASON_ENDS, freeSeasonAt } from '../../web/src/lib/pass/free-season.ts';
import type { AttachedLeague } from '../../web/src/lib/league/api.ts';
import { attachedCount, attachedRow } from '../../web/src/lib/league/attached-rows.ts';
import { followedName } from '../../web/src/lib/league/names.ts';
import { readWords } from '../../web/src/lib/hosts/platform-rows.ts';
import type { Device } from '../../web/src/lib/hosts/api.ts';
import { deviceCount, deviceLine } from '../../web/src/lib/hosts/device-words.ts';

export const ACCOUNT_OUTPUT = 'shared/fixtures/parity/account.json';

/** The ages a read is said at, in seconds before the clock: just now, minutes, hours, and a day and
 * more (its date). */
const READ_AGES = [20, 4 * 60, 3 * 3600, 2 * 86_400] as const;
/** The counts the two list heads are said at. */
const COUNTS = [0, 1, 3, 12] as const;
const MS = 1000;

export interface AccountAnswers {
	me: Account;
	devices: readonly Device[];
	attached: readonly AttachedLeague[];
}

/** The parity file over the fixture answers at `now`, the attached rows' phases in `zone`. */
export function renderAccount(
	about: string,
	answers: AccountAnswers,
	now: string,
	zone: string
): string {
	const at = new Date(now);
	const ago = (seconds: number): string => new Date(at.getTime() - seconds * MS).toISOString();
	const account = {
		about,
		now,
		zone,
		who: { name: displayName(answers.me), line: whoLine(answers.me) },
		plan: planWords(answers.me, true),
		freeSeason: [now, FREE_SEASON_ENDS].map((clock) => ({
			now: clock,
			free: freeSeasonAt(new Date(clock))
		})),
		leagues: answers.attached.map((league) => ({
			...attachedRow(league, at, zone),
			name: followedName(league)
		})),
		counts: COUNTS.map((count) => ({
			count,
			words: attachedCount(count),
			devices: deviceCount(count)
		})),
		reads: [null, ...READ_AGES.map(ago)].map((read) => ({
			readAt: read,
			words: readWords(read, at)
		})),
		devices: answers.devices.map((device) => ({ id: device.id, line: deviceLine(device) }))
	};
	return `${JSON.stringify(account, null, '\t')}\n`;
}
