// The Waivers rows' Beats and the adds the table lists, as the API answers them (Lane 98,
// api/internal/inseason waiver_beats.go): the move the strip offers names the player it drops, every
// other row the player his move takes out of the rest-of-season lineup the Gain is measured on (the
// fixture's stand-in: the starter with the least points over replacement at a slot he can fill, whom
// he tops, on a row that gains); a free agent on a season-long list or ruled out (a week's out
// carried over from a game already played aside) is not listed. The strip's drop on injured reserve
// on the bench (B34) is the fixture's own since Lane 128: Jaxson Dart, on the capture the stand-in run
// is marked with. FIXTURE_IR_DROP=1 stamps the rest of the sense check's case (B41): two free agents
// the table no longer lists, De'Von Achane on injured reserve and Tyquan Thornton ruled out, each
// dated back (Lane 118, B79: weeks 9 and 8), so they sit in the Stash group; FIXTURE_IR_SLOT=1 opens one injured reserve slot on the member's team, so
// Achane's verb is Stash.
import type { components } from '../../src/lib/api/types.ts';
import type { LineupAdvice, WaiverAdvice, WaiverRow } from '../../src/lib/league/inseason/api.ts';
import { addKey } from '../../src/lib/league/inseason/move.ts';
import { roundTenth } from './tenths.ts';
import { seasonStarters } from './week.ts';

type PlayerLine = components['schemas']['PlayerLine'];
type Beats = NonNullable<WaiverRow['beats']>;

/** The environment variable that stamps the sense check's case on the fixture. */
export const IR_DROP_VARIABLE = 'FIXTURE_IR_DROP';
/** The environment variable that opens one injured reserve slot on the member's team (B79). */
export const IR_SLOT_VARIABLE = 'FIXTURE_IR_SLOT';

/** The environment variable that answers Waivers as for a league whose platform states neither its
 * playoffs' first week nor a playoff start (Lane 121, B99): a STAND-IN, the recorded Sleeper league
 * states both. */
export const SEASON_TAKEN_VARIABLE = 'FIXTURE_SEASON_TAKEN';

/** The recorded Sleeper league's last regular-season week: its playoffs start in week 15. */
const LAST_REGULAR_WEEK = 14;

/** The waiver answer as the API sends it for such a league: the regular season taken through week 14
 * (waiver_stash.go takenRegularLast), the recorded league's own last regular week, so its rows stand. */
export function seasonTakenWaivers(answer: WaiverAdvice): WaiverAdvice {
	return { ...answer, regular_season_taken: LAST_REGULAR_WEEK };
}

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

/** Whether the table lists a free agent (waiver_stash.go listedAdd; a pending dating is never on the
 * wire, so the stand-in has none). */
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

/** A free agent the table leaves out whom the Stash group can hold (waiver_stash.go returnHeld). */
function returnHeld(line: PlayerLine): boolean {
	const status = line.facts.designation?.status;
	return !listedAdd(line) && (status === 'injured_reserve' || status === 'out');
}

/** One stash (waiver_stash.go stashRow): no week figure and no Beats, his rate the figure his player
 * page shows, the drop the gaining rows' rule names (the stand-in's member has no bench spot open). */
function stashRow(row: WaiverRow, back: number, irSlot: boolean): WaiverRow {
	const slot = irSlot && row.add.facts.designation?.status === 'injured_reserve';
	return {
		...row,
		week_gain: null,
		pickup: false,
		starts: false,
		beats: null,
		stash: { back_week: back, per_game: row.add.rest_of_season_per_game, ir_slot: slot }
	};
}

/** The answer with the adds it does not list gone (pageMoves), the ones due back in the regular season
 * in the Stash group by their rate a game, and the counts of those whose return no read dates or falls
 * after the regular season (waiver_stash.go stashRows). The stand-in dates no one back this week. */
export function listedOnly(answer: WaiverAdvice, irSlot = false): WaiverAdvice {
	const held = answer.rows.filter((r) => returnHeld(r.add));
	const stash = held
		.flatMap((r) => {
			const back = r.add.facts.designation?.return_week ?? null;
			return back === null || back > LAST_REGULAR_WEEK ? [] : [stashRow(r, back, irSlot)];
		})
		.sort((a, b) => (b.stash?.per_game ?? -Infinity) - (a.stash?.per_game ?? -Infinity));
	return {
		...answer,
		rows: answer.rows.filter((r) => listedAdd(r.add)),
		stash,
		stash_undated: held.filter((r) => (r.add.facts.designation?.return_week ?? null) === null)
			.length,
		stash_late: held.filter((r) => (r.add.facts.designation?.return_week ?? 0) > LAST_REGULAR_WEEK)
			.length
	};
}

/** The sense check's case on a fixture line: two free agents on a list the table does not show, each
 * dated back (the strip's IR drop is the fixture's own, Dart on the capture). */
const READ = '2026-10-16T21:00:00.000Z';
const STAMPED: Readonly<Record<string, PlayerLine['facts']['designation']>> = {
	"De'Von Achane": {
		status: 'injured_reserve',
		as_of: READ,
		since: '2026-09-28T12:00:00.000Z',
		return_week: 9
	},
	'Tyquan Thornton': { status: 'out', as_of: READ, since: null, return_week: 8 }
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
