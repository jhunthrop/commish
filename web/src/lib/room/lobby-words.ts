/** The lobby's words (Lane 229): the landing's cards, the room's notices and leave question, the
 * score bug and the seats strip, the strip of picks as they land, the room's dock line and the report's
 * verbs, in a table the apps print from (shared/scripts/gen-words.ts); the lines that carry a figure or
 * a name are built by the functions below and held to shared/fixtures/parity/lobby.json. */
import { clockLabel, pickLabel } from '#lib/format/draft.ts';
import { plural } from '#lib/format/number.ts';

export const LOBBY = {
	/** A lobby card's one verb, and the card of a draft the member already holds a seat in. */
	join: 'Join',
	yourSeat: 'Your seat',
	/** The setup's quiet second verb. */
	joinWithPeople: 'Join a lobby with people',
	signInToJoin: 'Sign in to join a lobby',
	/** The handle the room shows the other drafters, asked before the first join. */
	handleAsk: 'The name the room shows the other drafters',
	handleLabel: 'Handle',
	handlePlaceholder: '3 to 20 letters, digits or _',
	saveAndJoin: 'Save and join',
	handleFailed: 'That handle did not save.',
	/** The room's bar: the pool's search and the quiet way out. */
	searchPool: 'Search the pool',
	leave: 'Leave',
	/** Leave asks once: what happens to the seat, before the draft starts and once it is on. */
	leaveFilling: 'Leave? Your seat opens for someone else.',
	leaveDrafting:
		'Leave? Your queue drafts your seat, then the board, and the report is yours when the draft ends.',
	leaveVerb: 'Leave the lobby',
	stay: 'Stay',
	/** The room's notices. */
	reconnecting: 'Reconnecting to the room.',
	refused: 'The room refused that.',
	over: 'The draft is over.',
	readReport: 'Read the report',
	abandoned: 'This lobby closed because nobody was here when it filled.',
	joinAnother: 'Join another lobby',
	/** A room read refused for good (RoomNotice, subject lobby). */
	signedOut: 'Sign in to draft in a lobby. The other drafters see your handle.',
	gone: 'This lobby is gone.',
	noSeat: 'You do not have a seat in this lobby.',
	joinLobby: 'Join a lobby',
	/** A room read that did not go (no signal, the API's own fault) is read again in place; a refusal
	 * for good keeps only the way out. */
	tryAgain: 'Try again',
	/** The score bug's heads (ScoreBug.svelte). */
	onTheClock: 'On the clock',
	clock: 'Clock',
	yourPick: 'Your pick',
	now: 'Now',
	yourPickIsNow: 'Your pick is now',
	/** A seat's line in the seats strip (SeatsStrip.svelte). */
	seatOnClock: 'on the clock',
	seatLeft: 'left, queue drafts',
	seatDrafter: 'drafter',
	seatWaiting: 'waiting',
	seatOpen: 'open',
	seats: 'Seats',
	/** The dock line's last clause, what happens to a seat whose drafter goes: the web's words, and
	 * the apps' (a phone has no tab to close). */
	standInWeb: 'a bot takes any seat that closes the tab',
	standInApp: 'a bot takes any seat that closes the app',
	/** The strip of picks as they land, its first line. */
	justTaken: 'just taken, newest first',
	/** The lobby a drafter left, offered back on the setup page (LeftLobby.svelte). */
	leftTitle: 'You left a lobby',
	leftOver: 'The draft is over and your report is ready.',
	leftDrafting: 'Your queue drafts your seat, then the board. Return and the seat is yours again.',
	returnVerb: 'Return to the lobby'
} as const;

/** A lobby card's clock: "30 s a pick". */
export function pickClockWords(seconds: number): string {
	return `${String(seconds)} s a pick`;
}

/** The strip's second line: how many of the picks as they land a person's own hand made, "2 of the
 * last 12 by people". */
export function byPeopleWords(people: number, count: number): string {
	return `${String(people)} of the last ${String(count)} by people`;
}

/** The filling room's line after its count: "The draft starts when 12 are in, or in 1:05 with bots in
 * the open seats." */
export function waitWords(teams: number, secondsLeft: number): string {
	return `The draft starts when ${String(teams)} are in, or in ${clockLabel(secondsLeft)} with bots in the open seats.`;
}

/** The dock's head: "12 PPR lobby". */
export function aboutHead(teams: number, preset: string): string {
	return `${String(teams)} ${preset} lobby`;
}

/** The dock's line after its head: who is in the room, then the clock and what happens to a seat that
 * steps away; `standIn` is the platform's last clause (LOBBY.standInWeb, LOBBY.standInApp). */
export function aboutWords(
	people: number,
	teams: number,
	started: boolean,
	clockSeconds: number,
	standIn: string = LOBBY.standInWeb
): string {
	const rest = started
		? ` and ${plural(teams - people, 'bot')}`
		: `, ${plural(teams - people, 'seat')} open`;
	return `${plural(people, 'drafter')}${rest}. ${String(clockSeconds)} seconds a pick, your queue drafts if you step away, ${standIn}.`;
}

/** The report's seats cell: "3 drafters, 9 bots". */
export function seatsWords(people: number, teams: number): string {
	return `${plural(people, 'drafter')}, ${plural(teams - people, 'bot')}`;
}

/** The report's quiet verb: "Run it against bots from slot 5". */
export function soloAgainWords(slot: number): string {
	return `Run it against bots from slot ${String(slot)}`;
}

/** The call's verb off your clock, from its verb on the clock: "Queue him first". */
export function queueFirstWords(draft: string): string {
	return `${draft} first`;
}

/** The score bug's round and pick: "Round 3", "Pick 3.05". */
export function roundWords(round: number): string {
	return `Round ${String(round)}`;
}

export function pickWords(pick: number, teams: number): string {
	return `Pick ${pickLabel(pick, teams)}`;
}

/** The score bug's countdown to your pick: "3.05, in 7". */
export function yourPickIn(pick: number, away: number, teams: number): string {
	return `${pickLabel(pick, teams)}, in ${String(away)}`;
}

/** A screen reader's clock on your own pick, at ten and five seconds: "10 seconds left". */
export function secondsLeftWords(mark: number): string {
	return `${String(mark)} seconds left`;
}

/** A compact seat in the strip as a screen reader names it: "Bot 3, open, on the clock". */
export function seatLabel(name: string, open: boolean, onClock: boolean): string {
	return `${name}${open ? `, ${LOBBY.seatOpen}` : ''}${onClock ? `, ${LOBBY.seatOnClock}` : ''}`;
}
