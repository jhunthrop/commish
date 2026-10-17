/** The League page as a standings and roster board (Lane 66i): the week's scoreboard, the
 * standings as a box score, the moves as a feed and the league's settings. Pure functions over the
 * league's read and the scoreboard answer, so every word the page prints is tested here. */
import { memberZone, weekdayTime, zoneWord } from '#lib/format/clock.ts';
import { fixed, ordinal, plural } from '#lib/format/number.ts';
import type { components } from '#lib/api/types.ts';
import type { LeagueHost, LeagueMove, LeagueSync, LeagueTeam, LeagueTerms } from '../api.ts';
import { BOX, boxRow, slotWord, totalsPts, type BoxStarter, type BoxTotals } from '../box/box.ts';
import { lineupBox, type LineupBox } from '../box/lineup.ts';
import type { LineupAdvice, ProjectionScoring, Scoreboard } from '../inseason/api.ts';
import { hostWords } from '../names.ts';

type ScoreboardGame = Scoreboard['games'][number];
type ScoringRules = components['schemas']['ScoringRules'];

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
	nextKickoff: 'Next kickoff',
	playing: 'In play',
	final: 'Final'
} as const;

// ---- the scoreboard

/** One side of a score bug: the team, its record, its projection and its points so far, and how it
 * reads against the other side once the game has started. */
export interface BugSide {
	rosterId: number;
	name: string;
	record: string;
	avatar: string | null;
	me: boolean;
	proj: string;
	pts: string;
	/** Once the game has started: ahead (drawn bright), behind (muted) or level. Before kickoff,
	 * level, both sides drawn alike. */
	stands: 'ahead' | 'behind' | 'level';
}

export interface Bug {
	key: string;
	mine: boolean;
	state: ScoreboardGame['state'];
	/** "Sun 12:00 pm" before kickoff, "In play", "Final". */
	head: string;
	/** "Next kickoff", "6 of 20 starters to play", or nothing. */
	words: string;
	sides: BugSide[];
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
function standsOf(game: ScoreboardGame, side: ScoreboardGame['sides'][number]): BugSide['stands'] {
	const other = game.sides.find((s) => s.roster_id !== side.roster_id);
	if (game.state === 'upcoming' || !other || !side.points_read || !other.points_read)
		return 'level';
	if (side.points === other.points) return 'level';
	return side.points > other.points ? 'ahead' : 'behind';
}

/** The state's words at the bug's head. */
function bugHead(game: ScoreboardGame, zone: string): Pick<Bug, 'head' | 'words'> {
	const toPlay = game.sides.reduce((n, s) => n + s.starters - s.played, 0);
	const starters = game.sides.reduce((n, s) => n + s.starters, 0);
	if (game.state === 'final') return { head: HOME.final, words: '' };
	if (game.state === 'playing') {
		return {
			head: HOME.playing,
			words: `${String(toPlay)} of ${String(starters)} starters to play`
		};
	}
	return {
		head: game.next_kickoff === null ? '' : weekdayTime(game.next_kickoff, zone),
		words: game.next_kickoff === null ? '' : HOME.nextKickoff
	};
}

/** Every game of the week as a score bug, the drafter's first. */
export function bugsOf(
	board: Scoreboard,
	sync: Pick<LeagueSync, 'teams' | 'me'>,
	zone: string = memberZone()
): Bug[] {
	const teams = new Map(sync.teams.map((t) => [t.roster_id, t] as const));
	return board.games.map((game, i) => {
		const mine = game.sides.some((s) => s.roster_id === sync.me);
		return {
			key: `${String(i)}-${game.sides.map((s) => String(s.roster_id)).join('-')}`,
			mine,
			state: game.state,
			...bugHead(game, zone),
			sides: game.sides.map((side) => {
				const team = teams.get(side.roster_id);
				const started = game.state !== 'upcoming';
				return {
					rosterId: side.roster_id,
					name: team?.name ?? `Team ${String(side.roster_id)}`,
					record: bugRecord(team),
					avatar: team?.avatar ?? null,
					me: side.roster_id === sync.me,
					proj: side.projection === null ? BOX.none : fixed(side.projection, 1),
					pts: started && side.points_read ? fixed(side.points, 1) : BOX.none,
					stands: standsOf(game, side)
				};
			})
		};
	});
}

/** Each team's projection this week, by roster, from the scoreboard. */
export function projections(board: Scoreboard | null): ReadonlyMap<number, number | null> {
	return new Map(
		(board?.games ?? []).flatMap((g) => g.sides.map((s) => [s.roster_id, s.projection] as const))
	);
}

// ---- the drafter's lineup

/** The drafter's lineup on the League page: the advice (its swaps and what they add), the starters
 * as the platform has them set, their totals, and the bench as a count. */
export interface LineupSummary {
	box: LineupBox;
	starters: BoxStarter[];
	totals: BoxTotals;
	benchWords: string;
}

/** The lineup as set from the Lineup's answer: each slot's player on the platform, in the league's
 * slots; every other active player is the bench, injured reserve counted apart. */
export function lineupSummary(advice: LineupAdvice, zone: string = memberZone()): LineupSummary {
	const box = lineupBox(advice, zone);
	const starters = advice.slots.flatMap((slot): BoxStarter[] =>
		slot.host ? [{ row: boxRow(slot.host, slotWord(slot.slot), zone, false) }] : []
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
			note: null
		},
		benchWords
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
export type StandingsKey = 'rank' | 'record' | 'pf' | 'pa' | 'proj' | 'waiver';

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

const KIND_WORDS: Readonly<Record<LeagueMove['kind'], string>> = {
	add: 'Free agent',
	waiver: 'Waiver',
	trade: 'Trade'
};

/** A move that only lets a player go. */
const DROP_WORD = 'Drop';

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
		out.push({ label: 'Waivers', value: 'Waiver order' });
	}
	if (terms.playoff_teams !== null) {
		out.push({
			label: 'Playoffs',
			value: `${String(terms.playoff_teams)} teams${weeksWords(terms.playoff_weeks)}`
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

/** What the standings' numbers are, said once: the order, PF and PA, the streak, the waiver column. */
export function standingsBasis(
	host: LeagueHost,
	terms: Pick<LeagueTerms, 'waivers' | 'waiver_budget'>
): string {
	const platform = hostWords(host);
	const waiver =
		terms.waivers === 'budget'
			? ` ${HOME.budget} is each team's waiver budget left${terms.waiver_budget === null ? '' : ` of $${terms.waiver_budget.toLocaleString('en-US')}`}.`
			: terms.waivers === 'order'
				? ` ${HOME.order} is each team's place in ${platform}'s waiver order.`
				: '';
	return `Standings follow ${platform}'s record, then points for. ${HOME.pointsFor} and ${HOME.pointsAgainst} are points for and against in this league's scoring, ${HOME.streak} the current run of wins or losses.${waiver}`;
}

/** What a team's Proj and Pts are on the scoreboard and in the standings. */
export function teamBasis(
	host: LeagueHost,
	readAt: string | null,
	scoring: ProjectionScoring,
	zone: string = memberZone()
): string {
	const platform = hostWords(host);
	const format =
		scoring.format === 'half_ppr' ? 'half-PPR' : scoring.format === 'ppr' ? 'PPR' : 'standard';
	const whose = scoring.league_own
		? "this league's own"
		: "the closest match to this league's rules";
	const when =
		readAt === null
			? 'not in yet for this week'
			: `read ${weekdayTime(readAt, zone)} ${zoneWord(zone)}`;
	return `A team's ${BOX.proj} adds its starters as set on ${platform}, each this week's published projection in ${format} scoring, ${whose}, ${when}. ${BOX.pts} are ${platform}'s points so far this week.`;
}
