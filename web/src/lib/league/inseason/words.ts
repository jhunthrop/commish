/** The in-season screens' words (spec §4 to §6): each screen's decision line, its one verb with the
 * host as the mechanism, and a player row's facts for this week. Pure functions over the API's
 * answers, so every sentence a screen prints is tested here. */
import { fixed, signed } from '#lib/format/number.ts';
import { listWords } from '#lib/format/list.ts';
import { monthDayLabel } from '#lib/format/date.ts';
import type { LeagueHost } from '../api.ts';
import { recordWords } from '../model.ts';
import { hostWords } from '../names.ts';
import type {
	Designation,
	LastGame,
	LineupAdvice,
	LineupSlot,
	OrderBasis,
	PlayerLine,
	TradeRow,
	TradeTeam,
	WaiverRow,
	WeekFacts
} from './types.ts';

/** The three screens, by the decision each makes. */
export type InSeasonScreen = 'start' | 'waivers' | 'trades';

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

/** A host's lineup slot as a row labels it. The host's own word stands for a slot not named here. */
const SLOT_NAMES: Readonly<Record<string, string>> = {
	FLEX: 'Flex',
	SUPER_FLEX: 'Superflex',
	REC_FLEX: 'Flex',
	WRRB_FLEX: 'Flex',
	DEF: 'DEF',
	DST: 'DEF',
	IDP_FLEX: 'IDP flex'
};

/** Every slot's label, numbered where the lineup has more than one alike: "QB", "RB1", "RB2",
 * "Flex 1". */
export function slotLabels(slots: readonly string[]): string[] {
	const counts = Map.groupBy(slots, (slot) => slot);
	const seen = new Map<string, number>();
	return slots.map((slot) => {
		const n = (seen.get(slot) ?? 0) + 1;
		seen.set(slot, n);
		const name = SLOT_NAMES[slot] ?? slot;
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

/** What a changed slot is. A start puts in a player the host has not starting and sits one the
 * host has starting; a move takes a player the host already starts into another slot, to make
 * room for a start. */
export type SlotChange =
	{ kind: 'start'; start: PlayerLine; sit: PlayerLine | null } | { kind: 'move'; from: number };

/** Each slot's change, null where the slot stands. The player a start sits is the one the host
 * starts that ours does not: when the host's player in the slot moves to another slot, it is the
 * one he displaces there, and so on down the chain. */
export function slotChanges(slots: readonly LineupSlot[]): (SlotChange | null)[] {
	const ourSlot = new Map(slots.map((s, i) => [s.ours.player.host_id, i] as const));
	const hostSlot = new Map(
		slots.flatMap((s, i) => (s.host ? [[s.host.player.host_id, i] as const] : []))
	);
	return slots.map((slot, i): SlotChange | null => {
		if (!slot.changed) return null;
		const from = hostSlot.get(slot.ours.player.host_id);
		if (from !== undefined) return { kind: 'move', from };
		let sit = slot.host;
		const seen = new Set([i]);
		for (let at = ourSlot.get(sit?.player.host_id ?? ''); at !== undefined && !seen.has(at);) {
			seen.add(at);
			sit = slots[at]?.host ?? null;
			at = ourSlot.get(sit?.player.host_id ?? '');
		}
		return {
			kind: 'start',
			start: slot.ours,
			sit: sit && ourSlot.has(sit.player.host_id) ? null : sit
		};
	});
}

/** The host's starters our lineup sits, by host id: the bench marks them. */
export function satIds(slots: readonly LineupSlot[]): ReadonlySet<string> {
	return new Set(
		slotChanges(slots).flatMap((c) => (c?.kind === 'start' && c.sit ? [c.sit.player.host_id] : []))
	);
}

/** One start as its clause: "start Rachaad White over Tank Bigsby at RB2". */
function startClause(start: PlayerLine, sit: PlayerLine | null, label: string): string {
	const over = sit ? ` over ${sit.player.name}` : '';
	return `start ${start.player.name}${over} ${slotPlace(label)}`;
}

/** "Moves from the flex", "Moves from WR2": a starter the host has elsewhere, moved to make room. */
export function moveWords(fromLabel: string): string {
	return `Moves from ${/flex/i.test(fromLabel) ? 'the flex' : fromLabel}`;
}

/** The start screen's decision: "Two changes: start Rachaad White over Tank Bigsby at RB2, start
 * Jauan Jennings over Josh Downs in the flex." or "Your lineup is set." A move is not a change of
 * its own: it is how a start fits. */
export function lineupDecision(advice: Pick<LineupAdvice, 'set' | 'slots'>): string {
	const labels = slotLabels(advice.slots.map((s) => s.slot));
	const changes = slotChanges(advice.slots).flatMap((change, i) =>
		change?.kind === 'start'
			? [startClause(change.start, change.sit, labels[i] ?? advice.slots[i]?.slot ?? '')]
			: []
	);
	if (advice.set || changes.length === 0) return 'Your lineup is set.';
	return `${changeCount(changes.length)}: ${changes.join(', ')}.`;
}

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

/** The waiver screen's decision, for the best add or the one the member marked: "Add Bhayshul Tuten
 * for Jaylen Wright. Your lineup gains 1.2 points over replacement a week." */
export function waiverDecision(row: WaiverRow | null): string {
	if (row === null) return 'Nobody on waivers starts for you this week.';
	const drop = row.drop ? ` for ${row.drop.player.name}` : '';
	const gain =
		row.gain > 0
			? ` Your lineup gains ${gainAmount(row.gain)} points over replacement a week.`
			: ' He would not start for you this week.';
	return `Add ${row.add.player.name}${drop}.${gain}`;
}

/** Who a row's add replaces on the roster, with his rank: "for Jaylen Wright, RB58", "into an open
 * spot". */
export function dropWords(row: Pick<WaiverRow, 'drop'>): string {
	if (row.drop === null) return 'into an open spot';
	const rank = rankWords(row.drop);
	return `for ${row.drop.player.name}${rank === null ? '' : `, ${rank}`}`;
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
 * Williams to Muttdogs for Nico Collins. Your lineup gains ...". */
export function tradeDecision(trade: { row: TradeRow; team: string } | null): string {
	if (trade === null) return 'No trade we found helps both lineups.';
	const { row, team } = trade;
	return `Trade ${sideNames(row.give)} to ${team} for ${sideNames(row.get)}. ${tradeGains(row)}`;
}

/** A trade where their lineup gains under half a point a week (spec §6.2). */
export const CLOSE_FOR_THEM = 'A close call for them';

/** The trade picker's first choice, every trade. */
export const EVERY_TRADE = 'Every trade';

/** A team's head beside its name: its owner and record, "muttdog, 5-0". */
export function teamAside(team: Pick<TradeTeam, 'owner' | 'record'>): string {
	const record = recordWords(team.record);
	return team.owner === '' ? record : `${team.owner}, ${record}`;
}

/** What a team's trades are when the finder holds none for it. */
export const NO_TRADES_WITH_TEAM = 'No trade with this team helps both lineups.';

/** The line over the waiver adds that would not start (spec §5.2). */
export const NO_START_RULE = 'Nobody here starts for you this week';

/** What the order is, in the refreshed stamp: "Our rest-of-season order, refreshed October 14." */
export function refreshedWords(basis: OrderBasis, refreshed: string): string {
	const order = basis === 'rest_of_season' ? 'Our rest-of-season order' : 'Our preseason number';
	return `${order}, refreshed ${monthDayLabel(refreshed)}.`;
}

/** What "points over replacement" is, the first time a first-timer meets it. */
export const POINTS_OVER_REPLACEMENT =
	'Points over replacement are points above what a free pickup at his position gives you.';

const ZONE = 'America/New_York';
const WEEKDAY_TIME = new Intl.DateTimeFormat('en-US', {
	weekday: 'short',
	hour: 'numeric',
	minute: '2-digit',
	timeZone: ZONE
});

/** "Sun 1:00 pm ET": a kickoff or a stamp on the Eastern clock, the one the NFL keeps. */
export function weekdayTime(iso: string): string {
	const parts = WEEKDAY_TIME.formatToParts(new Date(iso));
	const part = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((p) => p.type === type)?.value ?? '';
	return `${part('weekday')} ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()} ET`;
}

/** His game this week: "at BUF Sun 1:00 pm ET", "vs BUF ...", "Bye this week", "Played". */
export function gameWords(facts: WeekFacts): string | null {
	if (facts.bye) return 'Bye this week';
	if (facts.opponent === null) return null;
	const side = facts.home === false ? 'at' : 'vs';
	const game = `${side} ${facts.opponent}`;
	if (facts.played) return `${game}, played`;
	return facts.kickoff === null ? game : `${game} ${weekdayTime(facts.kickoff)}`;
}

const DESIGNATION_WORDS: Readonly<Record<Designation['status'], string>> = {
	questionable: 'Questionable',
	doubtful: 'Doubtful',
	out: 'Out',
	injured_reserve: 'On injured reserve',
	suspended: 'Suspended',
	pup: 'On the PUP list',
	nfi: 'On the NFI list'
};

/** "Questionable as of Thu 4:10 pm ET": the designation with when the report said so. */
export function designationWords(designation: Designation): string {
	return `${DESIGNATION_WORDS[designation.status]} as of ${weekdayTime(designation.as_of)}`;
}

/** Whether a designation keeps him out (out, injured reserve, suspended, PUP, NFI): drawn as a loss. */
export function designationSitsHim(designation: Designation): boolean {
	return !['questionable', 'doubtful'].includes(designation.status);
}

const GAME_COUNT_WORDS = ['', 'game', 'two', 'three'];

/** His last games, newest last: "18.4, 11.2 and 9.0 in his last three", "18.4 in his last game",
 * null with none. */
export function lastGamesWords(games: readonly LastGame[]): string | null {
	if (games.length === 0) return null;
	const points = listWords(games.map((game) => fixed(game.points, GAME_DECIMALS)));
	const reach = GAME_COUNT_WORDS[games.length] ?? String(games.length);
	return `${points} in his last ${reach}`;
}

/** His rest-of-season or preseason rank at his position: "RB14", null when unranked. */
export function rankWords(line: Pick<PlayerLine, 'position_rank' | 'player'>): string | null {
	return line.position_rank === null
		? null
		: `${line.player.position}${String(line.position_rank)}`;
}
