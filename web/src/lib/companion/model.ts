/** What the companion's page reads off the API's answers: the host's picks kept across polls, the
 * picks as the rooms' views take them, the strip of picks as they land, and the bar's words. Pure. */
import { pickLabel } from '#lib/format/draft.ts';
import { plural } from '#lib/format/number.ts';
import type { RoomPick } from '#lib/room/api.ts';
import type { Board } from '#lib/room/model.ts';
import type { PlayerRef, Position } from '#lib/types/player.ts';
import { POSITIONS } from '#lib/types/player.ts';
import type { StripPick } from '#lib/types/room.ts';
import type { Companion, CompanionPick } from './api.ts';

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

function position(p: string): Position {
	if (p === 'DEF') return 'DST';
	return POSITIONS.find((known) => known === p) ?? 'WR';
}

/** The player a host pick names: our board's, or the host's name for one we could not place. */
export function pickPlayer(p: CompanionPick, board: Board): PlayerRef {
	const ours = p.player_id === null ? undefined : board.byId.get(p.player_id);
	return (
		ours ?? {
			id: `host:${p.host_player_id}`,
			name: p.name,
			position: position(p.position),
			positionRank: 0,
			team: p.team,
			headshot: ''
		}
	);
}

/** The last picks, newest first, each with its pick and who made it. */
export function landingStrip(
	picks: readonly CompanionPick[],
	board: Board,
	teams: number,
	you: number
): StripPick[] {
	return picks
		.slice(-STRIP_PICKS)
		.reverse()
		.map((p, i) => ({
			key: p.pick,
			player: pickPlayer(p, board),
			lines: [pickLabel(p.pick, teams), p.seat === you ? 'you' : `slot ${String(p.seat)}`],
			ring: i === 0 ? 'ink' : undefined,
			strong: p.seat === you
		}));
}

/** The bar's line under the count: where the draft is and when you are up. */
export function turnWords(c: Companion): string {
	switch (c.status) {
		case 'pre_draft':
			return 'Waiting for the draft to start on Sleeper';
		case 'complete':
			return 'The draft is over';
		default:
			break;
	}
	const paused = c.status === 'paused' ? 'Paused on Sleeper. ' : '';
	if (c.your_turn) return `${paused}You're on the clock on Sleeper`;
	if (c.your_next_pick === null || c.picks_until_turn === null) return `${paused}Your picks are in`;
	return `${paused}You pick at ${pickLabel(c.your_next_pick, c.teams)}, ${plural(c.picks_until_turn, 'pick')} away`;
}

/** The host's own page for the draft, where the drafter makes the pick. */
export function hostDraftUrl(c: Pick<Companion, 'host_draft_id'>): string {
	return `https://sleeper.com/draft/nfl/${c.host_draft_id}`;
}

export { hasFeature as has } from '#lib/account/features.ts';
