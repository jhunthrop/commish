/** The League page as a standings and roster board (Lane 66i): the week's scoreboard, the
 * standings as a box score, the moves as a feed and the league's settings. Pure functions over the
 * league's read and the scoreboard answer, so every word the page prints is tested here. */
import { memberZone, weekdayTime, zoneWord } from '#lib/format/clock.ts';
import { fixed, ordinal, plural } from '#lib/format/number.ts';
import type { components } from '#lib/api/types.ts';
import type { LeagueHost, LeagueMove, LeagueSync, LeagueTeam, LeagueTerms } from '../api.ts';
import { BOX, boxRow, slotWord, totalsPts, type BoxStarter, type BoxTotals } from '../box/box.ts';
import { heldLineup, lineupBox, type LineupBox } from '../box/lineup.ts';
import type {
	LineupAdvice,
	ProjectionScoring,
	Scoreboard,
	WeekDoneState
} from '../inseason/api.ts';
import { hostWords } from '../names.ts';
import {
	KICKOFF,
	scoreboardHead,
	stateWord,
	type GameHead,
	type GameStateCell
} from '../box/kickoff.ts';
import {
	AS_OF_KICKOFF,
	leagueScoringWords,
	finalNonePart,
	NONE_UNLISTED,
	projFinalPhone,
	unlistedPart,
	teBonusSentence,
	type UnlistedDrawn,
	type UnlistedForm
} from '../box/basis.ts';

type ScoreboardGame = Scoreboard['games'][number];
type ScoringRules = components['schemas']['ScoringRules'];
type Tiebreak = components['schemas']['Tiebreak'];
type WaiverOrder = components['schemas']['WaiverOrder'];

/** The terms' fields an API before Lane 104 does not send, read as unsaid when absent. */
type TermsLane104 = Pick<LeagueTerms, 'tiebreak' | 'waiver_order'>;

/** Every word the League page prints that is not a team's or a player's, for the copy guard. */
export const HOME = {
	week: 'Week',
	settings: 'Settings',
	scoreboardAside: 'Every game this week, yours first.',
	standings: 'Standings',
	rank: '#',
	team: 'Team',
	record: 'W-L-T',
	pointsFor: 'PF',
	pointsAgainst: 'PA',
	streak: 'Streak',
	budget: 'FAAB',
	order: 'Waiver',
	/** The waiver order's head of the line: the first in it picks first (Lane 104, B55). */
	firstPicks: '1st picks first',
	waiverOrder: 'Waiver order',
	tiebreak: 'Tiebreak',
	yourLineup: 'Your lineup',
	setYourLineup: 'Set your lineup',
	openLineup: 'Open Lineup',
	moves: 'Moves',
	movesAside: 'This week and last, newest first',
	noMoves: 'Nobody in your league has made a move this week or last.',
	when: 'When',
	move: 'Move',
	players: 'Players',
	detail: 'Detail',
	scoring: 'Scoring',
	roster: 'Roster',
	league: 'League',
	pointsAllowed: "A defense's points allowed",
	yardsAllowed: "A defense's yards allowed",
	nextKickoff: KICKOFF.next,
	/** A read's age as the live score's cell says it (agoCell). */
	justNow: 'just now',
	minAgo: 'min ago',
	hrAgo: 'hr ago',
	final: KICKOFF.final,
	/** The Settings card listing the scoring rules our stats lack (Lane 66t), which the in-season bases
	 * name (Lane 111). */
	uncounted: 'Not in Avg and Last',
	uncountedLine: "Our stats lack these rules of yours, so a player's Avg and Last leave them out."
} as const;

/** The rule a tie on record is broken by, as the standings' basis says it (Lane 104, B48). */
export const TIEBREAK_WORDS: Readonly<Record<Tiebreak, string>> = {
	head_to_head: 'head to head',
	points_for: 'points for',
	points_against: 'points against',
	division_record: 'division record'
};

/** How an order league's waiver order moves (Lane 104, B55). */
export const WAIVER_ORDER_WORDS: Readonly<Record<WaiverOrder, string>> = {
	rolling: 'rolling',
	inverse_standings: 'reverse standings'
};

// ---- the scoreboard

/** One side of a score bug: the team, its record, its two figures and, while the game is under way,
 * where its starters stand; how it reads against the other side once the game has started. */
export interface BugSide {
	rosterId: number;
	name: string;
	record: string;
	avatar: string | null;
	me: boolean;
	/** The small figure: once the game has started its projected final, before it nothing; once
	 * every one of its starters is final its total (Lane 121, B99), "Final 83.7" where the column's
	 * head still says Proj final for the other side. */
	small: string;
	/** Every one of the side's starters with a game is final (the API's starters_final, else the
	 * game's state): its figure reads Final, the Team row's and the Matchup bug's one predicate. */
	final: boolean;
	/** The platform lists the side no starters (the API's schedule_state, Lane 124): its state is the
	 * schedule's and it draws no Proj final, said once by unlistedPart (Lane 125, B104). */
	unlisted: boolean;
	/** Its Proj is our best lineup from its roster (the API's projection_best_lineup, Lane 127, B105),
	 * false from an older answer, which sends none. */
	bestLineup: boolean;
	/** Its Proj final counts a player in play at his projection's pace (projected_final_paced, Lane 127
	 * fix round 3). */
	paced: boolean;
	/** Its best lineup passed over a player with no Proj (best_lineup_skipped, Lane 137 B107). */
	skipped: boolean;
	/** The big figure (Lane 92, B22): its Proj before the first kickoff, its Pts from it. */
	big: string;
	/** "3 to play", "2 playing" while the game is under way (the API's to_play), else empty. */
	toPlay: string;
	/** Once the game has started: ahead (drawn bright), behind (muted) or level. Before kickoff,
	 * level, both sides drawn alike. */
	stands: 'ahead' | 'behind' | 'level';
}

/** The bug's two figure heads: before kickoff the Proj alone, from it Proj final and Pts. */
export interface BugColumns {
	small: string;
	big: string;
}

export interface Bug {
	key: string;
	mine: boolean;
	/** The game's head by the one rule (kickoff.ts): the API's state, a kickoff before the page's
	 * clock never upcoming. */
	state: GameHead['state'];
	/** "Sun 12:00 pm" before kickoff, "Kicked off", "Final". */
	head: string;
	/** "Next kickoff" before it; while under way the read beside the live score ("ESPN 1 min ago");
	 * else nothing. */
	words: string;
	columns: BugColumns;
	sides: BugSide[];
}

/** The read a live bug says beside its score: the platform and when the league was read. */
export interface BugRead {
	host: LeagueHost;
	readAt: string;
}

/** A read's age as a cell says it, short: "just now", "1 min ago", "2 hr ago". */
export function agoCell(seconds: number): string {
	if (seconds < MINUTE_SECONDS) return HOME.justNow;
	if (seconds < HOUR_SECONDS)
		return `${String(Math.floor(seconds / MINUTE_SECONDS))} ${HOME.minAgo}`;
	return `${String(Math.floor(seconds / HOUR_SECONDS))} ${HOME.hrAgo}`;
}

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3600;
const MS = 1000;

/** The live score's read as one cell (Lane 92, B06): "ESPN 1 min ago". */
export function readCell(read: BugRead, now: number): string {
	const seconds = Math.max(0, (now - Date.parse(read.readAt)) / MS);
	return `${hostWords(read.host)} ${agoCell(seconds)}`;
}

/** The figure heads by the game's head and its sides (Lane 121 fix round 1, HIGH-1): Proj before the
 * first kickoff; from it Proj final and Pts; Final and Pts once every side is final, by the side's
 * own predicate (sideFinal), the one the Team row and the Matchup bug read. */
export function bugColumns(
	state: GameHead['state'],
	sides: readonly Pick<BugSide, 'final'>[]
): BugColumns {
	if (state === 'upcoming') return { small: '', big: BOX.proj };
	const allFinal = sides.length > 0 && sides.every((s) => s.final);
	return { small: allFinal ? BOX.final : BOX.projFinal, big: BOX.pts };
}

/** A side's Final (Lane 121 fix round 1, HIGH-1): every one of its starters with a game is final, the
 * API's starters_final; a side the platform lists no starters for by the schedule, its schedule_state
 * (Lane 124, B102); an older answer reads the game's state. Never before the first kickoff. */
export function sideFinal(
	side: Pick<ScoreboardGame['sides'][number], 'starters_final' | 'schedule_state'>,
	state: GameHead['state']
): boolean {
	if (state === 'upcoming') return false;
	if (side.starters_final !== undefined) return side.starters_final;
	return (side.schedule_state ?? state) === 'final';
}

/** Whether a bug still draws a Proj final (a side of a started game not final): what the key
 * explains (Lane 121, B99). */
export function bugsPlaying(
	bugs: readonly { state: Bug['state']; sides: readonly Pick<BugSide, 'final'>[] }[]
): boolean {
	return bugs.some((b) => b.state !== 'upcoming' && b.sides.some((s) => !s.final));
}

/** Whether a final side draws "--" for its total, the platform's score unread: the key says why. */
export function bugsFinalNone(
	bugs: readonly { sides: readonly Pick<BugSide, 'final' | 'small'>[] }[]
): boolean {
	return bugs.some((b) => b.sides.some((s) => s.final && s.small.endsWith(BOX.none)));
}

/** A team's record as the standings print it: "5-0-0". */
export function recordCell(team: Pick<LeagueTeam, 'wins' | 'losses' | 'ties'>): string {
	return `${String(team.wins)}-${String(team.losses)}-${String(team.ties)}`;
}

/** The record a score bug prints beside a name: "5-0", "5-0-1" with a tie. */
function bugRecord(team: LeagueTeam | undefined): string {
	if (!team) return '';
	const base = `${String(team.wins)}-${String(team.losses)}`;
	return team.ties > 0 ? `${base}-${String(team.ties)}` : base;
}

/** Who stands ahead once a game has started; level before kickoff, or with a score unread. */
function standsOf(
	game: ScoreboardGame,
	side: ScoreboardGame['sides'][number],
	started: boolean
): BugSide['stands'] {
	const other = game.sides.find((s) => s.roster_id !== side.roster_id);
	if (!started || !other || !side.points_read || !other.points_read) return 'level';
	if (side.points === other.points) return 'level';
	return side.points > other.points ? 'ahead' : 'behind';
}

/** The state's words at the bug's head: the next kickoff before the game, the read beside the live
 * score while it is under way (each side counts its own starters, BugSide.toPlay), nothing once it is
 * final. */
function bugHead(
	head: GameHead,
	cell: GameStateCell | undefined,
	zone: string,
	read: BugRead | null,
	now: number
): Pick<Bug, 'head' | 'words'> {
	if (head.state === 'final')
		return { head: stateWord(cell, head.state, KICKOFF.final), words: '' };
	if (head.state === 'kicked_off') {
		return {
			head: stateWord(cell, head.state, KICKOFF.kickedOff),
			words: read === null ? '' : readCell(read, now)
		};
	}
	return {
		head: head.next === null ? '' : weekdayTime(head.next, zone),
		words: head.next === null ? '' : stateWord(cell, head.state, HOME.nextKickoff)
	};
}

/** A side's figures (Lane 92, B22): before kickoff its Proj is the big figure; from the first kickoff
 * its Pts are, with its projected final (the API's, else its Proj) small beside them. */
function sideFigures(
	side: ScoreboardGame['sides'][number],
	state: GameHead['state'],
	final: boolean,
	/** The column's head says Final (every side final): the cell needs no word of its own. */
	headFinal: boolean
): Pick<BugSide, 'small' | 'big'> {
	const proj = side.projection === null ? BOX.none : fixed(side.projection, 1);
	if (state === 'upcoming') return { small: '', big: proj };
	const pts = side.points_read ? fixed(side.points, 1) : BOX.none;
	if (!final) {
		const projected = side.projected_final ?? null;
		return { small: projected === null ? BOX.none : fixed(projected, 1), big: pts };
	}
	// Final: the side's total, never a projection, said Final where the head says Proj final.
	return { small: headFinal ? pts : `${BOX.final} ${pts}`, big: pts };
}

/** Every game of the week as a score bug, the drafter's first, each read at `now`, the page's clock
 * in ms; read is the league's last read, said beside a live score. */
export function bugsOf(
	board: Pick<Scoreboard, 'games'>,
	sync: Pick<LeagueSync, 'teams' | 'me'>,
	now: number,
	zone: string = memberZone(),
	read: BugRead | null = null
): Bug[] {
	const teams = new Map(sync.teams.map((t) => [t.roster_id, t] as const));
	return board.games.map((game, i) => {
		const mine = game.sides.some((s) => s.roster_id === sync.me);
		const head = scoreboardHead(game, now);
		const started = head.state !== 'upcoming';
		const finals = game.sides.map((side) => ({ final: sideFinal(side, head.state) }));
		const columns = bugColumns(head.state, finals);
		return {
			key: `${String(i)}-${game.sides.map((s) => String(s.roster_id)).join('-')}`,
			mine,
			state: head.state,
			...bugHead(head, game.game_state, zone, read, now),
			columns,
			sides: game.sides.map((side, s) => {
				const team = teams.get(side.roster_id);
				const final = finals[s]?.final === true;
				return {
					rosterId: side.roster_id,
					name: team?.name ?? `Team ${String(side.roster_id)}`,
					record: bugRecord(team),
					avatar: team?.avatar ?? null,
					me: side.roster_id === sync.me,
					final,
					unlisted: side.schedule_state !== undefined,
					bestLineup: side.projection_best_lineup === true,
					paced: side.projected_final_paced === true,
					skipped: side.best_lineup_skipped === true,
					...sideFigures(side, head.state, final, columns.small === BOX.final),
					toPlay: head.state === 'kicked_off' ? (side.to_play ?? '') : '',
					stands: standsOf(game, side, started)
				};
			})
		};
	});
}

/** Each team's projection this week, by roster, from the scoreboard: its projected final once its game
 * has started by the bug's own rule at the page's clock (gameHead, round 2; equal to its Pts once
 * final, Lane 92 B22; none where the API gives none), its Proj before. */
export function projections(
	board: Scoreboard | null,
	now: number
): ReadonlyMap<number, number | null> {
	return new Map(
		(board?.games ?? []).flatMap((g) => {
			const upcoming = scoreboardHead(g, now).state === 'upcoming';
			return g.sides.map(
				(s) => [s.roster_id, upcoming ? s.projection : (s.projected_final ?? null)] as const
			);
		})
	);
}

/** Whether a side not final draws a Proj final "--": the basis then says why (round 2). A final side's
 * small figure is its total (Lane 121, B99), said by bugsFinalNone. */
export function bugsMissFinal(bugs: readonly Bug[]): boolean {
	return bugs.some(
		(b) => b.state !== 'upcoming' && b.sides.some((s) => !s.final && s.small === BOX.none)
	);
}

/** The bugs with only the sides whose figures come from a lineup: the platform's, or our best lineup
 * of the roster (Lane 127 fix round 1); a side with neither draws "--", said by unlistedPart (Lane
 * 125), never by the starters' keys. */
function lineupSidesOnly(bugs: readonly Bug[]): Bug[] {
	return bugs.map((b) => ({ ...b, sides: b.sides.filter((s) => !s.unlisted || s.bestLineup) }));
}

/** Whether a side with a lineup draws a Proj final "--" (bugsMissFinal), on the League page and the
 * front door alike. */
export function bugsMissListedFinal(bugs: readonly Bug[]): boolean {
	return bugsMissFinal(lineupSidesOnly(bugs));
}

/** Whether a side the platform lists starters for still draws a Proj final (bugsPlaying): what it adds
 * is said only then. A best lineup's Proj final is said by unlistedPart, its pace clause included (Lane
 * 127 fix round 3), and a "--" with no roster too. */
export function bugsPlayingListed(bugs: readonly Bug[]): boolean {
	return bugsPlaying(bugs.map((b) => ({ ...b, sides: b.sides.filter((s) => !s.unlisted) })));
}

/** The figure a side draws in its bug's state at the page's clock: its Proj before kickoff, its Proj
 * final while it plays, null once it is final (its total, no projection). */
function drawnFigure(state: Bug['state'], side: BugSide): string | null {
	if (state === 'upcoming') return side.big;
	return side.final ? null : side.small;
}

/** What the sides the platform lists no starters for draw (Lane 127 fix round 1), by each bug's state
 * at the page's clock: a figure from our best lineup of the roster, or "--" with no roster. */
export function unlistedDrawn(bugs: readonly Bug[]): UnlistedDrawn {
	const drawn = bugs.flatMap((b) =>
		b.sides
			.filter((s) => s.unlisted)
			.map((s) => ({ s, figure: drawnFigure(b.state, s) }))
			.filter(({ figure }) => figure !== null)
	);
	const best = drawn.filter(({ s, figure }) => s.bestLineup && figure !== BOX.none);
	return {
		bestLineup: best.length > 0,
		noRoster: drawn.some(({ s, figure }) => !s.bestLineup && figure === BOX.none),
		// A best lineup drawn that passed over a player with no Proj (Lane 137, B107).
		skipped: best.some(({ s }) => s.skipped),
		// A Proj final drawn from a best lineup: a game under way, the side not final (fix round 3).
		paced: bugs.some(
			(b) =>
				b.state !== 'upcoming' &&
				b.sides.some(
					(s) => s.unlisted && s.bestLineup && s.paced && !s.final && s.small !== BOX.none
				)
		)
	};
}

// ---- the drafter's lineup

/** The drafter's lineup on the League page: the advice (its swaps and what they add), the starters
 * as the platform has them set, their totals, and the bench as a count. */
export interface LineupSummary {
	box: LineupBox;
	starters: BoxStarter[];
	totals: BoxTotals;
	benchWords: string;
	/** The API's sentence once every starter of the member's has kicked off (week_done), null before. */
	done: string | null;
	/** Locked while the matchup still plays, final once it is (week_done_state); null before, or
	 * from the previous API. */
	doneState: WeekDoneState | null;
}

/** A team's projected final from the scoreboard (the API's, Lane 92), null before its week has
 * started or with no scoreboard. */
export function projectedFinalOf(board: Scoreboard | null, rosterId: number): number | null {
	for (const game of board?.games ?? []) {
		const side = game.sides.find((s) => s.roster_id === rosterId);
		if (side) return side.projected_final ?? null;
	}
	return null;
}

/** The lineup as set from the Lineup's answer: each slot's player on the platform, in the league's
 * slots; every other active player is the bench, injured reserve counted apart. Its Team row's
 * projected final is the score bug's (final, the lineup as set). */
export function lineupSummary(
	advice: LineupAdvice,
	zone: string,
	now: number,
	final: number | null = null,
	/** The member's game has kicked off (its score bug's state). */
	live = false
): LineupSummary {
	// No change is drawn on a row whose game has kicked off or is final (Lane 85).
	const box = lineupBox(heldLineup(advice, now), zone, now);
	const starters = advice.slots.flatMap((slot): BoxStarter[] =>
		slot.host ? [{ row: boxRow(slot.host, slotWord(slot.slot), zone, false, now) }] : []
	);
	const set = new Set(starters.map((s) => s.row.key));
	const active = new Set([
		...advice.slots.map((s) => s.ours.player.host_id),
		...advice.bench.map((l) => l.player.host_id)
	]);
	const bench = [...active].filter((id) => !set.has(id)).length;
	const reserve = advice.reserve.length;
	const benchWords = `${BOX.bench}, ${plural(bench, 'player')}${reserve > 0 ? `. ${BOX.reserve}, ${String(reserve)}` : ''}`;
	const rows = starters.map((s) => s.row);
	return {
		box,
		starters,
		totals: {
			proj: box.asSet,
			pts: totalsPts(rows, advice.player_points, advice.team_points),
			final,
			live,
			allFinal: box.totals.allFinal,
			note: null
		},
		benchWords,
		done: advice.week_done ?? null,
		doneState: advice.week_done_state ?? null
	};
}

// ---- the standings

/** The waiver column: the budget left in a budget league, the order otherwise, none where the
 * platform says neither. */
export function waiverColumn(terms: Pick<LeagueTerms, 'waivers'>): string | null {
	if (terms.waivers === 'budget') return HOME.budget;
	if (terms.waivers === 'order') return HOME.order;
	return null;
}

/** A team's waiver cell: "$675" left of the budget, "6th" in the order, "--" where unsaid. */
export function waiverCell(
	team: Pick<LeagueTeam, 'waiver_budget_left' | 'waiver_order'>,
	terms: Pick<LeagueTerms, 'waivers'>
): string {
	if (terms.waivers === 'budget' && team.waiver_budget_left !== null) {
		return `$${team.waiver_budget_left.toLocaleString('en-US')}`;
	}
	if (terms.waivers === 'order' && team.waiver_order !== null) return ordinal(team.waiver_order);
	return BOX.none;
}

/** The columns the standings sort by. */
export type StandingsKey = 'rank' | 'record' | 'chance' | 'pf' | 'pa' | 'proj' | 'waiver';

export interface StandingsRow {
	team: LeagueTeam;
	rank: number;
	me: boolean;
	proj: number | null;
}

/** The standings as the platform orders them (rank), or by a column, the best first: most wins,
 * most points for, fewest against, the highest projection, the most budget or the first in order.
 * A team a column has no figure for sorts last, and ties keep the standings' order. */
export function sortStandings(
	rows: readonly StandingsRow[],
	key: StandingsKey,
	terms: Pick<LeagueTerms, 'waivers'>
): StandingsRow[] {
	const value = (r: StandingsRow): number | null => {
		switch (key) {
			case 'rank':
				return -r.rank;
			case 'record':
				return r.team.wins + r.team.ties / 2;
			case 'chance':
				return r.team.playoff_chance ?? null;
			case 'pf':
				return r.team.points_for;
			case 'pa':
				return r.team.points_against === null ? null : -r.team.points_against;
			case 'proj':
				return r.proj;
			case 'waiver':
				return terms.waivers === 'budget'
					? r.team.waiver_budget_left
					: r.team.waiver_order === null
						? null
						: -r.team.waiver_order;
		}
	};
	return [...rows].sort((a, b) => {
		const [va, vb] = [value(a), value(b)];
		if (va === vb) return a.rank - b.rank;
		if (va === null) return 1;
		if (vb === null) return -1;
		return vb - va;
	});
}

/** The standings' rows in the platform's order, with each team's projection this week. */
export function standingsRows(
	sync: Pick<LeagueSync, 'teams' | 'me'>,
	proj: ReadonlyMap<number, number | null>
): StandingsRow[] {
	return sync.teams.map((team, i) => ({
		team,
		rank: i + 1,
		me: team.roster_id === sync.me,
		proj: proj.get(team.roster_id) ?? null
	}));
}

/** The rule drawn under the last playoff spot by record, with its words: "Top 6 by record,
 * playoffs weeks 15 to 17". The platform seeds the field by its own rules (divisions, tiebreaks),
 * which we do not read, so the rule says it is drawn by record. */
export function playoffRule(
	terms: Pick<LeagueTerms, 'playoff_teams' | 'playoff_weeks'>,
	teams: number
): { after: number; words: string } | null {
	const n = terms.playoff_teams;
	if (n === null || n <= 0 || n >= teams) return null;
	const top = `Top ${String(n)} by record`;
	const weeks = weeksWords(terms.playoff_weeks);
	return {
		after: n,
		words: weeks === '' ? `${top} make the playoffs` : `${top}, playoffs${weeks.slice(1)}`
	};
}

type Seed = NonNullable<LeagueTerms['playoff_seeds']>[number];

/** The platform's seeds, none where it states none (an API before Lane 94 sends none). */
function seedsOf(terms: Pick<LeagueTerms, 'playoff_seeds'>): readonly Seed[] {
	return terms.playoff_seeds ?? [];
}

/** Seed numbers in a sentence: "1", "1 and 3", "1, 3 and 5". */
function seedNumbers(seeds: readonly number[]): string {
	const words = seeds.map(String);
	const last = words.pop() ?? '';
	return words.length === 0 ? last : `${words.join(', ')} and ${last}`;
}

const SEED_WORDS: Readonly<Record<Seed, string>> = { record: 'on record', points: 'on points' };

/** How the platform seeds its playoffs where it states it seed by seed and not on record alone
 * (FFPC, Lane 94 B21), printed under the standings in place of a cut no row sits at: "FFPC seeds 4
 * for the playoffs, weeks 13 to 14: 1 and 3 on record, 2 and 4 on points." Null otherwise; a field
 * seeded on record alone is the cut under the standings. */
export function seedingWords(
	terms: Pick<LeagueTerms, 'playoff_seeds' | 'playoff_weeks'>,
	host: LeagueHost
): string | null {
	const seeds = seedsOf(terms);
	if (!seeds.includes('points')) return null;
	const by = (['record', 'points'] as const).flatMap((kind) => {
		const numbers = seeds.flatMap((s, i) => (s === kind ? [i + 1] : []));
		return numbers.length === 0 ? [] : [`${seedNumbers(numbers)} ${SEED_WORDS[kind]}`];
	});
	return `${hostWords(host)} seeds ${String(seeds.length)} for the playoffs${weeksWords(terms.playoff_weeks)}: ${by.join(', ')}.`;
}

/** The playoffs' field: the platform's count, else its seeds. */
function playoffField(terms: Pick<LeagueTerms, 'playoff_teams' | 'playoff_seeds'>): number | null {
	const seeds = seedsOf(terms).length;
	return terms.playoff_teams ?? (seeds > 0 ? seeds : null);
}

/** The playoffs' weeks after a comma: ", weeks 15 to 17", ", week 16", or nothing unsaid. */
function weeksWords(w: LeagueTerms['playoff_weeks']): string {
	if (w === null) return '';
	return w.first === w.last
		? `, week ${String(w.first)}`
		: `, weeks ${String(w.first)} to ${String(w.last)}`;
}

// ---- the moves

export interface FeedPlayer {
	key: string;
	name: string;
	club: string;
	position: string;
	boardId: string | null;
	/** The team that took him in a trade. */
	to: string | null;
}

export interface FeedRow {
	key: string;
	at: string;
	when: string;
	kind: string;
	teams: { rosterId: number; name: string; me: boolean; avatar: string | null }[];
	mine: boolean;
	adds: FeedPlayer[];
	drops: FeedPlayer[];
	trade: boolean;
	detail: string;
}

export const KIND_WORDS: Readonly<Record<LeagueMove['kind'], string>> = {
	add: 'Free agent',
	waiver: 'Waiver',
	trade: 'Trade'
};

/** A move that only lets a player go. */
export const DROP_WORD = 'Drop';

/** A move's day and time: "Sun 11:44 am". */
export function moveWhen(at: string, zone: string = memberZone()): string {
	return weekdayTime(at, zone);
}

/** The league's moves as feed rows, newest first, as the read holds them. */
export function feedRows(
	sync: Pick<LeagueSync, 'teams' | 'me' | 'moves'>,
	zone: string = memberZone()
): FeedRow[] {
	const teams = new Map(sync.teams.map((t) => [t.roster_id, t] as const));
	const nameOf = (id: number): string => teams.get(id)?.name ?? `Team ${String(id)}`;
	const player =
		(trade: boolean) =>
		(m: LeagueMove['adds'][number]): FeedPlayer => ({
			key: m.player.host_id,
			name: m.player.name,
			club: m.player.team,
			position: m.player.position === 'DEF' ? 'D/ST' : m.player.position,
			boardId: m.player.board_id,
			to: trade ? nameOf(m.roster_id) : null
		});
	return sync.moves.map((move, i) => {
		const trade = move.kind === 'trade';
		const dropOnly = !trade && move.adds.length === 0 && move.drops.length > 0;
		return {
			key: `${move.at}-${String(i)}`,
			at: move.at,
			when: moveWhen(move.at, zone),
			kind: dropOnly ? DROP_WORD : KIND_WORDS[move.kind],
			teams: move.roster_ids.map((id) => ({
				rosterId: id,
				name: nameOf(id),
				me: id === sync.me,
				avatar: teams.get(id)?.avatar ?? null
			})),
			mine: move.roster_ids.includes(sync.me),
			adds: move.adds.map(player(trade)),
			drops: trade ? [] : move.drops.map(player(false)),
			trade,
			detail: move.bid === null ? '' : `${HOME.budget} $${move.bid.toLocaleString('en-US')}`
		};
	});
}

// ---- the settings

/** One rule of the settings' scoring, in the setup page's words with Lane 70b's for the kicking
 * and defense rules. */
export interface RuleLine {
	label: string;
	points: number;
	/** The platform states it; a rule it does not is held at our standard figure, never printed. */
	stated: boolean;
}

export interface RuleGroup {
	label: string;
	rules: RuleLine[];
	/** How many of its rules the platform does not state. */
	unstated: number;
}

type RuleKey = keyof ScoringRules;

const GROUPS: readonly { label: string; rules: readonly (readonly [RuleKey, string])[] }[] = [
	{
		label: 'Passing',
		rules: [
			['points_per_passing_yard', 'Each passing yard'],
			['points_per_passing_touchdown', 'Passing touchdown'],
			['points_per_interception', 'Interception thrown']
		]
	},
	{
		label: 'Rushing and receiving',
		rules: [
			['points_per_rushing_yard', 'Each rushing yard'],
			['points_per_rushing_touchdown', 'Rushing touchdown'],
			['points_per_receiving_yard', 'Each receiving yard'],
			['points_per_receiving_touchdown', 'Receiving touchdown'],
			['points_per_reception', 'Each catch'],
			['te_reception_bonus', 'Extra for a tight end catch']
		]
	},
	{
		label: 'Everyone',
		rules: [
			['points_per_fumble_lost', 'Fumble lost'],
			['points_per_two_point_conversion', 'Two-point conversion'],
			['points_per_return_touchdown', 'Kick or punt return touchdown']
		]
	},
	{
		label: 'Kicking',
		rules: [
			['points_per_field_goal', 'Field goal made under 40 yards'],
			['points_per_field_goal_40_49', 'Field goal made from 40 to 49 yards'],
			['points_per_field_goal_50_plus', 'Field goal made from 50 yards or more'],
			['points_per_field_goal_missed', 'Field goal missed'],
			['points_per_extra_point', 'Extra point made'],
			['points_per_extra_point_missed', 'Extra point missed']
		]
	},
	{
		label: 'Defense',
		rules: [
			['points_per_sack', 'Sack'],
			['points_per_defensive_interception', 'Interception'],
			['points_per_defensive_fumble_recovery', 'Fumble recovery'],
			['points_per_defensive_touchdown', 'Touchdown'],
			['points_per_safety', 'Safety']
		]
	}
];

/** The points-allowed and yards-allowed tiers, lowest first, as the scoring package ranges them. */
const POINTS_TIERS: readonly (readonly [RuleKey, string])[] = [
	['points_allowed_0', '0'],
	['points_allowed_1_6', '1 to 6'],
	['points_allowed_7_13', '7 to 13'],
	['points_allowed_14_17', '14 to 17'],
	['points_allowed_18_20', '18 to 20'],
	['points_allowed_21', '21'],
	['points_allowed_22_27', '22 to 27'],
	['points_allowed_28_34', '28 to 34'],
	['points_allowed_35_45', '35 to 45'],
	['points_allowed_46_plus', '46 or more']
];

const YARDS_TIERS: readonly (readonly [RuleKey, string])[] = [
	['yards_allowed_0_99', '0 to 99'],
	['yards_allowed_100_199', '100 to 199'],
	['yards_allowed_200_299', '200 to 299'],
	['yards_allowed_300_349', '300 to 349'],
	['yards_allowed_350_399', '350 to 399'],
	['yards_allowed_400_449', '400 to 449'],
	['yards_allowed_450_499', '450 to 499'],
	['yards_allowed_500_549', '500 to 549'],
	['yards_allowed_550_plus', '550 or more']
];

/** The scoring in the setup page's groups, then the two tier ladders; a rule the platform does not
 * state is marked so its figure is never printed, and the count is the stated rules alone. */
export function scoringView(
	rules: ScoringRules,
	unstated: readonly string[]
): {
	groups: RuleGroup[];
	pointsAllowed: RuleLine[];
	yardsAllowed: RuleLine[];
	count: number;
} {
	const missing = new Set(unstated);
	const rulesOf = (list: readonly (readonly [RuleKey, string])[]): RuleLine[] =>
		list.map(([key, label]) => ({ label, points: rules[key] ?? 0, stated: !missing.has(key) }));
	const groups = GROUPS.map((g) => {
		const lines = rulesOf(g.rules);
		return { label: g.label, rules: lines, unstated: lines.filter((r) => !r.stated).length };
	});
	const pointsAllowed = rulesOf(POINTS_TIERS);
	const yardsAllowed = rulesOf(YARDS_TIERS);
	const count = [...groups.flatMap((g) => g.rules), ...pointsAllowed, ...yardsAllowed].filter(
		(r) => r.stated
	).length;
	return { groups, pointsAllowed, yardsAllowed, count };
}

/** Said once under a group holding rules the platform does not state. */
export function unstatedWords(host: LeagueHost, n: number): string {
	const what = n === 1 ? 'this rule. We score it' : 'these rules. We score them';
	return `${hostWords(host)} does not state ${what} at our standard figure.`;
}

/** The basis's word where the platform's moves are not read. */
export function movesBasis(host: LeagueHost): string {
	return `${hostWords(host)} gives no move history to us.`;
}

/** A rule's figure: "+0.04", "−2", "0". */
export function ruleFigure(points: number): string {
	if (points === 0) return '0';
	const text = String(Math.round(points * 1000) / 1000);
	return points > 0 ? `+${text}` : text.replace('-', '−');
}

/** The roster's shape as the settings print it, every slot the league starts and its bench. */
export function shapeView(shape: LeagueTerms['roster']): { label: string; count: number }[] {
	return [
		{ label: 'QB', count: shape.qb },
		{ label: 'RB', count: shape.rb },
		{ label: 'WR', count: shape.wr },
		{ label: 'TE', count: shape.te },
		{ label: 'Flex', count: shape.flex },
		{ label: 'SFlex', count: shape.super_flex },
		{ label: 'D/ST', count: shape.def },
		{ label: 'K', count: shape.k },
		{ label: 'Bench', count: shape.bench }
	].filter((s) => s.count > 0 || s.label === 'K' || s.label === 'Bench');
}

/** The league's terms as rows, each one the platform states. */
export function termsView(terms: LeagueTerms, teams: number): { label: string; value: string }[] {
	const out = [{ label: 'Teams', value: String(teams) }];
	if (terms.waivers === 'budget') {
		const budget =
			terms.waiver_budget === null
				? ''
				: `, $${terms.waiver_budget.toLocaleString('en-US')} a season`;
		out.push({ label: 'Waivers', value: `${HOME.budget}${budget}` });
	} else if (terms.waivers === 'order') {
		const order = orderType(terms);
		out.push({
			label: 'Waivers',
			value: order === null ? HOME.waiverOrder : `${HOME.waiverOrder}, ${order}`
		});
	}
	const tiebreak = terms.tiebreak;
	if (tiebreak !== undefined) {
		out.push({ label: HOME.tiebreak, value: sentenceCase(TIEBREAK_WORDS[tiebreak]) });
	}
	const field = playoffField(terms);
	if (field !== null) {
		out.push({
			label: 'Playoffs',
			value: `${String(field)} teams${weeksWords(terms.playoff_weeks)}`
		});
	}
	return out;
}

/** "Sleeper also scores these, which mock drafts and the Proj column leave out." */
export function extraWords(host: LeagueHost): string {
	return `${hostWords(host)} also scores these, which mock drafts and the ${BOX.proj} column leave out.`;
}

/** The settings' lead: how many rules, whose, in what units. */
export function scoringLead(count: number, host: LeagueHost): string {
	return `${String(count)} rules as ${hostWords(host)} states them. Points per yard for the yardage rules, per play for the rest.`;
}

/** The link to the platform's own page for the settings. */
export function settingsLink(host: LeagueHost): string {
	return `See them on ${hostWords(host)}`;
}

// ---- the basis, at most five lines

/** How the league's order moves in words, null where the platform does not say (or an API before
 * Lane 104 sends nothing). */
function orderType(terms: TermsLane104): string | null {
	return terms.waiver_order === undefined ? null : WAIVER_ORDER_WORDS[terms.waiver_order];
}

/** A word table's lower-case phrase as a cell's value: "Head to head". */
function sentenceCase(words: string): string {
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The standings' order after the record (Lane 104, B48): the tiebreak the platform's settings give,
 * else points for as the platform lists the teams. */
function tiebreakWords(platform: string, terms: TermsLane104): string {
	return terms.tiebreak === undefined
		? `then points for, as ${platform} lists them`
		: `then ${TIEBREAK_WORDS[terms.tiebreak]}`;
}

/** The waiver column's basis: the budget left in a budget league, the place in the order otherwise
 * with how the order moves and who picks first (Lane 104, B55), nothing where the platform says
 * neither. */
function waiverBasis(
	platform: string,
	terms: Pick<LeagueTerms, 'waivers' | 'waiver_budget'> & TermsLane104
): string {
	if (terms.waivers === 'budget') {
		const of =
			terms.waiver_budget === null ? '' : ` of $${terms.waiver_budget.toLocaleString('en-US')}`;
		return `, ${HOME.budget} the budget left${of}`;
	}
	if (terms.waivers !== 'order') return '';
	const order = orderType(terms);
	const how = order === null ? HOME.firstPicks : `${order}, ${HOME.firstPicks}`;
	return `, ${HOME.order} the place in ${platform}'s order (${how})`;
}

/** What the standings' numbers are, said once: the order and its tiebreak, PF and PA, the streak,
 * the waiver column. */
export function standingsBasis(
	host: LeagueHost,
	terms: Pick<LeagueTerms, 'waivers' | 'waiver_budget'> & TermsLane104
): string {
	const platform = hostWords(host);
	return `Standings follow ${platform}'s record, ${tiebreakWords(platform, terms)}. ${HOME.pointsFor} and ${HOME.pointsAgainst} are points for and against, ${HOME.streak} the current run${waiverBasis(platform, terms)}.`;
}

/** What a crowded phone leaves out of the team sentences (week-basis.ts): FFPC's tight end extra, "as
 * of kickoff", and the FFPC teams' words said whole or short (UnlistedForm). */
export interface TeamCuts {
	teBonus: boolean;
	asOf: boolean;
	unlistedForm: UnlistedForm;
}

export const NO_TEAM_CUTS: TeamCuts = { teBonus: false, asOf: false, unlistedForm: 'full' };

/** What a team's Proj and Pts are on the scoreboard and in the standings, short enough that the
 * page's basis keeps to eight lines on a phone (Lane 108, B82): the scoring in the words every
 * league screen's Proj sentence uses (leagueScoringWords). */
export function teamBasis(
	host: LeagueHost,
	readAt: string | null,
	scoring: ProjectionScoring,
	/** The lineup's rows carry each player's points (player_points), so its Team adds them. */
	byPlayer: boolean,
	zone: string = memberZone(),
	/** A game of the week has kicked off: Proj final is on the board (Lane 92). */
	started = false,
	/** A bug draws a Proj final "--" (round 2). */
	missing = false,
	/** A side still draws a Proj final (bugsPlaying, Lane 121): what it is is said. */
	projFinal = started,
	/** A final side draws "--" for its total (bugsFinalNone): why is said. */
	finalNone = false,
	/** What the sides the platform lists no starters for draw (unlistedDrawn): each said once. */
	unlisted: UnlistedDrawn = NONE_UNLISTED,
	/** What a crowded phone leaves to the desk (week-basis.ts, by the room left, Lane 141 B121), never a
	 * drawn figure's sentence (Lane 137 fix round 1, HIGH-2); a desk cuts nothing. */
	cuts: TeamCuts = NO_TEAM_CUTS
): string {
	const platform = hostWords(host);
	const team = byPlayer ? `, ${BOX.totals} adds the rows` : '';
	const bonus = scoring.league_own || cuts.teBonus ? null : teBonusSentence(scoring.te_bonus, host);
	const whose = leagueScoringWords(scoring, host);
	const when =
		readAt === null
			? 'not in yet for this week'
			: `read ${weekdayTime(readAt, zone)} ${zoneWord(zone)}`;
	// The Proj final in one sentence, why a "--" is where one is, else what it adds (projFinalPhone):
	// the FFPC home's eight phone lines hold the best lineup's sentence beside it (Lane 127 fix round 1).
	const words = [
		projFinalPhone(projFinal, missing),
		finalNone ? finalNonePart(host) : '',
		unlistedPart(host, unlisted, cuts.unlistedForm)
	]
		.filter((w) => w !== '')
		.join(' ');
	const final = words === '' ? '' : ` ${words}`;
	const extra = bonus === null ? '' : ` ${bonus}`;
	const asOf = started && !cuts.asOf;
	return `A team's ${BOX.proj} adds its starters' published projections${whose}, ${when}${asOf ? `, ${AS_OF_KICKOFF}` : ''}.${extra} ${BOX.pts} are ${platform}'s so far${team}.${final}`;
}
