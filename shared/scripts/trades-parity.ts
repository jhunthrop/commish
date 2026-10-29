/** The Trades screen's parity (Lane 189): what the web's Trades (TradeScreen.svelte at 390 over
 * TradeStrip, TradeFinder, TradeBug, TradeCopied and BasisBlock) prints for the fixture league's trades
 * at each fixture clock, in the fixture's zone, as JSON the apps' ports are held to: the decision, the
 * strip (the week, its title, the platform's reason and each card), the chips' counts, the line under
 * the gain heads, the finder's rows in the web's order (each team's best and every trade, by each gain
 * a phone sorts by) with each row's opened players as the phone draws them, every trade's copied
 * offer (the share text), and the phone's basis with no trade opened and with one. The checks the
 * fixtures post are drawn as the scoreboard draws them (each side's figures before and after, its
 * room) with the answer's sentence and line. The screen draws at the page's clock, the instant the
 * answer was read (InSeasonPage's now), as TradeScreen is passed it. Written by export-parity.ts. */
import { BOX, boxNumber, boxRow } from '../../web/src/lib/league/box/box.ts';
import { drawnText } from '../../web/src/lib/league/box/basis.ts';
import { addressedWeek, weekProjected } from '../../web/src/lib/league/box/next-week.ts';
import { stripMark } from '../../web/src/lib/league/box/strip.ts';
import {
	bugFigures,
	checkRoom,
	copiedTrade,
	finderRows,
	fromWords,
	gainWord,
	heldCheck,
	heldTrades,
	offerText,
	phoneWith,
	proposeVerb,
	refusalWords,
	restFigure,
	roomWords,
	shortSide,
	sideRows,
	sortRows,
	toneOf,
	TRADES,
	tradeBasis,
	weekHeadFor,
	weekLine,
	worthProposing,
	worthTitle,
	type CopiedTrade,
	type FinderRow,
	type SortKey
} from '../../web/src/lib/league/box/trades.ts';
import type { LeagueHost } from '../../web/src/lib/league/api.ts';
import type {
	PlayerLine,
	TradeAcceptable,
	TradeAdvice,
	TradeCheck
} from '../../web/src/lib/league/inseason/api.ts';
import {
	ANALYZER_LINES,
	BUILDER_LINES,
	MAX_A_SIDE,
	builtFrom,
	checkWords,
	emptyNote,
	fillsWords,
	ideaPlaces,
	noIdeasFrom,
	offerPresets,
	pickable,
	pickPrompt,
	presetsFrom,
	teamChoice,
	type Picks
} from '../../web/src/lib/league/inseason/builder.ts';
import {
	CLOSE_FOR_THEM,
	noTradeWith,
	teamAside,
	tradeDecision
} from '../../web/src/lib/league/inseason/words.ts';
import { pickKey, pickerPlayers, tradeHolding } from '../../web/src/lib/league/inseason/state.ts';
import { rosterOrder } from '../../web/src/lib/league/box/trades.ts';
import { cells } from './lineup-parity.ts';

export const TRADES_OUTPUT = 'shared/fixtures/parity/trades.json';

/** The site's record page, the basis's last part's link (links.record()). */
const RECORD = '/record';

/** The gains a phone sorts the finder by: its two heads (TradeFinder drops the week's at 390). */
const PHONE_SORTS: readonly SortKey[] = ['mine', 'theirs'];

/** One opened row as the phone draws it (BoxLine with season, evidence and shortOnPhone): the box's
 * cells, which way he moves, and his rest-of-season points a game in the last cell. */
function openedRow(line: PlayerLine, side: string, move: 'in' | 'out', zone: string, now: number) {
	const row = boxRow(line, side, zone, false, now);
	return {
		...cells(null, row, null),
		move,
		season: boxNumber(row.evidence.season)
	};
}

/** A finder row as the phone draws it closed and opened, and the offer its verb copies. */
function rowOf(entry: FinderRow, me: string, zone: string, now: number): unknown {
	const { row, team } = entry;
	const sides = sideRows(row);
	const group = (head: string, list: typeof sides.yours) => ({
		head,
		rows: list.map((s) => openedRow(s.line, s.side, s.move, zone, now))
	});
	return {
		key: entry.key,
		team: team.name,
		rosterId: team.roster_id,
		give: shortSide(row.give),
		get: shortSide(row.get),
		with: phoneWith(team, row),
		need: row.need ?? null,
		mine: { gain: gainWord(row.my_gain), tone: toneOf(row.my_gain) },
		theirs: { gain: gainWord(row.their_gain), tone: toneOf(row.their_gain) },
		offer: offerText(team, row),
		opened: {
			week: weekLine(row),
			dropReason: row.drop_reason,
			groups: [
				group(fromWords(me, true), sides.yours),
				group(fromWords(team.name, false), sides.theirs)
			]
		}
	};
}

/** The strip as TradeStrip draws it: the week, its title, the platform's reason, each card. */
function stripOf(advice: TradeAdvice, host: LeagueHost): unknown {
	const worth = worthProposing(advice.teams);
	return {
		week: `${TRADES.weekWord} ${String(addressedWeek(advice))}`,
		title: worthTitle(worth.length),
		reason: advice.moves.reason,
		verb: proposeVerb(advice.moves, host),
		cards: worth.map((entry, index) => ({
			key: entry.key,
			mark: stripMark(index, worth.length),
			team: entry.team.name,
			give: shortSide(entry.row.give),
			get: shortSide(entry.row.get),
			mine: gainWord(entry.row.my_gain),
			theirs: gainWord(entry.row.their_gain),
			need: entry.row.need ?? null,
			week: weekLine(entry.row),
			drop: entry.row.drop ? roomWords(entry.row).yours : null,
			dropReason: entry.row.drop_reason
		}))
	};
}

/** The Trades at one clock as the web's phone draws it, the page's clock its read. */
export function tradesAt(
	answer: TradeAdvice,
	host: LeagueHost,
	me: string,
	clock: string,
	zone: string
): unknown {
	const now = Date.parse(clock);
	const advice = heldTrades(answer, now);
	const worth = worthProposing(advice.teams);
	const lines = [
		...advice.roster,
		...advice.teams.flatMap((t) => [...t.roster, ...t.trades.flatMap((r) => [...r.give, ...r.get])])
	];
	const basis = (opened: 'none' | 'trade' | 'builder'): string =>
		drawnText(
			tradeBasis(advice, host, lines, opened, { record: RECORD }, { zone, zoned: false }, now),
			'phone'
		);
	const finder = (every: boolean) =>
		Object.fromEntries(
			PHONE_SORTS.map((by) => [
				by,
				sortRows(finderRows(advice.teams, every), by).map((entry) => rowOf(entry, me, zone, now))
			])
		);
	return {
		clock,
		decision: tradeDecision(worth[0] ? { row: worth[0].row, team: worth[0].team.name } : null),
		strip: worth.length > 0 ? stripOf(advice, host) : null,
		chips: {
			best: `${TRADES.best}, ${String(advice.teams.filter((t) => t.trades.length > 0).length)}`,
			every: `${TRADES.every}, ${String(advice.teams.reduce((n, t) => n + t.trades.length, 0))}`
		},
		heads: {
			mine: TRADES.yourGain,
			theirs: TRADES.theirGain,
			give: TRADES.give
		},
		gainBasis: advice.gain_basis ?? null,
		weekHead: weekHeadFor(advice),
		weekShown: weekProjected(advice),
		verb: proposeVerb(advice.moves, host),
		reason: advice.host_trades_url === '' ? advice.host_note : null,
		finder: { best: finder(false), every: finder(true) },
		basis: {
			closed: basis('none'),
			opened: basis('trade'),
			builder: basis('builder')
		},
		restBasis: advice.rest_of_season_basis ?? null,
		ideas: ideasOf(advice)
	};
}

/** The builder-first screen's ideas row (Lane 260, Lane 268, Lane 277) as TradeBuilder draws it: our
 * ideas, best first, each card's team, gains, deal and what it fills (Lane 290, null on an answer
 * without fills), then each team the finder lists no trade with, its line in its place (B271), in the
 * row's order. The host's offers, which head the row, are needsAt's (`offers`). */
function ideasOf(advice: TradeAdvice): unknown {
	return {
		head: ANALYZER_LINES.ideas,
		places: ideaPlaces(presetsFrom(advice.teams), noIdeasFrom(advice.teams)).flatMap((place) =>
			place.kind === 'offer'
				? []
				: place.kind === 'idea'
				? {
						kind: 'idea',
						key: place.preset.key,
						rosterId: place.preset.team.roster_id,
						team: place.preset.team.name,
						mark: place.preset.mark,
						gains: place.preset.gains,
						deal: place.preset.deal,
						note: null,
						fills: place.preset.fills
					}
				: {
						kind: 'none',
						key: place.none.key,
						rosterId: place.none.team.roster_id,
						team: place.none.team.name,
						mark: null,
						gains: null,
						deal: null,
						note: place.none.note,
						fills: null
					}
		)
	};
}

/** The finder's newer fields as the screen draws them (Lane 290), from the answer and the check the
 * fixture serves with them (trade-fills.ts) at one clock: the host's offers at the head of the ideas
 * row (each card's label, team, deal, expiry, the ticks it loads or where to answer it), the row's
 * places as ideasOf draws them with each idea's fills line, each empty team's reason and its line, the
 * line for every reason the API sends, the verdict's rest-of-season cells on each lineup's figure,
 * and the builder's basis saying so. */
export function needsAt(
	answer: TradeAdvice,
	check: TradeCheck,
	host: LeagueHost,
	me: string,
	team: string,
	clock: string,
	zone: string
): unknown {
	const now = Date.parse(clock);
	const advice = heldTrades(answer, now);
	const lines = [
		...advice.roster,
		...advice.teams.flatMap((t) => [...t.roster, ...t.trades.flatMap((r) => [...r.give, ...r.get])])
	];
	const reasons = ['dropped', 'same_need', 'no_need', 'nothing'] as const;
	return {
		clock,
		offers: offerPresets(advice.offers ?? [], advice, host, now, zone).map((offer) => ({
			key: offer.key,
			label: offer.label,
			rosterId: offer.team.roster_id,
			team: offer.team.name,
			deal: offer.deal,
			expires: offer.expires,
			picks: offer.picks,
			note: offer.note
		})),
		ideas: ideasOf(advice),
		empty: advice.teams
			.filter((t) => t.trades.length === 0)
			.map((t) => ({ rosterId: t.roster_id, reason: t.empty_reason ?? null, note: emptyNote(t) })),
		reasons: Object.fromEntries([
			...reasons.map((reason) => [reason, emptyNote({ empty_reason: reason })]),
			['absent', emptyNote({})]
		]),
		fills: Object.fromEntries(
			(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX'] as const).map((slot) => [slot, fillsWords(slot)])
		),
		check: checkAt(check, me, team, clock),
		builderBasis: drawnText(
			tradeBasis(advice, host, lines, 'builder', { record: RECORD }, { zone, zoned: false }, now),
			'phone'
		)
	};
}

/** A check as the scoreboard draws it (TradeBug over bugFigures and checkRoom) with the answer's
 * sentence (checkWords) and its line, held at the page's clock (heldCheck). */
export function checkAt(answer: TradeCheck, me: string, team: string, clock: string): unknown {
	const check = heldCheck(answer, Date.parse(clock));
	const room = checkRoom(check);
	const side = (name: string, mine: boolean) => ({
		label: mine ? TRADES.yourSide : TRADES.theirSide,
		name,
		figures: mine
			? bugFigures(check.totals.yours, check.trade.my_gain, check.trade.my_proj_change)
			: bugFigures(check.totals.theirs, check.trade.their_gain, check.trade.their_proj_change),
		room: mine ? room.yours : room.theirs,
		rest: restFigure(check, mine ? 'yours' : 'theirs')
	});
	return {
		clock,
		heads: {
			week: TRADES.weekHead,
			gain: TRADES.gainHead,
			room: TRADES.room,
			to: TRADES.to,
			rest: TRADES.restHead,
			refuses: TRADES.wouldNotTake
		},
		yours: side(me, true),
		theirs: side(team, false),
		sentence: checkWords(check),
		basis: check.basis,
		restBasis: check.rest_of_season_basis ?? null
	};
}

/** The line under a pressed verb as TradeCopied reads: copied, or not, then where to propose it. */
export function copiedWords(host: LeagueHost): Record<string, string> {
	const words = (line: CopiedTrade): string => `${line.said} ${TRADES.proposeItOn} ${line.page}.`;
	return {
		done: words(copiedTrade(host, true)),
		failed: words(copiedTrade(host, false))
	};
}

/** A check's answer edited as builder.test.ts edits one (Lane 189 fix round 1, review M2): its gains,
 * its fills, whether its drop stays, its drop's sentence, and whether the players carry their points a
 * game. The app applies the same edits to the same fixture check and builds the sentence. */
export interface CheckEdit {
	name: string;
	myGain: number;
	theirGain: number;
	fills: TradeCheck['fills'];
	keepDrop: boolean;
	dropReason: string | null;
	perGame: boolean;
	/** Whether each side takes it on its rest of season (Lane 277); absent keeps the fixture's. */
	acceptable?: TradeAcceptable | null;
	/** Each side's rest of season; absent keeps the fixture's, null drops both (an older API). */
	rest?: { yours: number; theirs: number } | null;
}

const FILLS: TradeCheck['fills'] = {
	yours: true,
	theirs: true,
	yours_open: null,
	theirs_open: null,
	yours_room: true,
	theirs_room: true
};

/** Every branch of checkWords (builder.ts): each lineup gaining, losing or not changing, a gain under
 * what a page shows, a roster that would not fill a slot (a numbered one, the flex, every slot), one
 * with no one to drop, a drop with its sentence, and players without their points a game. */
const CHECK_EDITS: readonly CheckEdit[] = [
	{
		name: 'both gain',
		myGain: 1.5,
		theirGain: 0.6,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'gains, loses',
		myGain: 2.1,
		theirGain: -0.8,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'loses, gains',
		myGain: -3,
		theirGain: 4.2,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'neither',
		myGain: 0,
		theirGain: 0,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'yours no change',
		myGain: 0,
		theirGain: 1.1,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'theirs no change',
		myGain: -1.2,
		theirGain: 0.02,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'under 0.1',
		myGain: 0.04,
		theirGain: 0.6,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'drop',
		myGain: 2.1,
		theirGain: 0.8,
		fills: FILLS,
		keepDrop: true,
		dropReason: null,
		perGame: true
	},
	{
		name: 'drop with its sentence',
		myGain: 2.1,
		theirGain: 0.8,
		fills: FILLS,
		keepDrop: true,
		dropReason: 'Dart starts at QB for you this week, and Mahomes takes that spot after the trade.',
		perGame: true
	},
	{
		name: 'no points a game',
		myGain: 2.1,
		theirGain: 0.8,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: false
	},
	{
		name: 'yours would not fill RB2',
		myGain: 2.1,
		theirGain: 0.8,
		fills: { ...FILLS, yours: false, yours_open: 'RB2' },
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'yours would not fill the flex',
		myGain: 2.1,
		theirGain: 0.8,
		fills: { ...FILLS, yours: false, yours_open: 'Flex 1' },
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'yours would not fill every slot',
		myGain: 2.1,
		theirGain: 0.8,
		fills: { ...FILLS, yours: false },
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'theirs would not fill TE',
		myGain: 2.1,
		theirGain: 0.8,
		fills: { ...FILLS, theirs: false, theirs_open: 'TE' },
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'yours no one to drop',
		myGain: 2.1,
		theirGain: 0.8,
		fills: { ...FILLS, yours_room: false },
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	{
		name: 'theirs no one to drop',
		myGain: 2.1,
		theirGain: 0.8,
		fills: { ...FILLS, theirs_room: false },
		keepDrop: false,
		dropReason: null,
		perGame: true
	},
	// Lane 277: a side that would not take it on its rest of season, the answer's sentence in place of
	// the gains, its cell tagged; an older answer with neither field.
	{
		name: 'they would not take it',
		myGain: 1.4,
		theirGain: 1.8,
		fills: FILLS,
		keepDrop: true,
		dropReason: null,
		perGame: true,
		acceptable: { yours: true, theirs: false },
		rest: { yours: 21.6, theirs: -21.6 }
	},
	{
		name: 'you would not take it',
		myGain: 0.6,
		theirGain: 2.4,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: true,
		acceptable: { yours: false, theirs: true },
		rest: { yours: -14.2, theirs: 14.2 }
	},
	{
		name: 'neither would take it',
		myGain: 0.6,
		theirGain: 0.4,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: false,
		acceptable: { yours: false, theirs: false },
		rest: { yours: -12.5, theirs: -11.4 }
	},
	{
		name: 'they would not take it, yours would not fill RB2',
		myGain: 2.1,
		theirGain: 0.8,
		fills: { ...FILLS, yours: false, yours_open: 'RB2' },
		keepDrop: false,
		dropReason: null,
		perGame: true,
		acceptable: { yours: true, theirs: false },
		rest: { yours: 30, theirs: -30 }
	},
	{
		name: 'both take it within the limit',
		myGain: 2.1,
		theirGain: 0.8,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: true,
		acceptable: { yours: true, theirs: true },
		rest: { yours: 5, theirs: -5 }
	},
	{
		name: 'an older answer',
		myGain: 2.1,
		theirGain: 0.8,
		fills: FILLS,
		keepDrop: false,
		dropReason: null,
		perGame: true,
		acceptable: null,
		rest: null
	}
];

/** A check with an edit applied. */
export function editedCheck(check: TradeCheck, edit: CheckEdit): TradeCheck {
	const figured = (line: PlayerLine): PlayerLine =>
		edit.perGame ? line : { ...line, rest_of_season_per_game: null };
	const { acceptable: _acceptable, rest_of_season_basis: _restBasis, ...older } = check;
	const { my_rest_of_season: _mine, their_rest_of_season: _theirs, ...olderTrade } = check.trade;
	const base = edit.acceptable === null ? older : check;
	const acceptable =
		edit.acceptable === undefined || edit.acceptable === null
			? {}
			: { acceptable: edit.acceptable };
	const rest =
		edit.rest === undefined || edit.rest === null
			? {}
			: {
					my_rest_of_season: edit.rest.yours,
					their_rest_of_season: edit.rest.theirs
				};
	return {
		...base,
		...acceptable,
		fills: edit.fills,
		trade: {
			...(edit.rest === null ? olderTrade : check.trade),
			...rest,
			my_gain: edit.myGain,
			their_gain: edit.theirGain,
			drop: edit.keepDrop ? check.trade.drop : null,
			drop_reason: edit.dropReason,
			give: check.trade.give.map(figured),
			get: check.trade.get.map(figured)
		}
	};
}

/** Every built sentence a function makes that the fixtures alone do not reach: each checkWords branch
 * over the fixture's check, the decision with no trade, the strip's title at each count, a player
 * whom no trade holds, and the builder's prompt as the picks fill. */
export function wordCases(check: TradeCheck): unknown {
	const picks = (give: number, get: number): Picks => ({
		team: 1,
		give: Array.from({ length: give }, (_, i) => `g${String(i)}`),
		get: Array.from({ length: get }, (_, i) => `t${String(i)}`)
	});
	return {
		checks: CHECK_EDITS.map((edit) => {
			const edited = editedCheck(check, edit);
			return {
				...edit,
				// The edited check's own: the fixture's where the edit keeps them, none for an older answer.
				acceptable: edited.acceptable ?? null,
				rest:
					edited.trade.my_rest_of_season === undefined ||
					edited.trade.their_rest_of_season === undefined
						? null
						: {
								yours: edited.trade.my_rest_of_season,
								theirs: edited.trade.their_rest_of_season
							},
				sentence: checkWords(edited),
				cells: {
					yours: restFigure(edited, 'yours'),
					theirs: restFigure(edited, 'theirs')
				},
				refusal: refusalWords(edited.acceptable)
			};
		}),
		noTrade: tradeDecision(null),
		// A gain under what a page shows (words.ts gainAmount), said as under 0.1.
		under: tradeDecision({
			row: { ...check.trade, my_gain: 0.04, their_gain: 0.6, drop: null },
			team: 'Max_Jensen10'
		}),
		titles: [0, 1, 2, 3].map((count) => ({ count, title: worthTitle(count) })),
		noTradeWith: noTradeWith('Josh Downs'),
		prompts: [
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1]
		].map(([give = 0, get = 0]) => ({
			give,
			get,
			prompt: pickPrompt(picks(give, get))
		}))
	};
}

/** The Trades holding picker as TradeScreen reads it: its two groups (your roster, their players the
 * trades found), and the finder narrowed to one player from the API's narrowed answer, each team's
 * trades holding him, with the decision; a player no trade holds says so. */
export function holdingAt(
	advice: TradeAdvice,
	narrowed: TradeAdvice,
	player: string,
	me: string,
	clock: string,
	zone: string
): unknown {
	const now = Date.parse(clock);
	const players = pickerPlayers(advice.roster, advice.teams);
	const option = (line: PlayerLine) => ({
		key: pickKey(line),
		name: line.player.name
	});
	const shown = heldTrades(narrowed, now);
	const holds = (row: (typeof shown.teams)[number]['trades'][number]): boolean =>
		[...row.give, ...row.get].some((line) => line.player.board_id === player);
	const teams = shown.teams.map((team) => ({
		...team,
		trades: team.trades.filter(holds)
	}));
	const worth = worthProposing(heldTrades(advice, now).teams);
	const name =
		[...players.yours, ...players.theirs].find((l) => pickKey(l) === player)?.player.name ?? '';
	const none = !tradeHolding(shown.teams, player);
	const unheld = advice.roster.find((line) => !tradeHolding(advice.teams, pickKey(line)));
	return {
		yours: players.yours.map(option),
		theirs: players.theirs.map(option),
		player,
		decision: none
			? noTradeWith(name)
			: tradeDecision(worth[0] ? { row: worth[0].row, team: worth[0].team.name } : null),
		rows: sortRows(finderRows(teams, false), 'mine').map((entry) => rowOf(entry, me, zone, now)),
		every: sortRows(finderRows(teams, true), 'mine').map((entry) => rowOf(entry, me, zone, now)),
		unheld:
			unheld === undefined
				? null
				: { key: pickKey(unheld), decision: noTradeWith(unheld.player.name) }
	};
}

/** One roster row of the builder as the phone draws it (TradeBox: BoxLine compact with evidence and
 * season, no Opp rank on the phone's line): the box's cells, his points a game, the phone's line and
 * his tick. */
function rosterRow(line: PlayerLine, pick: string, zone: string, now: number) {
	const row = boxRow(line, '', zone, false, now);
	return {
		...cells(null, row, null),
		season: boxNumber(row.evidence.season),
		line: `${BOX.avg} ${boxNumber(row.evidence.avg)}, ${BOX.last} ${boxNumber(row.evidence.last)}`,
		pick
	};
}

/** The builder opened from the strip's best trade (Build from this) as TradeBuilder draws it at 390
 * once its check is answered: the team picker's choices, the answer line, the close call's chip, the
 * builder's own line, both rosters in the builder's order with each row's tick, what each side holds,
 * and the pinned gains. */
export function builderAt(
	advice: TradeAdvice,
	answer: TradeCheck,
	me: string,
	clock: string,
	zone: string
): unknown {
	const now = Date.parse(clock);
	const shown = heldTrades(advice, now);
	const entry = worthProposing(shown.teams)[0];
	if (entry === undefined) throw new Error('The fixture has no strip trade to build from.');
	const picks = builtFrom(entry.team, entry.row);
	if (picks === null) throw new Error('The strip trade has a player with no host id.');
	const check = heldCheck(answer, now);
	const dropId = check.trade.drop?.player.host_id ?? null;
	const tick =
		(side: 'give' | 'get') =>
		(line: PlayerLine): string => {
			const id = line.player.host_id;
			const on = picks[side].includes(id);
			if (side === 'give' && id === dropId) return 'drop';
			if (!pickable(line)) return 'no';
			if (on) return 'on';
			return picks[side].length >= MAX_A_SIDE ? 'off-full' : 'off';
		};
	const holds = (side: 'give' | 'get'): string =>
		picks[side].length >= MAX_A_SIDE
			? BUILDER_LINES.full
			: `${side === 'give' ? BUILDER_LINES.give : BUILDER_LINES.get} ${String(picks[side].length)}`;
	const { fills, trade } = check;
	const close =
		fills.yours && fills.theirs && fills.yours_room && fills.theirs_room && trade.my_gain > 0
			? trade.close_for_them && trade.their_gain > 0
			: false;
	return {
		clock,
		picks,
		teams: shown.teams.map((team) => ({
			rosterId: team.roster_id,
			choice: teamChoice(team)
		})),
		sentence: checkWords(check),
		close: close ? CLOSE_FOR_THEM : null,
		own: check.basis,
		yours: {
			team: me,
			holds: holds('give'),
			rows: rosterOrder(shown.roster).map((line) => rosterRow(line, tick('give')(line), zone, now))
		},
		theirs: {
			team: entry.team.name,
			aside: teamAside(entry.team),
			holds: holds('get'),
			rows: rosterOrder(entry.team.roster).map((line) =>
				rosterRow(line, tick('get')(line), zone, now)
			)
		},
		pin: `${gainWord(trade.my_gain)} ${TRADES.aWeekForYou}, ${gainWord(trade.their_gain)} ${TRADES.forTheirs}`,
		restBasis: check.rest_of_season_basis ?? null,
		rest: {
			yours: restFigure(check, 'yours'),
			theirs: restFigure(check, 'theirs')
		}
	};
}
