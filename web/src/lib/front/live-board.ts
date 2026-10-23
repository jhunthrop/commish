/** One board for every reader (Lane 96 fix round 1, B08; Lane 163, D05): the front door's strip
 * prints the API's live order, the one Players and Rest of 2026 read at the same clock (restlive.go
 * RestAt and LiveBoard), in its order and to its tenth, signed out too, so Over replacement is one
 * number on every page. A reader whose read fails keeps the run's figures, said with the run's time
 * beside them. Pure, so the tests read every figure and
 * word the strip prints. */
import { timeOfDay, zoneWord } from '#lib/format/clock.ts';
import { BUILD_ZONE, dayTimeStamp } from '#lib/format/day-time.ts';
import { EMPTY_FIGURE } from '#lib/format/empty.ts';
import { overReplacementWords } from '#lib/format/figure-words.ts';
import { COLUMN_HEADS } from '#lib/ui/board-columns.ts';
import type { BasisPart } from '#lib/run/board-basis.ts';
import type { BoardRowView } from '#lib/run/schema.ts';
import type { components } from '#lib/api/types.ts';

type OrderAdvice = components['schemas']['OrderAdvice'];

/** How many rows the strip shows. */
export const STRIP_ROWS = 10;
/** How many of the run's rows the page carries for the live order to draw from: a one-quarterback
 * live top ten is the run's top players re-valued, so it sits within these; any other row is built
 * from the answer's own line. */
export const STRIP_POOL = 40;
export { BUILD_ZONE };

/** Every word the strip prints that is not a player's, a figure or the API's. */
export const STRIP_WORDS = {
	/** "Projected updated Thu Oct 22, 8:50 am Central.": the run's figures with
	 * its one stamp, day and zone (Lane 140, C24). */
	updated: (at: string): string => `Projected updated ${at}.`,
	/** The league a figure is for, as the API names it (words.go OrderLeague). */
	yourLeague: 'your league',
	shapeLeague: (teams: number, scoring: string): string =>
		`a ${String(teams)}-team ${scoring} league`,
	/** Why a row built from the answer reads "--" for Tier, said once in the basis (B78, Lane 117):
	 * his tier is the run's, and the page carries the top rows of the board it is built on alone. */
	untiered: (label: string): string =>
		`Tier reads "${EMPTY_FIGURE}" past the top ${String(STRIP_POOL)} of our ${label} board, which is as far as the front page lists.`,
	/** The strip's head in a scoring: "The top of our half PPR board" (B78). */
	head: (scoring: string): string => `The top of our ${scoring} board`,
	/** The strip's head in the scoring nearest the league's rules. */
	nearestHead: (scoring: string): string => `The top of our board, ${scoring} nearest your rules`,
	/** Avg beside a projection in the nearest scoring, said in the basis (B78, Lane 117). */
	leagueAvg: "Avg in your league's scoring."
} as const;

/** "Projected updated Thu Oct 22, 8:50 am Central.": the run's figures with
 * its one stamp (C24): the front door's basis dates the run here alone. */
export function runStampPart(refreshedAt: string, zone: string): BasisPart {
	return { text: STRIP_WORDS.updated(dayTimeStamp(refreshedAt, zone)), phone: true };
}

/** What Over replacement counts, said once under the heads (B46): the site's one definition
 * (figure-words.ts, Lane 163 D05), for the followed league or the board's shape. */
export function overReplacementPart(teams: number, scoring: string, league: boolean): BasisPart {
	const said = league ? STRIP_WORDS.yourLeague : STRIP_WORDS.shapeLeague(teams, scoring);
	return { text: overReplacementWords(COLUMN_HEADS.vor.text, said), phone: true };
}

/** The shape the live figures are for: "for 12 teams", or in a league "for 12 teams, your league's
 * shape". */
export function shapeWords(teams: number, league: boolean): string {
	const base = `for ${String(teams)} teams`;
	return league ? `${base}, your league's shape` : base;
}

/** The order's first sentence without its stop: "Our rest-of-season order from week 7". */
function orderLead(basis: string): string {
	const end = basis.indexOf('. ');
	return (end < 0 ? basis : basis.slice(0, end)).replace(/\.$/, '');
}

/** The live strip's lead, in place of the run's: the API's own words for its weeks, the shape and
 * when it was read. "Our rest-of-season order from week 7, by points over replacement for 12 teams,
 * your league's shape, read 7:25 pm Central." */
export function liveLeadPart(
	answer: Pick<OrderAdvice, 'basis'>,
	shape: string,
	readAt: number,
	zone: string
): BasisPart {
	const at = new Date(readAt).toISOString();
	return {
		text: `${orderLead(answer.basis)}, by points over replacement ${shape}, read ${timeOfDay(at, zone)} ${zoneWord(zone)}.`,
		phone: true
	};
}

/** When the answer was read (review R1-L4): the league's read when it says one, else the page's
 * clock as the answer landed. */
export function answerReadAt(answer: Pick<OrderAdvice, 'read_at'>, landed: number): number {
	return answer.read_at === null ? landed : Date.parse(answer.read_at);
}

type Scoring = OrderAdvice['projection_scoring'];

/** A scoring as the strip's head names it. */
const SCORING_WORDS: Readonly<Record<Scoring['format'], string>> = {
	ppr: 'PPR',
	half_ppr: 'half PPR',
	standard: 'standard'
};

/** The strip's head (review R1-M2, B78): the run's "The top of our PPR board"; on a live answer the
 * scoring its figures are in, "The top of our half PPR board" for a league that scores exactly so,
 * else as the board says it: "The top of our board, half PPR nearest your rules". */
export function stripHead(runLabel: string, scoring: Scoring | null): string {
	if (scoring === null) return STRIP_WORDS.head(runLabel);
	const words = SCORING_WORDS[scoring.format];
	return scoring.league_own ? STRIP_WORDS.head(words) : STRIP_WORDS.nearestHead(words);
}

/** The strip's basis parts beyond the run's, each said once (B78, Lane 117): why Tier reads "--"
 * when a row is built from the answer, and that Avg is in the league's scoring when the head names
 * the projection's nearest scoring. Never a word per row; at a desk alone, as a phone draws
 * neither column. */
export function stripBasisParts(
	rows: readonly StripRow[],
	runLabel: string,
	scoring: Scoring | null
): BasisPart[] {
	const words = [
		...(rows.some((row) => row.untiered === true) ? [STRIP_WORDS.untiered(runLabel)] : []),
		...(scoring !== null && !scoring.league_own ? [STRIP_WORDS.leagueAvg] : [])
	];
	return words.map((text) => ({ text, phone: false }));
}

/** His season as a strip row prints it: games null where the run does not hold him (B78). */
export interface StripSeason {
	games: number | null;
	pointsPerGame: number | null;
}

/** A strip row: the run's row, or one built from the answer's own line, which the run's top rows do
 * not hold (a two-quarterback league's quarterbacks, review R1-M1): it has no run tier and no run
 * games, and its Avg is the answer's. */
export type StripRow = Omit<BoardRowView, 'season'> & {
	season?: StripSeason;
	untiered?: boolean;
};

type OrderRow = OrderAdvice['rows'][number];

/** His season beside the live figures: the answer's points a game in the league's scoring (the Avg
 * Players prints) over the answer's games, a final the platform's points count included (Lane 111,
 * B23), else the run's games; the run's season where the answer says none. */
function liveSeason(run: BoardRowView, line: OrderRow['line']): BoardRowView['season'] {
	if (run.season === undefined || line.season_avg === null || run.season.games === 0)
		return run.season;
	return { games: line.games_played ?? run.season.games, pointsPerGame: line.season_avg };
}

/** A row the run's top rows do not hold, from the answer's line: his name, club, face, page, the
 * answer's figures, his Avg (B78) and its games (Lane 111), no tier and no ADP. Null without
 * a board id or a page to link. */
function builtRow(row: OrderRow, projected: number, vor: number, teams: number): StripRow | null {
	const { player, slug, headshot, position_rank: positionRank } = row.line;
	if (player.board_id === null || slug === null) return null;
	return {
		id: player.board_id,
		slug,
		name: player.name,
		position: player.position as BoardRowView['position'],
		positionRank: positionRank ?? row.rank,
		team: player.team,
		headshot: headshot ?? '',
		orderBasis: 'projection',
		ourRank: row.rank,
		vorRound: Math.ceil(row.rank / teams),
		adp: null,
		gap: null,
		projected,
		vor,
		expectedGames: 0,
		floor: null,
		median: null,
		ceiling: null,
		tier: 1,
		...(row.line.season_avg === null
			? {}
			: { season: { games: row.line.games_played ?? null, pointsPerGame: row.line.season_avg } }),
		untiered: true
	};
}

/** The strip at the API's clock: the answer's first `size` rows in its order, each the run's row for
 * him with the answer's Projected, Over repl., place, the round of a `teams`-team draft it falls in
 * and his Avg, or a row built from the answer's line where the run's rows do not hold him. Null when
 * a row carries no figure or no board id, or the answer is short: the page then keeps the run's
 * strip and its stamp, never a strip half one board and half the other. */
export function liveStrip(
	pool: readonly BoardRowView[],
	answer: Pick<OrderAdvice, 'rows'>,
	teams: number,
	size: number = STRIP_ROWS
): StripRow[] | null {
	const byId = new Map(pool.map((row) => [row.id, row]));
	const shown = answer.rows.slice(0, size);
	if (shown.length < Math.min(size, pool.length)) return null;
	const out: StripRow[] = [];
	for (const row of shown) {
		const projected = row.rest_of_season_points;
		const vor = row.points_over_replacement;
		if (projected === null || vor === null) return null;
		const id = row.line.player.board_id;
		const run = id === null ? undefined : byId.get(id);
		const shownRow =
			run === undefined
				? builtRow(row, projected, vor, teams)
				: {
						...run,
						projected,
						vor,
						ourRank: row.rank,
						// The round his place falls in, as the run words it from its own rank (row-framing.ts).
						vorRound: Math.ceil(row.rank / teams),
						// The run's Gap is its ADP less its own rank: the live place leaves it unsaid.
						gap: null,
						season: liveSeason(run, row.line)
					};
		if (shownRow === null) return null;
		out.push(shownRow);
	}
	return out;
}

/** The run's basis led by the live lead (the run stamp is the run's strip's alone). The front
 * door's run basis names no board of its own, its heading says it (Lane 140, C24). */
export function liveBasis(runBasis: readonly BasisPart[], lead: BasisPart): BasisPart[] {
	return [lead, ...runBasis];
}
