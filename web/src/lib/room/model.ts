/** What the rooms read off a draft: the board as players, whose turn it is, the pool, the strip of
 * picks since your last one, your team by slot and the wall. Pure functions over the API's answers. */
import { snakeSlot } from '#lib/format/draft.ts';
import type { PlayerRef, Position } from '#lib/types/player.ts';
import type { TeamSlot, WentPick } from '#lib/types/room.ts';
import type { BoardPlayer, LeagueSettings, RoomBoard, RoomPick } from './api.ts';

/** A board player as the room draws him. */
export interface RoomPlayer extends PlayerRef {
	adp: number | null;
	points: number | null;
	/** Points over replacement for this league, null when he has none. */
	vor: number | null;
	/** The round his points over replacement rank in on this board, for the value cell's tint. */
	vorRound: number | null;
	bye: number | null;
}

/** The board as the room reads it: players in the order drafters take them, by id. */
export interface Board {
	players: readonly RoomPlayer[];
	byId: ReadonlyMap<string, RoomPlayer>;
	basis: string;
	season: number;
	format: RoomBoard['format'];
}

/** The engine's DEF is the site's DST. */
function positionOf(position: BoardPlayer['position']): Position {
	return position === 'DEF' ? 'DST' : position;
}

/** A defense's face is its team's logo, from the same image host as the headshots. */
function teamLogo(team: string): string {
	return `https://a.espncdn.com/i/teamlogos/nfl/500/${team.toLowerCase()}.png`;
}

export function boardOf(board: RoomBoard, teams: number): Board {
	const valued = board.players
		.filter((p): p is BoardPlayer & { vor: number } => p.vor !== null)
		.sort((a, b) => b.vor - a.vor);
	const valueRank = new Map(valued.map((p, i) => [p.id, i + 1] as const));
	const players = board.players.map((p): RoomPlayer => {
		const rank = valueRank.get(p.id);
		return {
			id: p.id,
			name: p.name,
			position: positionOf(p.position),
			positionRank: p.position_rank,
			team: p.team,
			headshot: p.headshot === '' && p.position === 'DEF' ? teamLogo(p.team) : p.headshot,
			adp: p.adp,
			points: p.points,
			vor: p.vor,
			vorRound: rank === undefined ? null : Math.ceil(rank / teams),
			bye: p.bye
		};
	});
	return {
		players,
		byId: new Map(players.map((p) => [p.id, p] as const)),
		basis: board.basis,
		season: board.season,
		format: board.format
	};
}

/** The roster as slots, in the order the engine fills them. */
export function rosterSlots(
	settings: LeagueSettings
): readonly { slot: string; takes: readonly Position[] }[] {
	const r = settings.roster;
	const repeat = (slot: string, n: number, takes: readonly Position[]) =>
		Array.from({ length: n }, () => ({ slot, takes }));
	const flex: readonly Position[] = ['RB', 'WR', 'TE'];
	return [
		...repeat('QB', r.qb, ['QB']),
		...repeat('RB', r.rb, ['RB']),
		...repeat('WR', r.wr, ['WR']),
		...repeat('TE', r.te, ['TE']),
		...repeat('FLEX', settings.lineup === 'two_flex' ? 2 : 1, flex),
		...repeat('SFLX', settings.lineup === 'superflex' ? 1 : 0, ['QB', ...flex]),
		...repeat('K', r.k, ['K']),
		...repeat('DST', r.dst, ['DST']),
		...repeat('BN', r.bench, ['QB', 'RB', 'WR', 'TE', 'K', 'DST'])
	];
}

/** Your team by slot: each pick takes the first open slot that takes him, as the engine places it. */
export function teamSlots(
	settings: LeagueSettings,
	mine: readonly RoomPick[],
	board: Board
): TeamSlot[] {
	const slots: TeamSlot[] = rosterSlots(settings).map(({ slot }) => ({
		slot,
		player: null,
		pick: null
	}));
	const takes = rosterSlots(settings);
	for (const pick of mine) {
		const player = board.byId.get(pick.player_id);
		if (!player) continue;
		const open = slots.findIndex(
			(s, i) => s.player === null && takes[i]?.takes.includes(player.position)
		);
		if (open >= 0) slots[open] = { slot: slots[open]?.slot ?? 'BN', player, pick: pick.pick };
	}
	// The bench shows only who is on it.
	return slots.filter((s) => s.slot !== 'BN' || s.player !== null);
}

/** The seat on the clock at a pick. */
export function seatAt(pick: number, teams: number): number {
	return snakeSlot(pick, teams).seat;
}

/** The seat's first turn after a pick, or null when the draft ends first. */
export function turnAfter(pick: number, seat: number, teams: number, total: number): number | null {
	for (let n = pick + 1; n <= total; n += 1) if (seatAt(n, teams) === seat) return n;
	return null;
}

/** The seat's turn at or after a pick. */
export function turnFrom(pick: number, seat: number, teams: number, total: number): number | null {
	return seatAt(pick, teams) === seat ? pick : turnAfter(pick, seat, teams, total);
}

/** The seat's last pick before a pick, or null before its first. */
export function turnBefore(pick: number, seat: number, teams: number): number | null {
	for (let n = pick - 1; n >= 1; n -= 1) if (seatAt(n, teams) === seat) return n;
	return null;
}

/** Every pick after yours up to now, ringed when it was in your queue. */
export function wentSince(
	picks: readonly RoomPick[],
	since: number,
	queue: ReadonlySet<string>,
	board: Board
): WentPick[] {
	return picks
		.filter((p) => p.pick > since)
		.flatMap((p) => {
			const player = board.byId.get(p.player_id);
			return player ? [{ player, pick: p.pick, queued: queue.has(p.player_id) }] : [];
		});
}

export type PoolFilter = 'All' | Position | 'Queue';

/** The pool, ranked by points over replacement, players without one after in the order drafters
 * take them, filtered by a chip and a search. */
export function poolRows(
	board: Board,
	drafted: ReadonlySet<string>,
	filter: PoolFilter,
	queue: readonly string[],
	search: string
): RoomPlayer[] {
	const needle = search.trim().toLowerCase();
	const queued = new Set(queue);
	const available = board.players.filter(
		(p) =>
			!drafted.has(p.id) &&
			(filter === 'All' || (filter === 'Queue' ? queued.has(p.id) : p.position === filter)) &&
			(needle === '' || p.name.toLowerCase().includes(needle))
	);
	if (filter === 'Queue') return queue.flatMap((id) => available.filter((p) => p.id === id));
	return available.sort((a, b) => (b.vor ?? -Infinity) - (a.vor ?? -Infinity));
}

/** A pick list as a set of who is gone. */
export function draftedSet(picks: readonly RoomPick[]): Set<string> {
	return new Set(picks.map((p) => p.player_id));
}

/** One cell of the wall. */
export interface WallCell {
	round: number;
	seat: number;
	pick: number;
	player: RoomPlayer | null;
}

/** The wall's rounds through `rounds`, seat by seat. */
export function wallRows(
	picks: readonly RoomPick[],
	board: Board,
	teams: number,
	rounds: number
): WallCell[][] {
	const byPick = new Map(picks.map((p) => [p.pick, p] as const));
	return Array.from({ length: rounds }, (_, r) =>
		Array.from({ length: teams }, (_, s) => {
			const round = r + 1;
			const seat = s + 1;
			const pick = round % 2 === 1 ? r * teams + seat : r * teams + (teams - seat + 1);
			const made = byPick.get(pick);
			return { round, seat, pick, player: made ? (board.byId.get(made.player_id) ?? null) : null };
		})
	);
}
