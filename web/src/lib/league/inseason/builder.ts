/** The trade builder (Lane 61), the Trades screen itself since Lane 260: the member picks one or two
 * of their players and one or two of another team's, and the API answers what each lineup gains or
 * loses on the finder's own reckoning. The finder's trades are presets above the rosters, one tap each
 * to load into the ticks. Pure, so every pick and sentence the screen shows is tested here. No price,
 * no grade: the two lineups' change is the whole answer. */
import { fixed } from '#lib/format/number.ts';
import { listWords } from '#lib/format/list.ts';
import { onReserve, type BoxRow } from '../box/box.ts';
import { stripMark } from '../box/strip.ts';
import {
	finderRows,
	gainWord,
	offerText,
	refusalWords,
	shortSide,
	TRADES,
	worthProposing
} from '../box/trades.ts';
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
	return TRADED.has(line.player.position) && line.player.host_id !== '' && !onReserve(line);
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
 * a roster with no one it could drop to take two in, then a side that would not take it on its rest of
 * season (Lane 277: "They give up more rest of season than they get.") in place of the lineups' change,
 * else each lineup's change; then the trade's players with their rest-of-season points a game, and
 * the drop a full roster makes for two in. */
export function checkWords(check: Pick<TradeCheck, 'trade' | 'fills' | 'acceptable'>): string {
	const { fills, trade } = check;
	if (!fills.yours) return `Your roster would not fill ${slotPlace(fills.yours_open)}.`;
	if (!fills.theirs) return `Their roster would not fill ${slotPlace(fills.theirs_open)}.`;
	if (!fills.yours_room) return 'Your roster has no one to drop to make room.';
	if (!fills.theirs_room) return 'Their roster has no one to drop to make room.';
	const reason = trade.drop_reason === null ? '' : ` ${trade.drop_reason}`;
	const drop = trade.drop ? ` You drop ${trade.drop.player.name} to make room.${reason}` : '';
	return `${refusalWords(check.acceptable) ?? changeWords(trade)}${playersWords(trade)}${drop}`;
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
	/** The builder's link to the page's basis, which says what its figures are (Lane 66t). */
	figures: 'What the figures are',
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

/** One of our ideas above the rosters (Lane 260): the finder's best trade with a team, the picks it
 * loads, and the words its button draws. */
export interface Preset {
	key: string;
	team: TradeTeam;
	row: TradeRow;
	picks: Picks;
	/** Our best trade (worthProposing's first): the screen opens on its team. */
	lead: boolean;
	/** "Best" before the lead when there is more than one idea, as a strip marks its lead; null on the
	 * rest, and on every idea when no trade helps both lineups. */
	mark: string | null;
	/** "Rodgers for Skattebo and Strong". */
	deal: string;
	/** Each lineup's gain a week, in the card's one line: "+5.7 yours, +0.7 theirs". */
	gains: string;
}

/** How many ideas the row shows before its "N more" (Lane 268): the best three. */
export const IDEAS_SHOWN = 3;

/** The ideas row's control that shows the rest in place: "4 more". */
export function moreWords(hidden: number): string {
	return `${String(hidden)} more`;
}

/** Our ideas: the finder's best trade with each team, in the finder's order (the trades the other
 * team gains from first, each by your gain), each one whose players can all be ticked. The lead is
 * our best trade (worthProposing's first), so Best and the opening team agree (review L1). */
export function presetsFrom(teams: readonly TradeTeam[]): Preset[] {
	const proposed = worthProposing(teams)[0]?.key ?? null;
	const loadable = finderRows(teams, false).flatMap((entry) => {
		const picks = builtFrom(entry.team, entry.row);
		return picks === null ? [] : [{ ...entry, picks }];
	});
	return loadable.map((entry, i) => ({
		key: entry.key,
		team: entry.team,
		row: entry.row,
		picks: entry.picks,
		lead: entry.key === proposed,
		mark: entry.key === proposed ? stripMark(i, loadable.length) : null,
		deal: `${shortSide(entry.row.give)} for ${shortSide(entry.row.get)}`,
		gains: `${gainWord(entry.row.my_gain)} ${ANALYZER_LINES.yours}, ${gainWord(entry.row.their_gain)} ${ANALYZER_LINES.theirs}`
	}));
}

/** A team in the ideas row the finder lists no trade with (B271): every idea it found with them, they
 * would not take (Lane 269), so its place says so rather than leaving the team out. */
export interface NoIdea {
	key: string;
	team: TradeTeam;
	/** "No idea they would take." */
	note: string;
}

/** The teams with no idea, after the ideas, in the answer's order. */
export function noIdeasFrom(teams: readonly TradeTeam[]): NoIdea[] {
	return teams
		.filter((team) => team.trades.length === 0)
		.map((team) => ({ key: `none:${String(team.roster_id)}`, team, note: TRADES.noIdea }));
}

/** One place in the ideas row: an idea to load, or a team's line with none. */
export type IdeaPlace = { kind: 'idea'; preset: Preset } | { kind: 'none'; none: NoIdea };

/** The ideas row's places: our ideas best first, then each team with none (B271). */
export function ideaPlaces(presets: readonly Preset[], none: readonly NoIdea[]): IdeaPlace[] {
	return [
		...presets.map((preset): IdeaPlace => ({ kind: 'idea', preset })),
		...none.map((entry): IdeaPlace => ({ kind: 'none', none: entry }))
	];
}

/** The picks the screen opens with: the team of our best trade and nothing ticked, so the member's
 * own idea is a tick a player; no team when no trade helps both lineups, the member's roster alone. */
export function openingPicks(presets: readonly Preset[]): Picks {
	return { team: presets.find((p) => p.lead)?.team.roster_id ?? null, give: [], get: [] };
}

/** A check's answer with the picks it was read for. */
export interface Answered {
	picks: Picks;
	check: TradeCheck;
}

/** Whether the verbs (Propose, Share) act on the answer: only while the team and ticks are the ones it
 * was read for, and only on a trade both rosters can make (review H1, M1). While the next answer is
 * read after an idea or another tick, the last one stays drawn, quieter, and no verb copies it. */
export function proposable(answered: Answered | null, picks: Picks): boolean {
	return answered !== null && samePicks(answered.picks, picks) && fillsBoth(answered.check);
}

/** A roster row as the builder draws it (fix round 2): once his game is past its kickoff (the row's
 * lineState, as kickoff.ts pastKickoff and the trade's held week read it), his this-week cell is his
 * points, as the Lineup row's Pts cell draws them (BoxLine's boxNumber(row.pts), "--" without), never
 * the projection of a game under way or played. */
export function rosterRow(row: BoxRow): BoxRow {
	const past = row.state === 'kicked_off' || row.state === 'final';
	return past ? { ...row, proj: row.pts } : row;
}

/** Whether two picks are the same trade, in any order of ticks: the preset the ticks hold is pressed. */
export function samePicks(a: Picks, b: Picks): boolean {
	const same = (x: readonly string[], y: readonly string[]): boolean =>
		x.length === y.length && x.every((id) => y.includes(id));
	return a.team === b.team && same(a.give, b.give) && same(a.get, b.get);
}

/** The least a full bar stands for, in points a week, so a trade of small gains draws short bars. */
export const BAR_FLOOR = 1;

/** Each side's bar under its gain, as a share of the longer one (at least BAR_FLOOR), 0 to 1. */
export function gainBars(
	myGain: number | null,
	theirGain: number | null
): { yours: number; theirs: number } {
	const mine = Math.abs(myGain ?? 0);
	const theirs = Math.abs(theirGain ?? 0);
	const full = Math.max(mine, theirs, BAR_FLOOR);
	return { yours: mine / full, theirs: theirs / full };
}

/** Whether the check answered a trade both rosters can make: the one a member can share. */
export function fillsBoth(check: Pick<TradeCheck, 'fills'>): boolean {
	const { fills } = check;
	return fills.yours && fills.theirs && fills.yours_room && fills.theirs_room;
}

/** The trade as Share copies it, in our words: the offer, then each lineup's change and the drop.
 * "Trade with Max_Jensen10: Aaron Rodgers (QB PIT) for Cam Skattebo (RB NYG). Your lineup gains 5.7
 * points over replacement a week, theirs gains 0.7." */
export function shareText(team: Pick<TradeTeam, 'name'>, check: Pick<TradeCheck, 'trade'>): string {
	const { trade } = check;
	const drop = trade.drop ? ` You drop ${trade.drop.player.name} to make room.` : '';
	return `${offerText(team, trade)} ${changeWords(trade)}${drop}`;
}

/** The screen's own words (Lane 260), which the apps draw too, from the generated Analyzer table
 * (Lane 289). */
export const ANALYZER_LINES = {
	/** Over the presets: the finder's best trade with each team in this league, one tap each to load
	 * (Lane 268: "by team", so the row reads as the league's teams, not leagues). */
	ideas: 'Our ideas, by team',
	/** An idea's two gains a week: "+5.7 yours, +0.7 theirs". */
	yours: 'yours',
	theirs: 'theirs',
	/** The verdict's head over the sides' names, for a screen reader. */
	team: 'Team',

	/** The verb that copies the built trade as text. */
	share: 'Share',
	shared: 'Copied the trade as text.',
	/** The team choice before one is chosen. */
	pickTeam: 'Pick a team',
	/** The answer line with no team chosen. */
	noTeam: 'Pick a team to trade with, then tick a player on each side.',
	/** The switch between the two rosters where they stack: its name and the member's side. */
	rosters: 'Rosters',
	you: 'You'
} as const;

/** A side's ticks after its name on the roster switch: ", 1", nothing while none is ticked. */
export function countWords(side: readonly string[]): string {
	return side.length === 0 ? '' : `, ${String(side.length)}`;
}
