// The week's order and a lineup's two totals, as the fixture stands in for the API's engine:
// project.ts advises the lineup and stamps each trade's change in this week's Proj with it, and
// serve.ts answers the trade builder's totals with it (Lane 66g). The API's own engine replaces all
// of it (engine.go weekKeys, trades.go WeekProj and the filler's strength); only the rules are meant
// to hold.
import { lastName } from '../../src/lib/format/draft.ts';
import type { LineupSlot, PlayerLine } from '../../src/lib/league/inseason/api.ts';

const TENTH = 10;

/** The last week the rest-of-season order covers (the API's LastFantasyWeek). */
export const LAST_FANTASY_WEEK = 17;
/** The last week any league's order values (horizon.go MaxWeek). */
const LAST_REGULAR_WEEK = 18;

/** The last week a league's order values and its championship's weeks (the API's horizon.go
 * Horizon, Lane 96): its platform's last playoff week, the run's week 17 when it states none. */
export interface Horizon {
	last: number;
	/** 2 for a two-week final, else 1, 0 when the platform does not say. */
	finalWeeks: number;
}

/** The run's own horizon (horizon.go StandardHorizon). */
export const STANDARD_HORIZON: Horizon = { last: LAST_FANTASY_WEEK, finalWeeks: 0 };

const TWO_WEEK_FINAL = 2;

/** The horizon a shot names (FIXTURE_TITLE_WEEK="18:2", the last week and the final's weeks), the
 * run's without one: the recorded league's playoffs end in week 17. */
export function titleWeekHorizon(spec: string | undefined): Horizon {
	if (spec === undefined || spec === '') return STANDARD_HORIZON;
	const match = /^(\d{1,2}):([12])$/.exec(spec);
	const last = Number(match?.[1]);
	if (match === null || last < 1 || last > LAST_REGULAR_WEEK) {
		throw new Error(`FIXTURE_TITLE_WEEK "${spec}" is not "<last week>:<final weeks>", as "18:2".`);
	}
	return { last, finalWeeks: Number(match[2]) };
}

/** ", the championship over weeks 17 and 18" once a two-week final sits inside the span from
 * `from` (horizon.go finalWords), else nothing. */
export function finalWords(h: Horizon, from: number): string {
	if (h.finalWeeks !== TWO_WEEK_FINAL || h.last - 1 < from) return '';
	return `, the championship over weeks ${String(h.last - 1)} and ${String(h.last)}`;
}

/** " Week 18 counts at each player's rate a game. Our model runs through week 17." where the span runs past
 * the run's last week from a week the model counts (horizon.go rateWords), else nothing. */
export function rateWords(h: Horizon, from: number): string {
	if (h.last <= LAST_FANTASY_WEEK || from > LAST_FANTASY_WEEK) return '';
	const weeks =
		h.last - LAST_FANTASY_WEEK > 1
			? `Weeks ${String(LAST_FANTASY_WEEK + 1)} to ${String(h.last)} count`
			: `Week ${String(h.last)} counts`;
	return ` ${weeks} at each player's rate a game. Our model runs through week ${String(LAST_FANTASY_WEEK)}.`;
}

/** The weeks the rest-of-season order covers from a week through the horizon: a week's figure is
 * over them. */
export const weeksCovered = (week: number, h: Horizon): number => Math.max(1, h.last - week + 1);

/** The first week a span of weeks through the horizon covers. */
const spanFrom = (weeks: number, h: Horizon): number => h.last - Math.max(1, weeks) + 1;

/** The weeks by number, in the API's words (words.go weekSpan). */
export function weekSpan(weeks: number, h: Horizon): string {
	const from = spanFrom(weeks, h);
	return from === h.last
		? `week ${String(h.last)}`
		: `weeks ${String(from)} to ${String(h.last)}${finalWords(h, from)}`;
}

/** What a Gain is, in the API's words (words.go gainWords). */
export function gainWords(whose: string, weeks: number, h: Horizon): string {
	return `Gain is ${whose} change in points over replacement a week, ${weekSpan(weeks, h)}.${rateWords(h, spanFrom(weeks, h))}`;
}

/** The least gain a week a trade of the member's top player at his position must bring (trades.go
 * KeepGain, Lane 103). */
export const KEEP_GAIN = 1;

/** The finder's footer and the line under its Gain head in the API's words (words.go TradesBasis,
 * TradeGainBasis), the one copy build.ts, project.ts and waivers-at.ts write. */
export function tradesBases(weeks: number, h: Horizon): { basis: string; gain_basis: string } {
	return {
		basis: `Each team's best trades, those for your weakest starting spot first. Every one fills a weak spot on one side or both, and neither lineup loses by it. The other team decides. A player we rank first at his position goes only for ${KEEP_GAIN.toFixed(1)} a week or more, or to fill a spot.${rateWords(h, spanFrom(weeks, h))}`,
		gain_basis: `points over replacement in each lineup week by week, byes counted, ${weekSpan(weeks, h)}`
	};
}

/** A slot as the API's lineup rows label it (words.go SlotLabel): "QB", "RB2", "Flex 1". */
export function slotLabel(slots: readonly LineupSlot['slot'][], at: number): string {
	const slot = slots[at] ?? '';
	const name = slot === 'FLEX' ? 'Flex' : slot;
	if (slots.filter((s) => s === slot).length < 2) return name;
	const index = slots.slice(0, at).filter((s) => s === slot).length + 1;
	return slot === 'FLEX' ? `${name} ${String(index)}` : `${name}${String(index)}`;
}

/** The need a trade fills in the API's words (words.go TradeNeedWords, Lane 103): the empty spot, and
 * the player it sends out who sits on bye that week when there is one. */
export function tradeNeedWords(slot: string, onBye: PlayerLine | null): string {
	return onBye === null
		? `Fills your empty ${slot} this week.`
		: `Fills your empty ${slot} while ${lastName(onBye.player.name)} sits on bye.`;
}

/** The figure a game in the API's words (pergame.go PerGameBasis). */
export const PER_GAME_BASIS = "A game is our order's points a game.";

/** The Waivers screen's Gain then the figure a game (words.go WaiverSeasonBasis, withPerGame). */
export function waiverSeasonBasis(weeks: number, h: Horizon): string {
	return `${gainWords("your lineup's", weeks, h)} ${PER_GAME_BASIS}`;
}

/** The builder's own line in the API's words (words.go TradeCheckBasis). */
export const CHECK_BASIS = 'The scoreboard is each lineup before and after the trade.';

/** The Lineup's advice rule (words.go LineupBasis). */
export const LINEUP_BASIS =
	'We start the highest Proj at each slot after designations and byes, our order breaking ties.';

/** The Waivers pickup rule (words.go WaiversBasis). */
export const WAIVERS_BASIS = 'A pickup starts this week on Proj and keeps Gain at zero or better.';

/** Each rule's name in a basis sentence, by its Settings words (words.go countables, Lane 111). */
const RULE_NAMES: Readonly<Record<string, string>> = {
	'two-point conversions': 'two-point',
	'field goals of 40 yards or more': 'long field goal',
	'missed field goals': 'missed field goal',
	'missed extra points': 'missed extra point',
	"a player's kick and punt return touchdowns": 'return touchdown',
	'fumble recoveries': 'fumble recovery',
	safeties: 'safety',
	"a defense's points allowed": 'points allowed',
	"a defense's yards allowed": 'yards allowed'
};
const MISSED_KICKS = ['missed field goal', 'missed extra point'];

/** The rules' names as the API says them (words.go basisNames): both missed kicks as one. */
function basisNames(rules: readonly string[]): string[] {
	const names = rules.map((rule) => RULE_NAMES[rule] ?? rule);
	const kicks = names.filter((name) => MISSED_KICKS.includes(name)).length;
	if (kicks < 2) return names;
	return names.flatMap((name) =>
		name === MISSED_KICKS[0] ? ['missed kick'] : MISSED_KICKS.includes(name) ? [] : [name]
	);
}

/** "a", "a and b", "a, b and c". */
function andList(names: readonly string[]): string {
	if (names.length < 2) return names.join('');
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** The uncounted rules' sentence in the API's words (words.go uncountedOf, Lane 111): the rules named
 * inline. */
export function uncountedOf(rules: readonly string[]): { basis_note: string } {
	if (rules.length === 0) return { basis_note: '' };
	return { basis_note: `Our stats omit ${andList(basisNames(rules))}.` };
}

/** The API's sentence's rule names (words.go Uncounted.Names, Lane 115, B92): the words between
 * "Our stats omit " and the full stop. */
const NOTE_NAMES = /^Our stats omit (.+)\.$/;

/** An answer with the rules its basis_note names as the API now sends them beside it
 * (basis_note_list), for the stored answers written before Lane 115; an answer that names none, or
 * already carries them, as it is. */
export function withRuleList<T>(body: T): T {
	if (typeof body !== 'object' || body === null || !('basis_note' in body)) return body;
	if ('basis_note_list' in body) return body;
	const note = (body as { basis_note: unknown }).basis_note;
	if (typeof note !== 'string') return body;
	return { ...body, basis_note_list: NOTE_NAMES.exec(note)?.[1] ?? '' };
}

/** The recorded league's sentence (data/lineup.json uncounted_rules). */
const LEAGUE_RULES_SENTENCE = uncountedOf([
	'two-point conversions',
	'missed field goals',
	'missed extra points',
	'fumble recoveries',
	'safeties'
]).basis_note;

/** The recorded league's rules our stats omit, as both of the web's frames name them ("Our stats
 * omit ...", "Avg and Last are our stats, which omit ...", Lane 115, B92), for the shots scripts. */
export const LEAGUE_RULES_NOTE = NOTE_NAMES.exec(LEAGUE_RULES_SENTENCE)?.[1] ?? '';

/** A figure to the tenth a page prints. */
export const tenth = (value: number): number => Math.round(value * TENTH) / TENTH;

/** Who may start this week (engine.go weekKeys): a bye or a designation that keeps him off the
 * field last, doubtful before them. */
export const tierOf = (l: PlayerLine): number => {
	if (l.facts.bye || l.player.injured_reserve) return 2;
	const status = l.facts.designation?.status;
	if (status === undefined || status === 'questionable') return 0;
	return status === 'doubtful' ? 1 : 2;
};

export const printedProj = (l: PlayerLine): number | null =>
	l.week_projection === null ? null : tenth(l.week_projection);

/** The week's order: the tier, then the Proj as printed, a player with one first, then the
 * rest-of-season order. */
export function better(a: PlayerLine, b: PlayerLine): number {
	const tier = tierOf(a) - tierOf(b);
	if (tier !== 0) return tier;
	const pa = printedProj(a);
	const pb = printedProj(b);
	if ((pa === null) !== (pb === null)) return pa === null ? 1 : -1;
	if (pa !== null && pb !== null && pa !== pb) return pb - pa;
	const ra = a.position_rank ?? Number.MAX_SAFE_INTEGER;
	const rb = b.position_rank ?? Number.MAX_SAFE_INTEGER;
	if (ra !== rb) return ra - rb;
	return (b.points_over_replacement ?? 0) - (a.points_over_replacement ?? 0);
}

const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

export const accepts = (slot: LineupSlot['slot'], position: string): boolean =>
	slot === position || (slot === 'FLEX' && FLEX_POSITIONS.has(position));

/** The starters an order fills the slots with: each position's own slots first, then the flex. */
function fill(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][],
	order: (a: PlayerLine, b: PlayerLine) => number,
	may: (l: PlayerLine) => boolean
): PlayerLine[] {
	return fillSlots(lines, slots, order, may).filter((l): l is PlayerLine => l !== null);
}

/** The same fill by slot: who each slot takes, in the slots' order, null where nobody is left. */
function fillSlots(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][],
	order: (a: PlayerLine, b: PlayerLine) => number,
	may: (l: PlayerLine) => boolean
): (PlayerLine | null)[] {
	const sorted = [...lines].filter(may).sort(order);
	const out: (PlayerLine | null)[] = slots.map(() => null);
	const pick = (at: number): void => {
		const slot = slots[at];
		const best = sorted.find(
			(l) => !out.includes(l) && slot !== undefined && accepts(slot, l.player.position)
		);
		out[at] = best ?? null;
	};
	const at = slots.map((_, i) => i);
	at.filter((i) => slots[i] !== 'FLEX').forEach(pick);
	at.filter((i) => slots[i] === 'FLEX').forEach(pick);
	return out;
}

/** This week's lineup by slot (the Lineup's rule): who each slot starts, null where no one who can
 * play is left. */
export function weekSlots(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): (PlayerLine | null)[] {
	return fillSlots(lines, slots, better, (l) => tierOf(l) === 0);
}

/** This week's Proj total of the lineup the Lineup screen sets: only a player who can play starts,
 * a starter with no Proj adds none. */
export function lineupProj(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): number {
	const starters = weekStarters(lines, slots);
	return tenth(starters.reduce((sum, l) => sum + (printedProj(l) ?? 0), 0));
}

/** The lineup's strength on the rest-of-season order: its starters' points over replacement a week
 * summed, nobody's week counted, injured reserve left out. */
export function seasonStrength(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): number {
	const starters = seasonStarters(lines, slots);
	return tenth(starters.reduce((sum, l) => sum + (l.points_over_replacement ?? 0), 0));
}

/** The players the rest-of-season lineup strength starts: by points over replacement, injured
 * reserve left out. */
export function seasonStarters(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): PlayerLine[] {
	const por = (l: PlayerLine): number => l.points_over_replacement ?? Number.NEGATIVE_INFINITY;
	return fill(
		lines,
		slots,
		(a, b) => por(b) - por(a),
		(l) => !l.player.injured_reserve && l.facts.designation?.status !== 'injured_reserve'
	);
}

/** The starters this week's lineup sets: only a player who can play starts. */
export function weekStarters(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): PlayerLine[] {
	return fill(lines, slots, better, (l) => tierOf(l) === 0);
}
