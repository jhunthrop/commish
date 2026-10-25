/** What the companion's page reads off the API's answers: the host's picks kept across polls, the
 * picks as the rooms' views take them, the strip of picks as they land, and the bar's words. Pure, and
 * held by the apps' ports (shared/scripts/companion-parity.ts). */
import { dayLabel } from '#lib/format/date.ts';
import { pickLabel } from '#lib/format/draft.ts';
import { plural } from '#lib/format/number.ts';
import type { RoomCard, RoomPick } from '#lib/room/api.ts';
import type { Board } from '#lib/room/model.ts';
import type { PlayerRef, Position } from '#lib/types/player.ts';
import { POSITIONS } from '#lib/types/player.ts';
import type { StripPick } from '#lib/types/room.ts';
import type { Companion, CompanionPick, CompanionSummary } from './api.ts';
import { COMPANION } from './words.ts';

/** How often the page asks while the draft is on, and while it waits for it to start. */
export const POLL_MS = 3000;
/** The picks the landing strip shows, newest first: a round of a 12-team draft. */
export const STRIP_PICKS = 12;

/** The host's picks held by the page: the ones it had to the answer's since, then the answer's. */
export function mergePicks(held: readonly CompanionPick[], answer: Companion): CompanionPick[] {
	return [...held.filter((p) => p.pick <= answer.since), ...answer.picks];
}

/** The placed picks as the rooms' views take them. A pick we could not place is left out: it takes
 * nobody from our board. */
export function roomPicks(picks: readonly CompanionPick[]): RoomPick[] {
	return picks.flatMap((p) =>
		p.player_id === null
			? []
			: [{ pick: p.pick, round: p.round, seat: p.seat, player_id: p.player_id, auto: false }]
	);
}

/** The host's position as ours, or null for one we do not draft (a defensive player), which is
 * never drawn under a wrong pill. */
function position(p: string): Position | null {
	if (p === 'DEF') return 'DST';
	return POSITIONS.find((known) => known === p) ?? null;
}

/** The player a host pick names: our board's, the host's name for one we could not place, or null
 * for a position we do not draft. */
export function pickPlayer(p: CompanionPick, board: Board): PlayerRef | null {
	const ours = p.player_id === null ? undefined : board.byId.get(p.player_id);
	if (ours) return ours;
	const pos = position(p.position);
	return pos === null
		? null
		: {
				id: `host:${p.host_player_id}`,
				name: p.name,
				position: pos,
				positionRank: 0,
				team: p.team,
				headshot: ''
			};
}

/** The last picks, newest first, each with its pick and who made it. A pick at a position we do
 * not draft is left off the strip; the bar's count still holds it. */
export function landingStrip(
	picks: readonly CompanionPick[],
	board: Board,
	teams: number,
	you: number,
	names: readonly string[]
): StripPick[] {
	return picks
		.slice(-STRIP_PICKS)
		.reverse()
		.flatMap((p, i) => {
			const player = pickPlayer(p, board);
			return player
				? [
						{
							key: p.pick,
							player,
							lines: [
								pickLabel(p.pick, teams),
								p.seat === you ? COMPANION.you : (names[p.seat - 1] ?? '')
							],
							ring: i === 0 ? ('ink' as const) : undefined,
							strong: p.seat === you
						}
					]
				: [];
		});
}

/** Each seat's name, slot 1 first: you, the league member's name on the host, or the slot in a
 * mock draft or for a slot no member holds. */
export function seatNames(c: Pick<Companion, 'teams' | 'slot' | 'seat_names'>): string[] {
	return Array.from({ length: c.teams }, (_, i) => {
		if (i + 1 === c.slot) return 'You';
		const name = c.seat_names[i];
		return name !== undefined && name !== '' ? name : `Slot ${String(i + 1)}`;
	});
}

const HOST_NAMES: Readonly<Record<Companion['host'], string>> = {
	sleeper: 'Sleeper',
	ffpc: 'FFPC'
};

/** The host as a sentence names it, a mechanism: "Sleeper", "FFPC". */
export function hostName(host: Companion['host']): string {
	return HOST_NAMES[host];
}

/** The bar's line under the count: where the draft is and when you are up. */
export function turnWords(c: Companion): string {
	const host = hostName(c.host);
	switch (c.status) {
		case 'pre_draft':
			return `Waiting for the draft to start on ${host}`;
		case 'complete':
			return 'The draft is over';
		default:
			break;
	}
	const paused = c.status === 'paused' ? `Paused on ${host}. ` : '';
	if (c.your_turn) return `${paused}You're on the clock on ${host}`;
	if (c.your_next_pick === null || c.picks_until_turn === null) return `${paused}Your picks are in`;
	return `${paused}You pick at ${pickLabel(c.your_next_pick, c.teams)}, ${plural(c.picks_until_turn, 'pick')} away`;
}

/** The host's own page for the draft, where the drafter makes the pick. */
export function hostDraftUrl(c: Pick<Companion, 'host' | 'host_draft_id'>): string {
	// FFPC's draft board is keyed by the member's own team, which only FFPC's My Teams page opens.
	if (c.host === 'ffpc') return 'https://myffpc.com/MyTeams.aspx';
	return `https://sleeper.com/draft/nfl/${c.host_draft_id}`;
}

export { hasFeature as has } from '#lib/account/features.ts';

const STATUS_WORDS: Readonly<Record<CompanionSummary['status'], string>> = {
	pre_draft: 'not started',
	drafting: 'drafting',
	paused: 'paused',
	complete: 'over, the report is ready'
};

/** A followed draft as the start page lists it, a link back to it (`href`, its page's link). */
export function recentLine(
	r: CompanionSummary,
	href: string
): {
	key: string;
	lead: string;
	text: string;
	href: string;
} {
	const seat = r.host_username
		? `@${r.host_username}, slot ${String(r.slot)}`
		: `slot ${String(r.slot)}`;
	return {
		key: r.id,
		lead: r.name !== '' ? r.name : `${hostName(r.host)} draft ${r.host_draft_id}`,
		text: `${seat} · ${STATUS_WORDS[r.status]} · followed ${dayLabel(r.created_at)}`,
		href
	};
}

/** The bar's big figure: "22 of 240". */
export function pickCount(c: Pick<Companion, 'pick_count' | 'total_picks'>): string {
	return `${String(c.pick_count)} of ${String(c.total_picks)}`;
}

/** What the bar's figure counts: "picks made on Sleeper". */
export function picksMadeWords(host: Companion['host']): string {
	return `picks made on ${hostName(host)}`;
}

/** The bar's section, as a reader is told it: "The draft on Sleeper". */
export function draftOnWords(host: Companion['host']): string {
	return `The draft on ${hostName(host)}`;
}

/** The bar's way back to the platform's draft room: "Open the draft on Sleeper". */
export function openDraftWords(host: Companion['host']): string {
	return `Open the draft on ${hostName(host)}`;
}

/** The draft's name as the bar titles it: the platform's, else "Your draft". */
export function draftName(c: Pick<Companion, 'name'>): string {
	return c.name || COMPANION.yourDraft;
}

/** The bar's line when the platform did not answer the last read, null while it is fresh. */
export function staleWords(c: Pick<Companion, 'host' | 'host_stale_seconds'>): string | null {
	return c.host_stale_seconds === null
		? null
		: `${hostName(c.host)} has not answered for ${String(c.host_stale_seconds)} seconds. These are its last picks.`;
}

/** The call's one verb at the drafter's turn: the pick is made on the platform. */
export function makePickWords(host: Companion['host']): string {
	return `Make the pick on ${hostName(host)}`;
}

/** The call's verb between turns: queue him on the platform. */
export function queueWords(host: Companion['host']): string {
	return `Queue him on ${hostName(host)}`;
}

/** The strip's first line under the newest pick: "just taken on Sleeper". */
export function justTakenWords(host: Companion['host']): string {
	return `just taken on ${hostName(host)}`;
}

/** The report's Other seats cell: "Your league on Sleeper". */
export function leagueOnWords(host: Companion['host']): string {
	return `Your league on ${hostName(host)}`;
}

/** What a chance is of, under it: "reaches 2.08" on a call that waits on the board, "still there at
 * 3.05" at the drafter's turn, "your last pick" when no turn comes after. */
export function chanceLabel(card: RoomCard | null, teams: number): string {
	if (card?.conditional) return `reaches ${pickLabel(card.for_pick, teams)}`;
	if (card?.next_pick) return `still there at ${pickLabel(card.next_pick, teams)}`;
	return 'your last pick';
}

/** The pool's chance column: Reaches on a call that waits on the board, Still there at the turn. */
export function chanceColumn(card: RoomCard | null): string {
	return card?.conditional ? COMPANION.reachesHead : COMPANION.stillThereHead;
}

/** The line when our draft stops following the platform's, null while it follows. */
export function lostWords(c: Pick<Companion, 'host' | 'lost_at' | 'teams'>): string | null {
	return c.lost_at === null
		? null
		: `Pick ${pickLabel(c.lost_at, c.teams)} on ${hostName(c.host)} does not fit how our draft is set up, so our call stops there. The picks keep landing below.`;
}

/** The name-matched picks the page names at most, then "And 3 more placed by name." */
export const NAMED_LINES = 2;

/** The notes under the bar: picks we do not rank, the picks placed by name (`named`, the ones the
 * drafter has not been told of), and traded picks. */
export function companionNotes(
	c: Pick<Companion, 'host' | 'unplaced' | 'traded'>,
	named: Companion['placed_by_name']
): string[] {
	const host = hostName(c.host);
	return [
		c.unplaced > 0
			? `${plural(c.unplaced, 'pick')} on ${host} ${c.unplaced === 1 ? 'is a player' : 'are players'} we do not rank. Each fills his team's roster and takes nobody from our board.`
			: null,
		...named.slice(0, NAMED_LINES).map(
			(p) =>
				// A name that ends in "Jr." ends the sentence too.
				`${p.host_name} on ${host} is our ${p.board_name}${p.board_name.endsWith('.') ? '' : '.'}`
		),
		named.length > NAMED_LINES
			? `And ${String(named.length - NAMED_LINES)} more placed by name.`
			: null,
		c.traded > 0
			? `${plural(c.traded, 'pick')} changed hands on ${host}. Our call follows the draft order by slot.`
			: null
	].filter((n): n is string => n !== null);
}
