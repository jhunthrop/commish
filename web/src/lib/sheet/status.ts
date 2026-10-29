/**
 * The sheet's one status line, which tells a drafter whether his work is safe. It says only what
 * is known: "Offline" only when the browser says it has no connection, "can't be reached" only
 * for an account this browser has reached before, and "Saved to your account" only once the
 * account holds the sheet, stamped with the one changed date the sheet has, the account's own
 * (its time today, its day before), never the visit's (B52). An empty sheet has nothing to keep
 * safe, so it says nothing but a problem.
 */
import { sameDay } from '#lib/format/clock.ts';
import { dayLabel, localTimeLabel } from '#lib/format/date.ts';
import { SHEET_STATUS } from './words.ts';

export type SyncStatus =
	| 'local'
	| 'checking'
	| 'saving'
	| 'saved'
	| 'offline'
	| 'unreachable'
	| 'failed'
	| 'storage-blocked';

/** What a request that never reached the account means, from what the browser knows. */
export function unreachedStatus(online: boolean, knowsAccount: boolean): SyncStatus {
	if (!online) return 'offline';
	return knowsAccount ? 'unreachable' : 'local';
}

/** True while edits wait for the account to answer again, so the store keeps trying. */
export function awaitsAccount(status: SyncStatus): boolean {
	return status === 'offline' || status === 'unreachable';
}

/** What the status says while a reconcile is out: "Saving" only when it carries something to write
 * (an edit or a shelved sheet), so a visit or a tab coming back never claims a save (B52, Lane 105
 * fix round 1); signed in with nothing to write, the last word stands. */
export function reconcilingStatus(
	current: SyncStatus,
	signedIn: boolean,
	writes: boolean
): SyncStatus {
	if (!signedIn) return 'checking';
	return writes ? 'saving' : current;
}

const IN_BROWSER = SHEET_STATUS.inBrowser;

export interface StatusFacts {
	status: SyncStatus;
	/** The API's sentence for the last save that failed. */
	problem: string | null;
	/** When the account's copy last changed, its updated_at: the sheet's one changed date. */
	changedAt: string | null;
	/** The instant the account last answered, the clock "today" is said against. */
	answeredAt: Date | null;
	/** How many players the sheet holds. */
	players: number;
}

/** "Saved to your account at 7:41 PM" for a change today, "... Oct 13" for one before. */
function savedWords(changedAt: string | null, answeredAt: Date | null): string {
	if (changedAt === null) return SHEET_STATUS.saved;
	const today = answeredAt !== null && sameDay(new Date(changedAt), answeredAt);
	return today
		? SHEET_STATUS.savedAt(localTimeLabel(new Date(changedAt)))
		: SHEET_STATUS.savedOn(dayLabel(changedAt));
}

/** The status line, or null for an empty sheet with no problem to say. */
export function statusWords(facts: StatusFacts): string | null {
	const { status, problem } = facts;
	if (facts.players === 0) return status === 'failed' ? (problem ?? SHEET_STATUS.notSaved) : null;
	switch (status) {
		case 'local':
		case 'checking':
			return IN_BROWSER;
		case 'saving':
			return SHEET_STATUS.saving;
		case 'saved':
			return savedWords(facts.changedAt, facts.answeredAt);
		case 'offline':
			return `${SHEET_STATUS.offline} ${IN_BROWSER}`;
		case 'unreachable':
			return `${IN_BROWSER}. ${SHEET_STATUS.unreachable}`;
		case 'failed':
			return problem ?? SHEET_STATUS.notSaved;
		case 'storage-blocked':
			return SHEET_STATUS.notKept;
	}
}
