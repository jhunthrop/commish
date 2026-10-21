// The Waivers rows' Beats and the adds the table lists, as the API answers them (Lane 98,
// api/internal/inseason waiver_beats.go): the move the strip offers names the player it drops, every
// other row the player his move takes out of the rest-of-season lineup the Gain is measured on (the
// fixture's stand-in: the starter with the least points over replacement at a slot he can fill, whom
// he tops, on a row that gains); a free agent on a season-long list or ruled out (a week's out
// carried over from a game already played aside) is not listed. FIXTURE_IR_DROP=1 stamps the
// fixture with the sense check's case (B34, B41): the strip's drop, Roschon Johnson, on injured
// reserve on the bench, and two free agents the table no longer lists, De'Von Achane on injured
// reserve and Tyquan Thornton ruled out.
import type { components } from '../../src/lib/api/types.ts';
import type { LineupAdvice, WaiverAdvice, WaiverRow } from '../../src/lib/league/inseason/api.ts';
import { addKey } from '../../src/lib/league/inseason/move.ts';
import { roundTenth } from './tenths.ts';
import { seasonStarters } from './week.ts';

type PlayerLine = components['schemas']['PlayerLine'];
type Beats = NonNullable<WaiverRow['beats']>;

/** The environment variable that stamps the sense check's case on the fixture. */
export const IR_DROP_VARIABLE = 'FIXTURE_IR_DROP';

/** The positions each starting slot takes (engine.go Slots). */
const ACCEPTS: Readonly<Record<string, readonly string[]>> = {
	QB: ['QB'],
	RB: ['RB'],
	WR: ['WR'],
	TE: ['TE'],
	FLEX: ['RB', 'WR', 'TE'],
	SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
	K: ['K'],
	DEF: ['DEF']
};

/** The season-long lists (waiver_beats.go seasonLongLists). */
const SEASON_LONG = new Set(['injured_reserve', 'pup', 'nfi']);

/** Whether the table lists a free agent (waiver_beats.go listedAdd). */
export function listedAdd(line: PlayerLine): boolean {
	const d = line.facts.designation;
	if (d === null) return true;
	if (SEASON_LONG.has(d.status)) return false;
	return d.status !== 'out' || d.carried_over === true;
}

/** Whom his move takes out of the season lineup (waivers.go replaced), on the fixture's figures. */
function displaced(row: WaiverRow, lineup: LineupAdvice, seasonOrder: boolean): Beats | null {
	const { add } = row;
	const figure = add.points_over_replacement;
	if (figure === null || roundTenth(row.gain) <= 0) return null;
	const below = lineup.slots
		.filter((s) => (ACCEPTS[s.slot] ?? []).includes(add.player.position))
		.map((s) => s.ours)
		.filter((l) => {
			const v = l.points_over_replacement;
			return v !== null && v < figure;
		})
		.sort((a, b) => (a.points_over_replacement ?? 0) - (b.points_over_replacement ?? 0));
	const low = below[0];
	if (low === undefined) return null;
	const proj = add.week_projection;
	const theirs = low.week_projection;
	return {
		host_id: low.player.host_id,
		name: low.player.name,
		starter: true,
		...byeOf(low),
		gain: seasonOrder || proj === null || theirs === null ? null : roundTenth(proj - theirs),
		open_spot: false
	};
}

/** The Beats cell's bye, sent only when he is on it (waiver_beats.go byeOf, Lane 108). */
function byeOf(line: PlayerLine): { bye?: true } {
	return line.facts.bye ? { bye: true } : {};
}

/** The offered move's Beats: the player it drops, labelled by his rest-of-season place (waiver_beats.go
 * dropBeats, Lane 108, B81). */
function dropBeats(row: WaiverRow, places: ReadonlySet<string>): WaiverRow['beats'] {
	const { drop } = row;
	if (drop === null) return row.beats;
	return {
		host_id: drop.player.host_id,
		name: drop.player.name,
		starter: places.has(drop.player.host_id),
		...byeOf(drop),
		gain: row.week_gain,
		open_spot: false
	};
}

/** The answer's Beats as the API restates them, each row's, the strip's moves naming their drops. */
export function restatedBeats(answer: WaiverAdvice, lineup: LineupAdvice): WaiverAdvice {
	const season = answer.pickup_order === 'season_gain';
	const cards = new Set(answer.pickups.map(addKey));
	// The rest-of-season lineup's starters, as the API's search reads them (seasonPlacesOf).
	const places = new Set(
		seasonStarters(
			answer.roster,
			lineup.slots.map((s) => s.slot)
		).map((l) => l.player.host_id)
	);
	const restate = (row: WaiverRow): WaiverRow => {
		if (cards.has(addKey(row))) return { ...row, beats: dropBeats(row, places) };
		return { ...row, beats: displaced(row, lineup, season) };
	};
	return { ...answer, rows: answer.rows.map(restate), pickups: answer.pickups.map(restate) };
}

/** The answer with the adds it does not list gone (pageMoves). */
export function listedOnly(answer: WaiverAdvice): WaiverAdvice {
	return { ...answer, rows: answer.rows.filter((r) => listedAdd(r.add)) };
}

/** The sense check's case on a fixture line: the strip's drop on injured reserve, two free agents on a
 * list the table does not show. */
const IR_SINCE = '2026-09-22T12:00:00.000Z';
const READ = '2026-10-16T21:00:00.000Z';
const STAMPED: Readonly<Record<string, PlayerLine['facts']['designation']>> = {
	'Roschon Johnson': { status: 'injured_reserve', as_of: READ, since: IR_SINCE },
	"De'Von Achane": { status: 'injured_reserve', as_of: READ, since: '2026-09-28T12:00:00.000Z' },
	'Tyquan Thornton': { status: 'out', as_of: READ, since: null }
};

/** A line with the case's designation, when the case names him. */
export function irDropLine(line: PlayerLine): PlayerLine {
	const designation = STAMPED[line.player.name];
	return designation === undefined ? line : { ...line, facts: { ...line.facts, designation } };
}

/** The waiver answer with the case stamped on every line it carries. */
export function irDropWaivers(answer: WaiverAdvice): WaiverAdvice {
	const row = (r: WaiverRow): WaiverRow => ({
		...r,
		add: irDropLine(r.add),
		drop: r.drop === null ? null : irDropLine(r.drop)
	});
	return {
		...answer,
		rows: answer.rows.map(row),
		pickups: answer.pickups.map(row),
		roster: answer.roster.map(irDropLine)
	};
}

/** The lineup answer with the case stamped on its bench. */
export function irDropLineup(lineup: LineupAdvice): LineupAdvice {
	return { ...lineup, bench: lineup.bench.map(irDropLine) };
}
