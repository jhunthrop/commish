/** The solo mock's words (Lane 213): the room's bar, the pool's row verbs, the turn with no call, the
 * setup's form and verb, the report's verbs and a shared draft's head, in a table the apps print from
 * (shared/scripts/gen-words.ts); the lines that carry a figure or a name are built by the functions
 * below. The rooms' shared words are words.ts ROOM and the report's report/headline.ts REPORT. */
import { pickLabel } from '#lib/format/draft.ts';

export const MOCK = {
	undo: 'Undo',
	/** The phone's fold of the bar's other verbs. */
	more: 'More',
	finish: 'Finish the draft',
	share: 'Save and share',
	copied: 'Link copied',
	queue: 'Queue',
	queued: 'Queued',
	/** Under a pick in the since strip that came off your queue. */
	queuedTag: 'queued',
	draft: 'Draft',
	noCall: 'No call for this pick. Draft from the pool.',
	theirTeam: 'Their team',
	/** A shared draft's seat when its drafter has no handle. */
	drafter: 'Drafter',
	/** Where the chances look when there is no next turn. */
	lastPick: 'your last pick',
	newMock: 'New mock',
	setupTitle: 'New mock',
	scoring: 'Scoring',
	teams: 'Teams',
	slot: 'Your slot',
	random: 'Random',
	lineup: 'Lineup',
	start: 'Start against bots',
	tryAnother: 'Try another slot',
	copyLink: 'Copy a share link',
	botsByAdp: 'Bots by ADP',
	setUpOwn: 'Set up your own',
	/** The pool's chance column's head on your clock. */
	stillThere: 'Still there',
	/** Who stands in for the other seats in the report's runs. */
	reshuffled: 'the bots',
	/** A room read that could not reach the API. */
	unreachable: 'The room could not be reached. Check the connection and reload.',
	/** The same failure on the phones, which have no reload: the retry control is the verb (B258). */
	unreachablePhone: 'The room could not be reached. Try again.',
	sharedNote:
		'It starts from the first pick with the same settings and bots, so they draft the same way until a pick of yours changes the board.'
} as const;

/** The bar's head: "Pick 5.08". */
export function pickHead(pick: number, teams: number): string {
	return `Pick ${pickLabel(pick, teams)}`;
}

/** Pick for me's verb: "Pick for me to round 8". */
export function autopickWords(round: number): string {
	return `Pick for me to round ${String(round)}`;
}

/** The verb on a turn with no call, from the player's surname (lastName): "Draft Williams". The room
 * draws the surname marked as his name (SoloRoom); the apps build the whole verb. */
export function draftNamed(surname: string): string {
	return `${MOCK.draft} ${surname}`;
}

/** The call's frame while the next call is on its way: "Reading the room for 2.12". */
export function readingWords(pick: number, teams: number): string {
	return `Reading the room for ${pickLabel(pick, teams)}`;
}

/** What the pool's chances are of: "still there at 6.05", or "your last pick". */
export function chanceLabel(nextPick: number | null, teams: number): string {
	return nextPick === null ? MOCK.lastPick : `still there at ${pickLabel(nextPick, teams)}`;
}

/** The line after an undo: the pick it went back to, who is back in the pool, and that the room
 * branched. */
export function undoneWords(pick: number, teams: number, name: string | null): string {
	const back = name === null ? '' : ` ${name} is in the pool again.`;
	return `Back to ${pickLabel(pick, teams)}.${back} Same bots, same seed, so the room drafts the same until your pick goes another way.`;
}

/** The report's verb: "Run it again from slot 5". */
export function runAgainWords(slot: number): string {
	return `Run it again from slot ${String(slot)}`;
}

/** A shared draft's verb: "Run this draft from slot 5". */
export function runSharedWords(slot: number): string {
	return `Run this draft from slot ${String(slot)}`;
}

/** A shared draft's title: "jh's mock from slot 5", "A shared mock from slot 5". */
export function sharedTitle(by: string | null | undefined, slot: number): string {
	return `${by ? `${by}'s mock` : 'A shared mock'} from slot ${String(slot)}`;
}

/** Where a shared draft stands: "finished", "at pick 5.08". */
export function sharedAt(complete: boolean, pick: number, teams: number): string {
	return complete ? 'finished' : `at pick ${pickLabel(pick, teams)}`;
}
