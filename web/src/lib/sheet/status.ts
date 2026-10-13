/**
 * The sheet's one status line, which tells a drafter whether his work is safe. It says only what
 * is known: "Offline" only when the browser says it has no connection, "can't be reached" only
 * for an account this browser has reached before, and "Saved to your account" only after a save
 * the account answered, with the time it did.
 */
import { localTimeLabel } from '#lib/format/date.ts';

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

const IN_BROWSER = 'Saved in this browser';

export interface StatusFacts {
	status: SyncStatus;
	/** The API's sentence for the last save that failed. */
	problem: string | null;
	/** When the account last answered a save. */
	savedAt: Date | null;
}

export function statusWords({ status, problem, savedAt }: StatusFacts): string {
	switch (status) {
		case 'local':
		case 'checking':
			return IN_BROWSER;
		case 'saving':
			return 'Saving to your account';
		case 'saved':
			return savedAt
				? `Saved to your account at ${localTimeLabel(savedAt)}`
				: 'Saved to your account';
		case 'offline':
			return `Offline. ${IN_BROWSER}`;
		case 'unreachable':
			return `${IN_BROWSER}. Your account can't be reached right now`;
		case 'failed':
			return problem ?? 'Not saved to your account';
		case 'storage-blocked':
			return 'This browser is not keeping it';
	}
}
