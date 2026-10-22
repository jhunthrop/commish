/** Following several leagues in one tap: each through the one attach, in order, a failure kept to
 * its own league. Pure but for the attach it is handed, so the page and its words agree. */
import { FOLLOWED_PARAM } from '#lib/ui/nav.ts';

/** One league to follow: what the attach needs and what a sentence calls it. */
export interface ToFollow {
	key: string;
	name: string;
}

export interface Followed<T extends ToFollow> {
	league: T;
	/** Our attached league's id, the page it lands on. */
	id: string;
}

export interface Missed<T extends ToFollow> {
	league: T;
	/** The API's sentence for why, in its own words. */
	reason: string;
}

export interface FollowOutcome<T extends ToFollow> {
	made: Followed<T>[];
	missed: Missed<T>[];
}

/** Attaches each league in order. A failure on one is kept with its reason and the rest go on,
 * unless stop says the failure is everyone's (signed out of the host): then it is thrown, and the
 * leagues attached before it stay attached. */
export async function followInOrder<T extends ToFollow>(
	leagues: readonly T[],
	attach: (league: T) => Promise<string>,
	reason: (error: unknown) => string,
	stop: (error: unknown) => boolean
): Promise<FollowOutcome<T>> {
	const made: Followed<T>[] = [];
	const missed: Missed<T>[] = [];
	for (const league of leagues) {
		try {
			made.push({ league, id: await attach(league) });
		} catch (error) {
			if (stop(error)) throw error;
			missed.push({ league, reason: reason(error) });
		}
	}
	return { made, missed };
}

/** The verb over a count of chosen leagues: singular when one is chosen or only one can be, plural
 * otherwise. */
export function followVerb(count: number, most: number): string {
	return count === 1 || most <= 1 ? 'Follow my league' : 'Follow my leagues';
}

/** The one summary line: "Following 2 leagues." */
export function followingWords(count: number): string {
	return `Following ${String(count)} ${count === 1 ? 'league' : 'leagues'}.`;
}

/** A league that did not attach, named, with the API's reason. */
export function missedWords(missed: Missed<ToFollow>): string {
	return `${missed.league.name} was not followed. ${missed.reason}`;
}

/** The most leagues one account follows (the API's MaxLinksPerAccount), so a count read from an
 * address is believed only inside it. */
export const MOST_LEAGUES = 20;

/** The live leagues an account follows without many_leagues (the API's MostFree). */
export const MOST_FREE = 1;

/** How many more leagues the account can follow now, with or without many_leagues. */
export function roomToFollow(many: boolean, live: number): number {
	return Math.max(0, (many ? MOST_LEAGUES : MOST_FREE) - live);
}

/** The count in ?followed=, or null when it is missing or not a count of more than one league. */
export function followedCount(search: URLSearchParams): number | null {
	const raw = search.get(FOLLOWED_PARAM);
	if (raw === null || !/^[0-9]{1,2}$/.test(raw)) return null;
	const n = Number(raw);
	return n > 1 && n <= MOST_LEAGUES ? n : null;
}
