/** The trade builder (Lane 61): the member picks one or two of their players and one or two of
 * another team's, and the API answers what each lineup gains or loses on the finder's own reckoning.
 * Pure, so every pick and sentence the panel shows is tested here. No price, no grade: the two
 * lineups' change is the whole answer. */
import { fixed } from '#lib/format/number.ts';
import { listWords } from '#lib/format/list.ts';
import type { PlayerLine, TradeCheck, TradeCheckInput, TradeRow, TradeTeam } from './api.ts';
import { GAIN_DECIMALS, gainAmount, perGameWords, teamAside } from './words.ts';

/** The most players a side holds: the finder's reach. */
export const MAX_A_SIDE = 2;

/** The positions a trade takes (the API's skill positions). */
const TRADED = new Set(['QB', 'RB', 'WR', 'TE']);

/** The builder's picks: the other team by roster id (null before one is chosen) and each side's
 * players by host id, which every rostered player has, placed on our board or not. */
export interface Picks {
	team: number | null;
	give: readonly string[];
	get: readonly string[];
}

/** Whether a player can be picked: at QB, RB, WR or TE, named by the host, and not on injured
 * reserve. */
export function pickable(line: PlayerLine): boolean {
	return (
		TRADED.has(line.player.position) &&
		line.player.host_id !== '' &&
		!line.player.injured_reserve &&
		line.facts.designation?.status !== 'injured_reserve'
	);
}

/** A tap on a player: picked when the side has room, put back when he is picked. A third waits for
 * one put back. */
export function toggle(side: readonly string[], id: string): string[] {
	if (side.includes(id)) return side.filter((picked) => picked !== id);
	return side.length < MAX_A_SIDE ? [...side, id] : [...side];
}

/** The check to ask once a team is chosen and both sides hold a player; null before. */
export function checkInput(picks: Picks): TradeCheckInput | null {
	if (picks.team === null || picks.give.length === 0 || picks.get.length === 0) return null;
	return { team: picks.team, give: [...picks.give], get: [...picks.get] };
}

/** A finder row as the builder's picks, so the member can change one player and see the change; null
 * when a player in it has no host id. */
export function builtFrom(team: Pick<TradeTeam, 'roster_id'>, row: TradeRow): Picks | null {
	const ids = (side: readonly PlayerLine[]): string[] | null => {
		const out = side.flatMap((line) => (line.player.host_id === '' ? [] : [line.player.host_id]));
		return out.length === side.length ? out : null;
	};
	const give = ids(row.give);
	const get = ids(row.get);
	return give && get ? { team: team.roster_id, give, get } : null;
}

/** A team as the choice names it: its name, its owner and its record, "Muttdogs, muttdog, 5-0". */
export function teamChoice(team: Pick<TradeTeam, 'name' | 'owner' | 'record'>): string {
	return `${team.name}, ${teamAside(team)}`;
}

/** A slot the trade leaves empty, in a sentence: "RB2", "the flex", "every slot". */
function slotPlace(label: string | null): string {
	if (label === null) return 'every slot';
	return /flex/i.test(label) ? `the ${label.replace(/ \d+$/, '').toLowerCase()}` : label;
}

/** Which way a lineup moves, judged on the figure a page prints. */
function direction(gain: number): 'gains' | 'loses' | 'none' {
	if (fixed(Math.abs(gain), GAIN_DECIMALS) === fixed(0, GAIN_DECIMALS)) return 'none';
	return gain > 0 ? 'gains' : 'loses';
}

/** A gain or a loss as a number of points: "2.1". */
function amount(gain: number): string {
	return gain > 0 ? gainAmount(gain) : fixed(Math.abs(gain), GAIN_DECIMALS);
}

const PER_WEEK = 'points over replacement a week';

/** The two lineups' change in one sentence. */
function changeWords(row: Pick<TradeRow, 'my_gain' | 'their_gain'>): string {
	const mine = direction(row.my_gain);
	const theirs = direction(row.their_gain);
	if (mine === 'none' && theirs === 'none') return 'Neither lineup changes on our order.';
	if (mine === 'gains' && theirs === 'gains') {
		return `Both lineups gain: yours ${amount(row.my_gain)} ${PER_WEEK}, theirs ${amount(row.their_gain)}.`;
	}
	if (mine === 'none') {
		return `Your lineup does not change, theirs ${theirs} ${amount(row.their_gain)} ${PER_WEEK}.`;
	}
	if (theirs === 'none') {
		return `Your lineup ${mine} ${amount(row.my_gain)} ${PER_WEEK}, theirs does not change.`;
	}
	return `Your lineup ${mine} ${amount(row.my_gain)} ${PER_WEEK}, theirs ${theirs} ${amount(row.their_gain)}.`;
}

/** A player as the answer line names him, with his rest-of-season points a game when he has them:
 * "Kyren Williams (14.2 a game)". */
function figuredName(line: PlayerLine): string {
	const perGame = line.rest_of_season_per_game;
	return perGame === null ? line.player.name : `${line.player.name} (${perGameWords(perGame)})`;
}

/** The trade's players with their figures: "You give Kyren Williams (14.2 a game) for Nico Collins
 * (17.8 a game).", "" when no player in it has one (the preseason number). */
function playersWords(row: Pick<TradeRow, 'give' | 'get'>): string {
	const all = [...row.give, ...row.get];
	if (all.every((line) => line.rest_of_season_per_game === null)) return '';
	const side = (lines: readonly PlayerLine[]): string => listWords(lines.map(figuredName));
	return ` You give ${side(row.give)} for ${side(row.get)}.`;
}

/** The answer line: a roster the trade leaves short first ("Your roster would not fill RB2."), then
 * a roster with no one it could drop to take two in, else each lineup's change, the trade's players
 * with their rest-of-season points a game, and the drop a full roster makes for two in. */
export function checkWords(check: Pick<TradeCheck, 'trade' | 'fills'>): string {
	const { fills, trade } = check;
	if (!fills.yours) return `Your roster would not fill ${slotPlace(fills.yours_open)}.`;
	if (!fills.theirs) return `Their roster would not fill ${slotPlace(fills.theirs_open)}.`;
	if (!fills.yours_room) return 'Your roster has no one to drop to make room.';
	if (!fills.theirs_room) return 'Their roster has no one to drop to make room.';
	const reason = trade.drop_reason === null ? '' : ` ${trade.drop_reason}`;
	const drop = trade.drop ? ` You drop ${trade.drop.player.name} to make room.${reason}` : '';
	return `${changeWords(trade)}${playersWords(trade)}${drop}`;
}

/** The answer line before an answer: what is still to pick, or, once both sides hold a player, that
 * the trade is being checked. */
export function pickPrompt(picks: Picks): string {
	if (picks.give.length > 0 && picks.get.length > 0) return BUILDER_LINES.checking;
	if (picks.give.length === 0 && picks.get.length === 0) return BUILDER_LINES.pickBoth;
	return picks.give.length === 0 ? BUILDER_LINES.pickYours : BUILDER_LINES.pickTheirs;
}

/** The builder's fixed words. */
export const BUILDER_LINES = {
	/** The quiet verb over the finder's rows that opens the builder, and the panel's name. */
	open: 'Build a trade',
	team: 'Trade with',
	give: 'You give',
	get: 'You get',
	pickBoth: 'Pick one or two of your players and one or two of theirs.',
	pickYours: 'Now pick one or two of your players to give.',
	pickTheirs: 'Now pick one or two of theirs to get.',
	checking: 'Checking the trade',
	notNow: 'Not now',
	/** A side already holding two: said over its rows, which wait for one put back. */
	full: 'Two picked, tap one to put him back'
} as const;
