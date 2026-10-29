/** The in-season screens' words (spec §4 to §6): each screen's decision line, its one verb with the
 * host as the mechanism, and a player row's facts for this week. Pure functions over the API's
 * answers, so every sentence a screen prints is tested here. */
import { fixed, plural, signed } from '#lib/format/number.ts';
import { listWords } from '#lib/format/list.ts';
import { monthDayLabel } from '#lib/format/date.ts';
import { memberZone, weekdayTime } from '#lib/format/clock.ts';
import { DESIGNATION_WORDS, sitsHim } from '#lib/format/designation.ts';
import { POINTS_PER_GAME_DECIMALS } from '#lib/run/decimals.ts';
import type { LeagueHost } from '../api.ts';
import { recordWords } from '../model.ts';
import { hostWords } from '../names.ts';
import type {
	GamePoints,
	InjuryDesignation,
	LineupAdvice,
	LineupSlot,
	OrderBasis,
	PlayerLine,
	TradeRow,
	TradeTeam,
	WeekFacts
} from './api.ts';

import type { InSeasonScreen, LeagueScreen } from './screens.ts';

export type { InSeasonScreen, LeagueScreen } from './screens.ts';

/** How a gain and a points-over-replacement figure print: one decimal. */
export const GAIN_DECIMALS = 1;
/** A last game's points print to one decimal, as the matchup's do. */
const GAME_DECIMALS = 1;

/** Each screen's one verb, the host named as where it happens: "Set it on Sleeper". */
export function verbWords(screen: InSeasonScreen, host: LeagueHost): string {
	const where = hostWords(host);
	const verbs: Readonly<Record<InSeasonScreen, string>> = {
		start: `Set it on ${where}`,
		waivers: `Claim on ${where}`,
		trades: `Propose on ${where}`
	};
	return verbs[screen];
}

/** A lineup slot as a row labels it. */
const SLOT_NAMES: Readonly<Record<LineupSlot['slot'], string>> = {
	QB: 'QB',
	RB: 'RB',
	WR: 'WR',
	TE: 'TE',
	FLEX: 'Flex',
	SUPERFLEX: 'Superflex',
	K: 'K',
	DEF: 'DEF'
};

/** Every slot's label, numbered where the lineup has more than one alike: "QB", "RB1", "RB2",
 * "Flex 1". */
export function slotLabels(slots: readonly LineupSlot['slot'][]): string[] {
	const counts = Map.groupBy(slots, (slot) => slot);
	const seen = new Map<string, number>();
	return slots.map((slot) => {
		const n = (seen.get(slot) ?? 0) + 1;
		seen.set(slot, n);
		const name = SLOT_NAMES[slot];
		if ((counts.get(slot)?.length ?? 0) < 2) return name;
		return name.length > 3 ? `${name} ${String(n)}` : `${name}${String(n)}`;
	});
}

/** Where a change goes in a sentence: "at RB2", "in the flex". */
function slotPlace(label: string): string {
	return /flex/i.test(label) ? `in the ${label.replace(/ \d+$/, '').toLowerCase()}` : `at ${label}`;
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** "Two changes", "One change", "12 changes". */
function changeCount(n: number): string {
	const word = NUMBER_WORDS[n] ?? String(n);
	return `${word} ${n === 1 ? 'change' : 'changes'}`;
}

/** The host's starters our lineup sits, by host id: the bench marks them. A changed slot's host
 * player is the starter we sit for it. */
export function satIds(slots: readonly LineupSlot[]): ReadonlySet<string> {
	return new Set(slots.flatMap((s) => (s.changed && s.host ? [s.host.player.host_id] : [])));
}

/** One start as its clause: "start Rachaad White over Tank Bigsby at RB2". */
function startClause(slot: LineupSlot, label: string): string {
	const over = slot.host ? ` over ${slot.host.player.name}` : '';
	return `start ${slot.ours.player.name}${over} ${slotPlace(label)}`;
}

/** The start screen's decision: "Two changes: start Rachaad White over Tank Bigsby at RB2, start
 * Jauan Jennings over Josh Downs in the flex.", "Four changes, starting with Patrick Mahomes over
 * Aaron Rodgers at QB." or "Your lineup is set." */
export function lineupDecision(advice: Pick<LineupAdvice, 'set' | 'slots'>): string {
	const labels = slotLabels(advice.slots.map((s) => s.slot));
	const changes = advice.slots.flatMap((slot, i) =>
		slot.changed ? [startClause(slot, labels[i] ?? slot.slot)] : []
	);
	if (advice.set || changes.length === 0) return 'Your lineup is set.';
	if (changes.length > NAMED_CHANGES) {
		const first = changes[0]?.replace(/^start /, '') ?? '';
		return `${changeCount(changes.length)}, starting with ${first}.`;
	}
	return `${changeCount(changes.length)}: ${changes.join(', ')}.`;
}

/** How many changes the decision names one by one; above it, it names the count and the first, and
 * the rows carry the rest. */
const NAMED_CHANGES = 2;

/** The smallest gain one decimal can show: a smaller one is said as under it, never as 0.0. */
const LEAST_SHOWN = 0.1;

/** A gain in a sentence: "1.2", or "under 0.1" for a gain too small to print, which is still a
 * gain. */
export function gainAmount(gain: number): string {
	return gain > 0 && gain < LEAST_SHOWN / 2
		? `under ${fixed(LEAST_SHOWN, GAIN_DECIMALS)}`
		: fixed(gain, GAIN_DECIMALS);
}

/** A gain a week, signed: "+1.2". */
export function gainFigure(gain: number): string {
	return signed(gain, GAIN_DECIMALS);
}

/** A trade's two gains: "Your lineup gains 4.1 points over replacement a week, theirs 2.3." */
export function tradeGains(row: Pick<TradeRow, 'my_gain' | 'their_gain'>): string {
	return `Your lineup gains ${gainAmount(row.my_gain)} points over replacement a week, theirs ${gainAmount(row.their_gain)}.`;
}

/** The names on one side of a trade: "Kyren Williams and Jordan Mason". */
export function sideNames(side: readonly PlayerLine[]): string {
	return listWords(side.map((line) => line.player.name));
}

/** The trade screen's decision, for the best trade or the one the member marked: "Trade Kyren
 * Williams to Muttdogs for Nico Collins. Your lineup gains ...", naming the drop a trade that grows
 * a full roster makes: "..., and drop Jaxson Dart to make room." */
export function tradeDecision(trade: { row: TradeRow; team: string } | null): string {
	if (trade === null) return 'No trade we found helps both lineups.';
	const { row, team } = trade;
	const drop = row.drop ? `, and drop ${row.drop.player.name} to make room` : '';
	return `Trade ${sideNames(row.give)} to ${team} for ${sideNames(row.get)}${drop}. ${tradeGains(row)}`;
}

/** A trade where their lineup gains under half a point a week (spec §6.2). */
export const CLOSE_FOR_THEM = 'A close call for them';

/** The trade picker's first choice, every trade. */
export const EVERY_TRADE = 'Every trade';

/** A team's line under its name: its owner, in the case the host gives, and its record, "muttdog,
 * 5-0". A team named for its owner, or with none, says only its record. */
export function teamAside(team: Pick<TradeTeam, 'name' | 'owner' | 'record'>): string {
	const record = recordWords(team.record);
	const owner = team.owner.trim();
	const named = owner === '' || owner.toLowerCase() === team.name.trim().toLowerCase();
	return named ? record : `${owner}, ${record}`;
}

/** A player picked whom no trade found holds: "No trade we found includes Josh Downs." */
export function noTradeWith(name: string): string {
	return `No trade we found includes ${name}.`;
}

/** A player the drafter tags Hold on a sheet: never a drop, never given in a trade. */
export const HELD = 'Held';

/** A phone's two-line row folds a player's tags into one counted chip, "2 tags", where the game's
 * line has no room for each (Lane 209, review M2); one tag shows itself, and the chip's label names
 * them all. */
export function tagCountWords(count: number): string {
	return plural(count, 'tag');
}

/** The signed-out panel's title, naming the screen it is for. */
export function signInTitle(screen: LeagueScreen): string {
	return `Sign in to see your ${SCREEN_TITLES[screen].toLowerCase()}`;
}

/** What the order is, in the refreshed stamp: "Our rest-of-season order, refreshed October 14." */
export function refreshedWords(basis: OrderBasis, refreshed: string): string {
	const order = basis === 'rest_of_season' ? 'Our rest-of-season order' : 'Our preseason number';
	return `${order}, refreshed ${monthDayLabel(refreshed)}.`;
}

/** His game this week: "at BUF Sun 1:00 pm", "vs BUF ...", "Bye this week", "Played". */
export function gameWords(facts: WeekFacts, zone: string = memberZone()): string | null {
	if (facts.bye) return 'Bye this week';
	if (facts.opponent === null) return null;
	const side = facts.home === false ? 'at' : 'vs';
	const game = `${side} ${facts.opponent}`;
	if (facts.played) return `${game}, played`;
	return facts.kickoff === null ? game : `${game} ${weekdayTime(facts.kickoff, zone)}`;
}

/** "Questionable as of Thu 4:10 pm": the designation with when the report said so. Here, not in
 * format/designation.ts, which every page loads: only the league screens say it (Lane 284). */
export function designationWords(
	designation: InjuryDesignation,
	zone: string = memberZone()
): string {
	return `${DESIGNATION_WORDS[designation.status]} as of ${weekdayTime(designation.as_of, zone)}`;
}

/** Whether a designation keeps him out (out, injured reserve, suspended, PUP, NFI): drawn as a loss. */
export function designationSitsHim(designation: InjuryDesignation): boolean {
	return sitsHim(designation.status);
}

/** His last games as the API lists them, newest first, in the few characters a row has: "Last 3:
 * 9.0, 11.2, 18.4", "Last game: 18.4", null with none. */
export function lastGamesWords(games: readonly GamePoints[]): string | null {
	if (games.length === 0) return null;
	const points = games.map((game) => fixed(game.points, GAME_DECIMALS)).join(', ');
	return games.length === 1 ? `Last game: ${points}` : `Last ${String(games.length)}: ${points}`;
}

/** His rest-of-season or preseason rank at his position: "RB14", null when unranked. */
export function rankWords(line: Pick<PlayerLine, 'position_rank' | 'player'>): string | null {
	return line.position_rank === null
		? null
		: `${line.player.position}${String(line.position_rank)}`;
}

/** A points over replacement figure: signed, "+0.4", "−0.5", and "0.0" with no sign when it rounds
 * to nothing. */
export function porFigure(points: number): string {
	return fixed(Math.abs(points), GAIN_DECIMALS) === fixed(0, GAIN_DECIMALS)
		? fixed(0, GAIN_DECIMALS)
		: signed(points, GAIN_DECIMALS);
}

/** A row's own points over replacement a week, where the row ends on another number (a waiver's
 * gain to your lineup), said as his: "his −0.5 over repl a week". */
export function hisPorWords(points: number): string {
	return `his ${porFigure(points)} ${LINES.overRepl}`;
}

/** His rest-of-season points a game in the season figure's unit words: "18.4 a game". The basis
 * line says what the figure is. */
export function perGameWords(points: number): string {
	return `${fixed(points, POINTS_PER_GAME_DECIMALS)} ${LINES.aGame}`;
}

/** What a row ends on: his rest-of-season points a game, else his points over replacement a week,
 * else words. On a screen whose rows carry points a game, a row without them says "No projection",
 * so no replacement figure sits under the head "Points a game" with no basis of its own. */
export type RowEnd =
	| { kind: 'perGame'; value: number }
	| { kind: 'por'; value: number }
	| { kind: 'words'; words: string };

export function rowEnd(line: PlayerLine, screenCarriesPerGame: boolean): RowEnd {
	const perGame = line.rest_of_season_per_game;
	if (perGame !== null) return { kind: 'perGame', value: perGame };
	if (screenCarriesPerGame) return { kind: 'words', words: LINES.noProjection };
	const por = line.points_over_replacement;
	return por === null ? { kind: 'words', words: LINES.unranked } : { kind: 'por', value: por };
}

/** A followed league's screens by their rail words (spec 2026-10-16 §3), each its page's title. */
export const SCREEN_TITLES: Readonly<Record<LeagueScreen, string>> = {
	start: 'Lineup',
	matchup: 'Matchup',
	waivers: 'Waivers',
	trades: 'Trades'
};

/** Every other line the in-season pages print, in one place for the copy guard. */
export const LINES = {
	/** A row's number cell: a week, apart from the league page's season figure. */
	overRepl: 'over repl a week',
	unranked: 'Unranked',
	/** A row's end on a screen whose rows end on points a game, for a player without them. */
	noProjection: 'No projection',
	aWeek: 'a week',
	/** A row's rest-of-season points a game, in the unit words the league page's season figure uses. */
	aGame: 'a game',
	all: 'All',
	position: 'Position',
	waiverAdds: 'Waiver adds',
	orderRecord: 'How the order has done',
	/** The site's not-found, as the root error page says it (routes/+error.svelte). */
	notFoundBar: 'Page not found',
	notFound: 'Not found',
	notFoundLine: 'Nothing lives at this address.',
	toBoard: 'Go to the board',
	add: 'Add',
	chosen: 'Up top',
	sit: 'Sit',
	bench: 'Bench',
	ourCall: 'Our call',
	reading: 'Reading your league',
	noBench: 'Nobody on your bench',
	tradesHolding: 'Trades holding',
	yourPlayers: 'Your players',
	theirPlayers: 'Their players',
	signInLine: 'A league lives on your account. Following one is free.',
	signIn: 'Sign in',
	missingTitle: 'This league is not on your account',
	missingLine: 'Paste its link again to follow it.',
	follow: 'Follow a league',
	lastRead: 'Your league could not be read just now. The page shows the last read.',
	unreadable: 'Your league could not be read just now.',
	leaguesUnread: 'Your leagues could not be read just now. We try again in a minute.',
	narrowingUnread: 'These could not be read just now. The last read stands.'
} as const;

/** "Your lineup for week 6". */
export function lineupTitle(week: number): string {
	return `Your lineup for week ${String(week)}`;
}
