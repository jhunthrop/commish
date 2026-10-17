// The League page's fields of the sync answer (Lane 66i), read from the recorded Sleeper league as
// the API reads them (api/internal/leaguesync sleeper.go and terms.go): each team's points against,
// streak ("3W" written "W3"), waiver order, budget left of the league's FAAB budget and avatar; each
// claim's bid; the league's terms, its scoring as ScoringRules with the rules it does not carry in
// the API's words (scoring/sleeper_labels.go). build.ts writes them with the rest of the answer;
// league.ts writes them onto a fixture built before them.
import { readFile } from 'node:fs/promises';
import type { components } from '../../src/lib/api/types.ts';
import type { LeagueSync } from '../../src/lib/league/api.ts';

type ScoringRules = components['schemas']['ScoringRules'];
type DroppedRule = components['schemas']['DroppedRule'];
type LeagueTeam = LeagueSync['teams'][number];
export type TeamFields = Pick<
	LeagueTeam,
	'points_against' | 'streak' | 'waiver_order' | 'waiver_budget_left' | 'avatar'
>;

const REPLAY = new URL('../../../api/internal/leaguesync/replay/sleeper/', import.meta.url);
const SLEEPER_AVATARS = 'https://sleepercdn.com/avatars/thumbs/';
const HUNDREDTH = 100;
/** Sleeper's waiver type of a season budget (settings.waiver_type). */
const BUDGET = 2;
/** The weeks the playoffs take by Sleeper's round type: a week a round, a two-week final, two weeks
 * a round. */
const PLAYOFF_WEEKS: Readonly<Record<number, (rounds: number) => number>> = {
	0: (r) => r,
	1: (r) => r + 1,
	2: (r) => r * 2
};

interface Roster {
	roster_id: number;
	owner_id: string;
	settings: {
		fpts_against?: number;
		fpts_against_decimal?: number;
		waiver_position?: number;
		waiver_budget_used?: number;
	};
	metadata: { streak?: string } | null;
}
interface User {
	user_id: string;
	avatar: string | null;
}
interface Move {
	status: string;
	created: number;
	settings: { waiver_bid?: number } | null;
}
interface League {
	league_id: string;
	roster_positions: string[];
	scoring_settings: Record<string, number>;
	settings: {
		waiver_type: number;
		waiver_budget: number;
		playoff_teams: number;
		playoff_week_start: number;
		playoff_round_type: number;
	};
}

async function json<T>(name: string): Promise<T> {
	return JSON.parse(await readFile(new URL(name, REPLAY), 'utf8')) as T;
}

/** The league's rules ScoringRules does not carry, in the API's words. */
const EXTRA: readonly (readonly [string, DroppedRule['group'], string])[] = [
	['fum_rec_td', 'offense', 'fumble recovered for a touchdown'],
	['blk_kick', 'defense', 'blocked kick'],
	['ff', 'defense', 'forced fumble'],
	['def_st_ff', 'defense', 'forced fumble on defense or special teams'],
	['def_st_fum_rec', 'defense', 'fumble recovery on defense or special teams'],
	['st_ff', 'defense', 'special teams forced fumble'],
	['st_fum_rec', 'defense', 'special teams fumble recovery'],
	['st_td', 'defense', 'special teams touchdown'],
	['def_st_td', 'defense', 'touchdown on defense or special teams']
];

/** The rules the recorded league does not state, as the API names them
 * (TestTermsNameTheRulesThePlatformDoesNotState), and the standard figure it holds the one at. */
const UNSTATED = ['points_per_return_touchdown'] as const;
const STANDARD_RETURN_TOUCHDOWN = 6;

/** Every yards-allowed tier: Sleeper scores none, so each is 0. */
const NO_YARDS_TIERS = {
	yards_allowed_0_99: 0,
	yards_allowed_100_199: 0,
	yards_allowed_200_299: 0,
	yards_allowed_300_349: 0,
	yards_allowed_350_399: 0,
	yards_allowed_400_449: 0,
	yards_allowed_450_499: 0,
	yards_allowed_500_549: 0,
	yards_allowed_550_plus: 0
} as const;

function scoringOf(sc: Record<string, number>): ScoringRules {
	const rule = (key: string): number => sc[key] ?? 0;
	return {
		points_per_passing_yard: rule('pass_yd'),
		points_per_passing_touchdown: rule('pass_td'),
		points_per_interception: rule('pass_int'),
		points_per_rushing_yard: rule('rush_yd'),
		points_per_rushing_touchdown: rule('rush_td'),
		points_per_receiving_yard: rule('rec_yd'),
		points_per_receiving_touchdown: rule('rec_td'),
		points_per_reception: rule('rec'),
		points_per_fumble_lost: rule('fum_lost'),
		te_reception_bonus: rule('bonus_rec_te'),
		points_per_field_goal: rule('fgm_30_39'),
		points_per_extra_point: rule('xpm'),
		points_per_sack: rule('sack'),
		points_per_defensive_interception: rule('int'),
		points_per_defensive_touchdown: rule('def_td'),
		points_per_two_point_conversion: rule('pass_2pt'),
		points_per_field_goal_missed: rule('fgmiss'),
		points_per_extra_point_missed: rule('xpmiss'),
		// The league scores special teams touchdowns, not a player's return touchdowns: the API holds
		// this rule at the standard figure and names it unstated.
		points_per_return_touchdown: STANDARD_RETURN_TOUCHDOWN,
		points_per_defensive_fumble_recovery: rule('fum_rec'),
		points_per_safety: rule('safe'),
		points_per_field_goal_40_49: rule('fgm_40_49'),
		points_per_field_goal_50_plus: rule('fgm_50p'),
		points_allowed_0: rule('pts_allow_0'),
		points_allowed_1_6: rule('pts_allow_1_6'),
		points_allowed_7_13: rule('pts_allow_7_13'),
		points_allowed_14_17: rule('pts_allow_14_20'),
		points_allowed_18_20: rule('pts_allow_14_20'),
		points_allowed_21: rule('pts_allow_21_27'),
		points_allowed_22_27: rule('pts_allow_21_27'),
		points_allowed_28_34: rule('pts_allow_28_34'),
		points_allowed_35_45: rule('pts_allow_35p'),
		points_allowed_46_plus: rule('pts_allow_35p'),
		...NO_YARDS_TIERS
	};
}

function termsOf(league: League): LeagueSync['terms'] {
	const s = league.settings;
	const count = (slot: string): number => league.roster_positions.filter((p) => p === slot).length;
	const rounds = Math.ceil(Math.log2(s.playoff_teams));
	const weeks = (PLAYOFF_WEEKS[s.playoff_round_type] ?? PLAYOFF_WEEKS[0] ?? ((r: number) => r))(
		rounds
	);
	const sc = league.scoring_settings;
	return {
		waivers: s.waiver_type === BUDGET ? 'budget' : 'order',
		waiver_budget: s.waiver_type === BUDGET ? s.waiver_budget : null,
		playoff_teams: s.playoff_teams,
		playoff_weeks: { first: s.playoff_week_start, last: s.playoff_week_start + weeks - 1 },
		roster: {
			qb: count('QB'),
			rb: count('RB'),
			wr: count('WR'),
			te: count('TE'),
			flex: count('FLEX'),
			super_flex: count('SUPER_FLEX'),
			k: count('K'),
			def: count('DEF'),
			bench: count('BN')
		},
		scoring: scoringOf(sc),
		scoring_unstated: [...UNSTATED],
		scoring_extra: EXTRA.filter(([k]) => (sc[k] ?? 0) !== 0).map(([k, group, rule]) => ({
			group,
			rule,
			points: sc[k] ?? 0
		})),
		host_settings_url: `https://sleeper.com/leagues/${league.league_id}`
	};
}

function streakOf(s: string | undefined): string | null {
	return s && /^[1-9]\d?[WL]$/.test(s) ? `${s.slice(-1)}${s.slice(0, -1)}` : null;
}

/** The recorded league's fields: a team's by its roster, a move's bid by its time, the terms. */
export async function leagueFields(): Promise<{
	team: (rosterId: number) => TeamFields;
	bid: (createdMs: number) => number | null;
	terms: LeagueSync['terms'];
}> {
	const [league, rosters, users, moves] = await Promise.all([
		json<League>('league.json'),
		json<Roster[]>('rosters.json'),
		json<User[]>('users.json'),
		json<Move[]>('transactions_last.json')
	]);
	const avatars = new Map(users.map((u) => [u.user_id, u.avatar] as const));
	const byRoster = new Map(rosters.map((r) => [r.roster_id, r] as const));
	const bids = new Map(
		moves.flatMap((m) =>
			m.status === 'complete' && m.settings?.waiver_bid !== undefined
				? [[m.created, m.settings.waiver_bid] as const]
				: []
		)
	);
	const s = league.settings;
	return {
		team: (rosterId) => {
			const r = byRoster.get(rosterId);
			if (!r) throw new Error(`No recorded roster ${String(rosterId)}.`);
			const f = r.settings;
			const avatar = avatars.get(r.owner_id) ?? null;
			return {
				points_against:
					Math.round(
						((f.fpts_against ?? 0) + (f.fpts_against_decimal ?? 0) / HUNDREDTH) * HUNDREDTH
					) / HUNDREDTH,
				streak: streakOf(r.metadata?.streak),
				waiver_order: f.waiver_position && f.waiver_position > 0 ? f.waiver_position : null,
				waiver_budget_left:
					s.waiver_type === BUDGET
						? Math.max(s.waiver_budget - (f.waiver_budget_used ?? 0), 0)
						: null,
				avatar: avatar ? `${SLEEPER_AVATARS}${avatar}` : null
			};
		},
		bid: (createdMs) => bids.get(createdMs) ?? null,
		terms: termsOf(league)
	};
}
