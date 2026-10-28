/** The Trades screen as a trade table (Lane 66g): a strip naming the trades worth proposing, each
 * with both sides, both gains and its one verb; the finder as a table, one trade a row (you give,
 * you get, with whom, each side's gain over the rest of the season a week and change in this week's
 * Proj, the room each roster has), sortable, a row opening its players in the box score's columns;
 * the builder's two box scores under a scoreboard of each side's totals before and after. Pure,
 * tested in trades.test.ts, so every word the screen prints is here. */
import { lastName } from '#lib/format/draft.ts';
import { listWords } from '#lib/format/list.ts';
import { fixed, MINUS, signed } from '#lib/format/number.ts';
import type { LeagueHost } from '../api.ts';
import type {
	PlayerLine,
	TradeAcceptable,
	TradeAdvice,
	TradeCheck,
	TradeMoves,
	TradeRow,
	TradeSideTotals,
	TradeTeam
} from '../inseason/api.ts';
import { tradeKey } from '../inseason/state.ts';
import { LINES, verbWords } from '../inseason/words.ts';
import { hostWords } from '../names.ts';
import {
	deskOrPhone,
	gamePart,
	finalsParts,
	KICKED_OFF_PART,
	OPP_PART,
	OPP_PHONE,
	projPart,
	ptsPart,
	said,
	uncountedPart,
	type BasisPart,
	type Clock
} from './basis.ts';
import { BOX, onReserve } from './box.ts';
import { locked } from './lineup.ts';
import { addressedWeek, arrivesPart, NEXT_WEEK, turnedPage, weekProjected } from './next-week.ts';
import { GAIN_A_WEEK, SEASON } from './season.ts';

/** Every word the trade table prints that is not a player's or a team's, for the copy guard. */
export const TRADES = {
	/** The second of the finder's two ruled-off groups; the first is gainHead's. */
	weekHead: `This week, ${BOX.proj}`,
	/** The week's group as the basis names it. */
	weekShort: 'This week',
	you: 'You',
	them: 'Them',
	/** The head over each side's gain, in the finder and on the builder's scoreboard: the same on the
	 * rest-of-season order and the preseason number, which the basis names (Lane 66u). */
	gainHead: GAIN_A_WEEK,
	/** A phone drops the groups' heads, so its two gain heads say the gain (review of the mock). */
	yourGain: `Your ${SEASON.gain.toLowerCase()}`,
	theirGain: `Their ${SEASON.gain.toLowerCase()}`,
	give: 'You give',
	get: 'You get',
	with: 'With',
	room: 'Room',
	best: 'Best with each team',
	every: 'Every trade',
	/** The opened trade's rows, by side. */
	sideGive: 'Give',
	sideGet: 'Get',
	sideDrop: 'Drop',
	perGame: SEASON.perGame,
	why: 'Why this trade',
	fromThis: 'Build from this',
	youHaveRoom: 'You have room',
	/** After a folded row's drop this week's lineup starts: "You drop Williams, a starter". */
	aStarter: 'a starter',
	theyHaveRoom: 'They have room',
	noOneToDrop: 'No one to drop',
	hasRoom: 'Has room',
	copied: 'Copied.',
	copyFailed: 'This browser would not copy it.',
	proposeItOn: 'Propose it on',
	/** A card's gains in a player's words (Lane 103, B42): "+3.5 a week for your lineup, +0.8 for
	 * theirs", the week's change beside them in the same words (weekLine). */
	aWeekForYou: 'a week for your lineup',
	forTheirs: 'for theirs',
	weekWord: 'Week',
	/** The builder's scoreboard. */
	yourSide: 'You',
	theirSide: 'With',
	propose: 'Propose',
	sortBy: 'Sort by',
	/** Between a total before the trade and after it, on the builder's scoreboard. */
	to: 'to',
	projForYou: 'Proj this week for your lineup',
	/** The verdict's rest-of-season cell (Lane 277, B272): its head, and the tag beside a side's change
	 * when that side would not take the trade (the API's acceptable). */
	restHead: 'Rest of season',
	wouldNotTake: 'Would not take it',
	/** The answer line when a side would not take the trade (Lane 269's rule), in place of the gains. */
	theyGiveUp: 'They give up more rest of season than they get.',
	youGiveUp: 'You give up more rest of season than you get.',
	bothGiveUp: 'Both sides give up more rest of season than they get.',
	/** The ideas row's line for a team the finder lists no trade with (B271): every idea it found with
	 * them, they would not take. */
	noIdea: 'No idea they would take.'
} as const;

/** A trade as the table lists it: its team and its row, keyed as the screen marks it. */
export interface FinderRow {
	key: string;
	team: TradeTeam;
	row: TradeRow;
}

/** The columns a member sorts the finder by, each best first. */
export type SortKey = 'mine' | 'theirs' | 'weekMine' | 'weekTheirs';

const SORT_FIGURE: Readonly<Record<SortKey, (row: TradeRow) => number | null>> = {
	mine: (row) => row.my_gain,
	theirs: (row) => row.their_gain,
	weekMine: (row) => row.my_proj_change,
	weekTheirs: (row) => row.their_proj_change
};

/** The API's order across teams: the trades the other team gains from first, then the close calls
 * for them, each by your gain, then theirs. */
function apiOrder(a: FinderRow, b: FinderRow): number {
	return (
		Number(a.row.close_for_them) - Number(b.row.close_for_them) ||
		b.row.my_gain - a.row.my_gain ||
		b.row.their_gain - a.row.their_gain
	);
}

/** The finder's rows: each team's first trade (the API's best with it), or every trade. */
export function finderRows(teams: readonly TradeTeam[], every: boolean): FinderRow[] {
	return teams
		.flatMap((team) =>
			(every ? team.trades : team.trades.slice(0, 1)).map((row) => ({
				key: tradeKey(team.roster_id, row),
				team,
				row
			}))
		)
		.sort(apiOrder);
}

/** The rows by a column, best first, a row without the figure last; ties keep the API's order. */
export function sortRows(rows: readonly FinderRow[], by: SortKey): FinderRow[] {
	const figure = SORT_FIGURE[by];
	return [...rows].sort((a, b) => {
		const fa = figure(a.row);
		const fb = figure(b.row);
		if (fa === fb) return apiOrder(a, b);
		if (fa === null) return 1;
		if (fb === null) return -1;
		return fb - fa;
	});
}

/** The most trades the strip names. */
export const STRIP_MOST = 2;

/** The trades worth proposing: the best with each team the other team gains from (never a close
 * call for them), at most two, each with a different team; none when no trade clears that bar. */
export function worthProposing(teams: readonly TradeTeam[]): FinderRow[] {
	return finderRows(teams, false)
		.filter(({ row }) => !row.close_for_them && row.my_gain > 0)
		.slice(0, STRIP_MOST);
}

const COUNT_WORDS = ['No', 'One', 'Two'];

/** "Two trades worth proposing", "One trade worth proposing". */
export function worthTitle(count: number): string {
	const n = COUNT_WORDS[count] ?? String(count);
	return `${n} ${count === 1 ? 'trade' : 'trades'} worth proposing`;
}

/** A trade's week in one line, from the API's two changes: "+7.3 Proj this week for your lineup, −5.6
 * for theirs", the gains' words (Lane 103); null without a projection read (review H2). */
export function weekLine(
	row: Pick<TradeRow, 'my_proj_change' | 'their_proj_change'>
): string | null {
	if (row.my_proj_change === null || row.their_proj_change === null) return null;
	return `${weekWord(row.my_proj_change)} ${TRADES.projForYou}, ${weekWord(row.their_proj_change)} ${TRADES.forTheirs}`;
}

/** Whether a trade still counts this week: every player it moves (both sides and the drop) has his
 * game still to be played by the API's state. */
function countsThisWeek(row: Pick<TradeRow, 'give' | 'get' | 'drop'>, now: number): boolean {
	const moved = [...row.give, ...row.get, ...(row.drop ? [row.drop] : [])];
	return !moved.some((l) => locked(l, now));
}

/** The finder's week group head: "This week, Proj", "Week 7, Proj" on a turned page (Lane 95). */
export function weekHeadFor(advice: { week: number; for_week?: number }): string {
	return turnedPage(advice)
		? `${NEXT_WEEK.week(addressedWeek(advice))}, ${BOX.proj}`
		: TRADES.weekHead;
}

/** A trade with no change this week once a player it moves has kicked off or is final (Lane 85): the
 * platform locks him, so the trade counts from next week. Its Gain stands. */
function heldRow(row: TradeRow, now: number): TradeRow {
	return countsThisWeek(row, now) ? row : { ...row, my_proj_change: null, their_proj_change: null };
}

/** The answer with every trade's week change held as heldRow says; the answer as it came when none
 * is. */
export function heldTrades<T extends { teams: readonly TradeTeam[] }>(advice: T, now: number): T {
	if (advice.teams.every((t) => t.trades.every((r) => countsThisWeek(r, now)))) return advice;
	return {
		...advice,
		teams: advice.teams.map((t) => ({ ...t, trades: t.trades.map((r) => heldRow(r, now)) }))
	};
}

/** The builder's check held the same way: no change and no lineup Proj before or after this week. */
export function heldCheck(check: TradeCheck, now: number): TradeCheck {
	if (countsThisWeek(check.trade, now)) return check;
	const side = (s: TradeSideTotals): TradeSideTotals => ({
		...s,
		proj_before: null,
		proj_after: null
	});
	return {
		...check,
		trade: heldRow(check.trade, now),
		totals: { yours: side(check.totals.yours), theirs: side(check.totals.theirs) }
	};
}

/** A side by last names: "Skattebo and Strong". */
export function shortSide(side: readonly PlayerLine[]): string {
	return listWords(side.map((line) => lastName(line.player.name)));
}

/** A gain as its cell prints it: "+5.7", "−0.3". */
export function gainWord(gain: number): string {
	return signed(Number(fixed(gain, 1)), 1);
}

/** A change in this week's Proj as its cell prints it: "+7.3", "−5.6", "0.0", "--" without one. */
export function weekWord(change: number | null): string {
	if (change === null) return BOX.none;
	const shown = Number(fixed(change, 1));
	return shown === 0 ? fixed(0, 1) : signed(shown, 1);
}

/** A figure's tone: up is a gain, down a loss, none even. */
export function toneOf(value: number | null): 'gain' | 'loss' | 'even' {
	if (value === null) return 'even';
	const shown = Number(fixed(value, 1));
	if (shown === 0) return 'even';
	return shown > 0 ? 'gain' : 'loss';
}

/** The drop by name where a row is folded: "Dart", "Williams, a starter" when this week's lineup
 * starts him (the API's drop_reason, said whole in the opened trade and on the card; Lane 66u). */
function dropName(row: Pick<TradeRow, 'drop' | 'drop_reason'>): string {
	const name = row.drop ? lastName(row.drop.player.name) : '';
	return row.drop_reason === null ? name : `${name}, ${TRADES.aStarter}`;
}

/** The room each roster has for a trade the finder lists: the member's drop by name, else room;
 * theirs always (the finder keeps only trades both rosters have room for, their drop theirs to
 * choose). */
export function roomWords(row: Pick<TradeRow, 'drop' | 'drop_reason'>): {
	yours: string;
	theirs: string;
} {
	return {
		yours: row.drop ? `You drop ${dropName(row)}` : TRADES.youHaveRoom,
		theirs: TRADES.theyHaveRoom
	};
}

/** A trade's second line on a phone: "with Max_Jensen10, you drop Dart". */
export function phoneWith(
	team: Pick<TradeTeam, 'name'>,
	row: Pick<TradeRow, 'drop' | 'drop_reason'>
): string {
	const drop = row.drop ? `, you drop ${dropName(row)}` : '';
	return `with ${team.name}${drop}`;
}

/** The builder's room, from the check: "Drop Dart", "Has room", "No one to drop". */
export function checkRoom(check: Pick<TradeCheck, 'trade' | 'fills'>): {
	yours: string;
	theirs: string;
} {
	const { fills, trade } = check;
	const yours = !fills.yours_room
		? TRADES.noOneToDrop
		: trade.drop
			? `${TRADES.sideDrop} ${lastName(trade.drop.player.name)}`
			: TRADES.hasRoom;
	return { yours, theirs: fills.theirs_room ? TRADES.hasRoom : TRADES.noOneToDrop };
}

/** A player as the copied trade names him: "Aaron Rodgers (QB PIT)". */
function offerName(line: PlayerLine): string {
	const club = line.player.team === '' ? '' : ` ${line.player.team}`;
	return `${line.player.name} (${line.player.position}${club})`;
}

/** The trade as it is copied, for the member to propose on the platform: "Trade with Max_Jensen10:
 * Aaron Rodgers (QB PIT) for Cam Skattebo (RB NYG) and Pierre Strong (RB GB)." */
export function offerText(
	team: Pick<TradeTeam, 'name'>,
	row: Pick<TradeRow, 'give' | 'get'>
): string {
	const side = (lines: readonly PlayerLine[]): string => listWords(lines.map(offerName));
	return `Trade with ${team.name}: ${side(row.give)} for ${side(row.get)}.`;
}

/** The trade verb by the moves rule: "Propose on Sleeper" where the platform takes a proposal from
 * here (none today), else "Open Sleeper trades", which copies the offer and opens its page. */
export function proposeVerb(moves: Pick<TradeMoves, 'propose'>, host: LeagueHost): string {
	return moves.propose === 'available'
		? verbWords('trades', host)
		: `Open ${hostWords(host)} trades`;
}

/** "Sleeper's trade page". */
export function tradePageWords(host: LeagueHost): string {
	return `${hostWords(host)}'s trade page`;
}

/** The line once the verb has copied the offer: what happened, then where to propose it, the page
 * its link. */
export interface CopiedTrade {
	said: string;
	page: string;
}

export function copiedTrade(host: LeagueHost, copied: boolean): CopiedTrade {
	return { said: copied ? TRADES.copied : TRADES.copyFailed, page: tradePageWords(host) };
}

/** One row of an opened trade: the side, which way he moves for the member, and his line. */
export interface SideRow {
	side: string;
	move: 'in' | 'out';
	line: PlayerLine;
}

/** An opened trade's players by roster: the member's give and drop, then their get. */
export function sideRows(row: Pick<TradeRow, 'give' | 'get' | 'drop'>): {
	yours: SideRow[];
	theirs: SideRow[];
} {
	const yours: SideRow[] = [
		...row.give.map((line) => ({ side: TRADES.sideGive, move: 'out' as const, line })),
		...(row.drop ? [{ side: TRADES.sideDrop, move: 'out' as const, line: row.drop }] : [])
	];
	return {
		yours,
		theirs: row.get.map((line) => ({ side: TRADES.sideGet, move: 'in' as const, line }))
	};
}

const ROSTER_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** A roster as the builder's box lists it: by position, each by this week's Proj, highest first (a
 * player without one after), injured reserve last. */
export function rosterOrder(lines: readonly PlayerLine[]): PlayerLine[] {
	const ir = (l: PlayerLine): number => Number(onReserve(l));
	const at = (l: PlayerLine): number => {
		const i = ROSTER_ORDER.indexOf(l.player.position);
		return i < 0 ? ROSTER_ORDER.length : i;
	};
	return [...lines].sort(
		(a, b) =>
			ir(a) - ir(b) ||
			at(a) - at(b) ||
			(b.week_projection ?? Number.NEGATIVE_INFINITY) -
				(a.week_projection ?? Number.NEGATIVE_INFINITY) ||
			a.player.name.localeCompare(b.player.name)
	);
}

/** One side of the builder's scoreboard: this week's Proj and the rest-of-season strength, each
 * before and after with the change, "--" before an answer or without a projection. */
export interface BugFigures {
	projBefore: string;
	projAfter: string;
	projChange: string;
	projTone: 'gain' | 'loss' | 'even';
	seasonBefore: string;
	seasonAfter: string;
	seasonChange: string;
	seasonTone: 'gain' | 'loss' | 'even';
}

/** A side of the scoreboard from the check: its totals, its rest-of-season gain and its change in this
 * week's Proj, both as the API sends them; the web computes no trade figure (review M1). */
export function bugFigures(
	totals: TradeSideTotals | null,
	gain: number | null,
	projChange: number | null
): BugFigures {
	// A strength below replacement prints with the typographic minus, as every signed figure does.
	const word = (value: number | null | undefined): string => {
		if (value === null || value === undefined) return BOX.none;
		const shown = fixed(Math.abs(value), 1);
		return value < 0 && Number(shown) !== 0 ? `${MINUS}${shown}` : shown;
	};
	return {
		projBefore: word(totals?.proj_before),
		projAfter: word(totals?.proj_after),
		projChange: weekWord(projChange),
		projTone: toneOf(projChange),
		seasonBefore: word(totals?.season_before),
		seasonAfter: word(totals?.season_after),
		seasonChange: gain === null ? BOX.none : gainWord(gain),
		seasonTone: toneOf(gain)
	};
}

/** A side's rest-of-season cell on the verdict (Lane 277): its change over the weeks the check covers,
 * toned as a gain or a loss, and whether that side would not take the trade. Before an answer it is the
 * none mark every verdict cell draws; on an answer without the figure (an older API) it is empty, never
 * a figure we did not read. */
export interface RestFigure {
	text: string;
	tone: 'gain' | 'loss' | 'even';
	refuses: boolean;
}

export function restFigure(
	check: Pick<TradeCheck, 'trade' | 'acceptable'> | null,
	side: 'yours' | 'theirs'
): RestFigure {
	if (check === null) return { text: BOX.none, tone: 'even', refuses: false };
	const rest = side === 'yours' ? check.trade.my_rest_of_season : check.trade.their_rest_of_season;
	if (rest === undefined) return { text: '', tone: 'even', refuses: false };
	return { text: gainWord(rest), tone: toneOf(rest), refuses: check.acceptable?.[side] === false };
}

/** The answer line's lead when a side would not take the trade, null when both would or the answer
 * does not say (an older API). */
export function refusalWords(acceptable: TradeAcceptable | undefined): string | null {
	if (acceptable === undefined) return null;
	if (!acceptable.yours && !acceptable.theirs) return TRADES.bothGiveUp;
	if (!acceptable.theirs) return TRADES.theyGiveUp;
	return acceptable.yours ? null : TRADES.youGiveUp;
}

/** "From McConkey Kong Country, you", "From Max_Jensen10". */
export function fromWords(team: string, mine: boolean): string {
	return mine ? `From ${team}, you` : `From ${team}`;
}

/** What the finder's Room column is. */
const ROOM_PART = `${TRADES.room} is who a roster drops to take two for one.`;

/** What the finder's two desk columns are: the week's change and Room. */
const WEEK_ROOM = `${TRADES.weekShort} is each lineup's ${BOX.proj} with the trade less without it, set as Lineup sets it. ${ROOM_PART}`;

/** The trade screen's basis, one paragraph under the rows (Lane 66t): who decides and what Gain is
 * (the API's), Proj, and at a desk the week's change and Room, then How the order has done. With a
 * trade opened or the builder open, its players' columns too: the figure a game, Opp rank, Pts at a
 * desk where the platform gives team totals alone, and the rules Avg and Last leave out; a defense's
 * scoring only with the builder's boxes, which draw one. Each said once; the builder's own line points here. */
export function tradeBasis(
	advice: Pick<
		TradeAdvice,
		| 'basis'
		| 'per_game_basis'
		| 'basis_note'
		| 'projection_read_at'
		| 'projection_scoring'
		| 'player_points'
	> &
		Partial<Pick<TradeAdvice, 'week' | 'for_week' | 'projection_arrives_at' | 'basis_note_list'>>,
	host: LeagueHost,
	lines: readonly PlayerLine[],
	opened: 'none' | 'trade' | 'builder',
	hrefs: { record: string },
	clock: Clock,
	now: number
): BasisPart[] {
	// The builder's boxes draw a defense; a trade never holds one (Lane 66g).
	const defense = opened === 'builder' && lines.some((l) => l.player.position === 'DEF');
	// An opened trade's and the builder's phone rows draw Avg and Last, so the phone keeps the sentence
	// saying what they count (Lane 115 fix round 1, HIGH-1); only the timing alone, about Final and
	// the Pts those rows do not draw, goes to the desk there for the eight lines.
	const waiting = finalsParts(lines, now, host, 'rosters', true).map((part) =>
		opened !== 'none' && part.text === KICKED_OFF_PART ? { ...part, phone: false } : part
	);
	// Before the week's projection is read, the day it arrives in its place (Lane 95).
	const arrives =
		advice.week === undefined
			? null
			: arrivesPart(
					advice,
					addressedWeek({ week: advice.week, for_week: advice.for_week }),
					clock.zone
				);
	const proj = said(
		arrives ??
			projPart(
				{
					readAt: advice.projection_read_at,
					scoring: advice.projection_scoring,
					defense,
					league: true,
					// A page turned past the platform's week names the week (Lane 111, B70).
					...(advice.week === undefined
						? {}
						: { weeks: { week: advice.week, for_week: advice.for_week } })
				},
				clock
			)
	);
	const players =
		opened !== 'none'
			? [
					// The builder's phone rows draw no Opp rank (TradeBox), so its sentence is the desk's there.
					...(opened === 'builder' ? said(OPP_PART, false) : deskOrPhone(OPP_PART, OPP_PHONE)),
					// The opened rows draw the Game cell's figures at a desk only (BoxLine phoneFacts).
					...said(gamePart(lines, clock, now, 'full'), false),
					...said(ptsPart(advice.player_points, host, 'rows'), false),
					...uncountedPart(advice, lines)
				]
			: [];
	return [
		...said(advice.basis),
		...(opened === 'none' ? [] : said(advice.per_game_basis)),
		...proj,
		...waiting,
		...players,
		// The week's group is drawn only once its projection is read (weekProjected): the apps' finder,
		// held to shared/scripts/trades-parity.ts.
		...said(weekProjected(advice) ? WEEK_ROOM : ROOM_PART, false),
		{ text: LINES.orderRecord, phone: true, href: hrefs.record }
	];
}
