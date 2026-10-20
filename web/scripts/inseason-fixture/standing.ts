// The fixture's stand-ins for the Matchup's standing line and the Lineup's miss line (Lane 99), as the
// API words them (inseason standing.go, miss.go, words.go StandingWords, ResultWords, MissWords), so
// the shots draw what the API sends at the fixture's clock.
import type { LineupAdvice, LineupSlot, PlayerLine } from '../../src/lib/league/inseason/api.ts';
import { kickedOffAt, sitsOut } from './scoreboard-at.ts';
import { roundTenth } from './tenths.ts';

/** How a moment reads a starter's game: final by its rule, kicked off once its kickoff has passed. */
export interface StandingMoment {
	now: number;
	final: (line: PlayerLine) => boolean;
}

/** How many starters a standing names before it counts them (words.go namedAtMost). */
const NAMED_AT_MOST = 3;

/** A name's second mention (words.go secondMention): the last name, a defense by its club. */
function secondMention(name: string): string {
	const words = name
		.replace(/\s+D\/ST$/, '')
		.trim()
		.split(/\s+/);
	const last = words.at(-1) ?? name;
	return /^(jr|sr|ii|iii|iv|v)\.?$/i.test(last) && words.length > 1 ? (words.at(-2) ?? last) : last;
}

interface Left {
	playing: string[];
	coming: string[];
}

/** A side's starters who can still score (standing.go leftOf). */
function leftOf(lines: readonly PlayerLine[], moment: StandingMoment): Left {
	const out: Left = { playing: [], coming: [] };
	for (const line of lines) {
		if (line.facts.bye || line.facts.kickoff === null || moment.final(line)) continue;
		const name = secondMention(line.player.name);
		if (!kickedOffAt(line, moment.now)) out.coming.push(name);
		else if (!sitsOut(line)) out.playing.push(name);
	}
	return out;
}

const count = (s: Left): number => s.playing.length + s.coming.length;
const tenth = (n: number): string => roundTenth(n).toFixed(1);

function joinNames(names: readonly string[]): string {
	if (names.length < 2) return names.join('');
	return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

function leftWords(s: Left): string {
	if (count(s) > NAMED_AT_MOST) return `${String(count(s))} to play`;
	return [
		...(s.playing.length > 0 ? [`${joinNames(s.playing)} playing`] : []),
		...(s.coming.length > 0 ? [`${joinNames(s.coming)} to play`] : [])
	].join(' and ');
}

function leadWords(margin: number): string {
	if (margin > 0) return `Up ${tenth(margin)}`;
	if (margin < 0) return `Down ${tenth(-margin)}`;
	return 'Tied';
}

function resultWords(margin: number): string {
	if (margin > 0) return `Won by ${tenth(margin)}`;
	if (margin < 0) return `Lost by ${tenth(-margin)}`;
	return 'Tied';
}

/** A side as the standing reads it: its score so far and its starters' lines. */
export interface StandingSide {
	points: number | null;
	lines: readonly PlayerLine[];
}

/** The matchup answer's standing and decided (standing.go standingOf): nothing before the first
 * kickoff, without both scores or both lineups; the margin and who is left while it plays; the result
 * once every starter is done. */
export function standingOf(
	sides: readonly StandingSide[],
	moment: StandingMoment
): { standing: string; decided: boolean } | null {
	const [mine, theirs] = sides;
	if (mine === undefined || theirs === undefined || sides.length !== 2) return null;
	if (mine.points === null || theirs.points === null) return null;
	if (mine.lines.length === 0 || theirs.lines.length === 0) return null;
	const all = [...mine.lines, ...theirs.lines].filter((l) => !l.facts.bye && l.facts.kickoff);
	if (!all.some((l) => kickedOffAt(l, moment.now))) return null;
	const margin = roundTenth(mine.points - theirs.points);
	const ours = leftOf(mine.lines, moment);
	const others = leftOf(theirs.lines, moment);
	if (count(ours) === 0 && count(others) === 0)
		return { standing: resultWords(margin), decided: false };
	const lead = leadWords(margin);
	const decided = (margin < 0 && count(ours) === 0) || (margin > 0 && count(others) === 0);
	if (count(ours) === 0)
		return { standing: `${lead} with nobody left, ${leftWords(others)} for them`, decided };
	if (count(others) === 0)
		return { standing: `${lead}, they have nobody left, ${leftWords(ours)} for you`, decided };
	return {
		standing: `${lead}, ${String(count(ours))} of yours and ${String(count(others))} of theirs to play`,
		decided
	};
}

/** The slot as the miss line names it (words.go missSlot). */
const MISS_SLOT: Readonly<Record<LineupSlot['slot'], string>> = {
	QB: 'QB',
	RB: 'RB',
	WR: 'WR',
	TE: 'TE',
	FLEX: 'Flex',
	SUPERFLEX: 'Superflex',
	K: 'K',
	DEF: 'D/ST'
};

const MARKS: Readonly<Record<string, string>> = {
	questionable: 'Questionable',
	doubtful: 'Doubtful',
	out: 'Out',
	suspended: 'Suspended',
	injured_reserve: 'on injured reserve',
	pup: 'on the PUP list',
	nfi: 'on the NFI list'
};

const verbOf = (line: PlayerLine, moment: StandingMoment): string =>
	moment.final(line) ? 'scored' : 'has';

/** The Lineup's miss line (miss.go missedLine) from our pick with no player held, its lines at the
 * moment with their points: each differing slot once both players have kicked off, then once every
 * starter of both lineups is final what our lineup would have scored. */
export function missedOf(pick: LineupAdvice, moment: StandingMoment): string | null {
	const misses: string[] = [];
	let ours = 0;
	let final = true;
	const over = (l: PlayerLine): boolean =>
		l.facts.bye || l.facts.kickoff === null || moment.final(l);
	for (const slot of pick.slots) {
		ours += slot.ours.facts.points_this_week ?? 0;
		final = final && over(slot.ours) && (slot.host === null || over(slot.host));
		if (!slot.changed || slot.no_one_can_play || !kickedOffAt(slot.ours, moment.now)) continue;
		const name = MISS_SLOT[slot.slot];
		const scored = slot.ours.facts.points_this_week;
		if (scored === null) return null;
		const half = `${slot.ours.player.name} ${verbOf(slot.ours, moment)} ${tenth(scored)} on your bench`;
		const set = slot.host;
		if (set === null) {
			misses.push(`Your ${name} was empty while ${half}.`);
			continue;
		}
		if (set.facts.bye) {
			misses.push(`${set.player.name} was on bye in your ${name} while ${half}.`);
			continue;
		}
		if (!kickedOffAt(set, moment.now)) continue;
		const pts = set.facts.points_this_week;
		if (pts === null) return null;
		const status = set.facts.designation?.status;
		const who =
			status === undefined ? set.player.name : `${set.player.name}, ${MARKS[status] ?? ''},`;
		misses.push(`${who} ${verbOf(set, moment)} ${tenth(pts)} in your ${name} while ${half}.`);
	}
	if (misses.length === 0) return null;
	const total = final ? [`Our lineup would have scored ${tenth(ours)}.`] : [];
	return [...misses, ...total].join(' ');
}
