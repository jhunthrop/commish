// The fixture account's leagues, one per season phase (spec 2026-10-16 §1), so the shell's rails, the
// switch's phase words and the league page's states can be built and shot before the API's phase
// lands (Lane 53). The in-season league is the recorded Sleeper league; the others are stand-ins of it
// under their own names, each read as its phase would be (no matchup before the draft or after the
// season, nobody rostered before the draft). A shot picks the selected league with the
// `fixture_phase` cookie, and `fixture_one` answers that league alone (the switch's leagues agree).
import type { components } from '../../src/lib/api/types.ts';
import type { LeagueSync } from '../../src/lib/league/api.ts';
import { FIXTURE_IDS } from './ids.ts';

type ContextLeague = components['schemas']['ContextLeague'];
type Account = components['schemas']['Account'];

/** The phases a shot can select, the playoffs twice: waivers still run, and the host closed them. */
export const FIXTURE_PHASES = [
	'pre_draft',
	'draft_day',
	'in_season',
	'playoffs',
	'playoffs_closed',
	'offseason'
] as const;
export type FixturePhase = (typeof FIXTURE_PHASES)[number];

export const PHASE_COOKIE = 'fixture_phase';
export const ONE_COOKIE = 'fixture_one';
/** The account may follow many leagues (the many_leagues feature). */
export const MANY_COOKIE = 'fixture_many';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The draft day league drafts this many hours after the read, the pre-draft league this many days. */
const DRAFT_DAY_HOURS = 5;
const PRE_DRAFT_DAYS = 4;
/** The playoff league's playoffs start in the recorded week. */
const PLAYOFF_START = 6;

interface PhaseLeague {
	id: string;
	name: string;
	phase: ContextLeague['phase'];
	basis: string;
	/** Hours from now to the draft, null when the host does not say or the draft is done. */
	draftIn: number | null;
	waiversOpen: boolean;
	playoffStart: number | null;
}

const PHASE_LEAGUES: Readonly<Record<FixturePhase, PhaseLeague>> = {
	pre_draft: {
		id: FIXTURE_IDS.preDraft,
		name: 'Thursday Night Keepers',
		phase: 'pre_draft',
		basis: 'Sleeper says the draft has not started.',
		draftIn: (PRE_DRAFT_DAYS * DAY_MS) / HOUR_MS,
		waiversOpen: true,
		playoffStart: 15
	},
	draft_day: {
		id: FIXTURE_IDS.draftDay,
		name: 'Late Draft League',
		phase: 'draft_day',
		basis: 'Sleeper says the draft starts within a day.',
		draftIn: DRAFT_DAY_HOURS,
		waiversOpen: true,
		playoffStart: 15
	},
	in_season: {
		id: FIXTURE_IDS.league,
		name: '',
		phase: 'in_season',
		basis: 'Sleeper says the season is on, week 6.',
		draftIn: null,
		waiversOpen: true,
		playoffStart: 15
	},
	playoffs: {
		id: FIXTURE_IDS.playoffs,
		name: 'Office Pool',
		phase: 'playoffs',
		basis: 'Sleeper says the playoffs started in week 6.',
		draftIn: null,
		waiversOpen: true,
		playoffStart: PLAYOFF_START
	},
	playoffs_closed: {
		id: FIXTURE_IDS.playoffsClosed,
		name: 'Office Pool Two',
		phase: 'playoffs',
		basis: 'Sleeper says the playoffs started in week 6, with waivers closed.',
		draftIn: null,
		waiversOpen: false,
		playoffStart: PLAYOFF_START
	},
	offseason: {
		id: FIXTURE_IDS.offseason,
		name: 'Family League',
		phase: 'offseason',
		basis: 'Sleeper says the season is complete.',
		draftIn: null,
		waiversOpen: false,
		playoffStart: 15
	}
};

export function isFixturePhase(word: string | undefined): word is FixturePhase {
	return (FIXTURE_PHASES as readonly (string | undefined)[]).includes(word);
}

/** The phase league's fields on a context league, the draft time from the moment of the read. */
function phaseFields(
	league: PhaseLeague,
	now: number
): Pick<
	ContextLeague,
	'phase' | 'phase_basis' | 'draft_at' | 'playoff_start_week' | 'waivers_open'
> {
	return {
		phase: league.phase,
		phase_basis: league.basis,
		draft_at:
			league.draftIn === null ? null : new Date(now + league.draftIn * HOUR_MS).toISOString(),
		playoff_start_week: league.playoffStart,
		waivers_open: league.waiversOpen
	};
}

/** Every phase league as the switch lists it, newest first, the in-season league's own read under
 * the others' names. Before the draft a league has no standing. */
export function phaseLeagues(
	base: Omit<ContextLeague, keyof ReturnType<typeof phaseFields>>,
	now: number
): ContextLeague[] {
	return FIXTURE_PHASES.map((key) => {
		const league = PHASE_LEAGUES[key];
		const drafted = league.phase !== 'pre_draft' && league.phase !== 'draft_day';
		return {
			...base,
			id: league.id,
			name: league.name === '' ? base.name : league.name,
			standing: drafted ? base.standing : null,
			...phaseFields(league, now)
		};
	});
}

/** The fixture's account: the selected phase's league, and every phase league or that one alone. */
export function phaseAccount(
	base: Account,
	leagues: readonly ContextLeague[],
	phase: FixturePhase,
	one: boolean
): Account {
	const selected = leagues.find((league) => league.id === PHASE_LEAGUES[phase].id) ?? null;
	return {
		...base,
		league: selected,
		leagues: one && selected ? [selected] : [...leagues],
		format: selected?.format ?? base.format
	};
}

/** A phase league's read: the recorded league under its name, with no matchup and nobody held
 * before the draft, and no matchup once the season is over. */
export function phaseSync(sync: LeagueSync, id: string): LeagueSync {
	const key = FIXTURE_PHASES.find((phase) => PHASE_LEAGUES[phase].id === id);
	if (key === undefined || key === 'in_season') return sync;
	const league = PHASE_LEAGUES[key];
	const named = { ...sync, id, name: league.name };
	if (league.phase === 'pre_draft' || league.phase === 'draft_day') {
		return {
			...named,
			status: 'pre_draft',
			week: 0,
			teams: sync.teams.map((team) => ({
				...team,
				wins: 0,
				losses: 0,
				ties: 0,
				points_for: 0,
				points_against: null,
				streak: null
			})),
			placement: { ...sync.placement, unplaced: 0 },
			roster: [],
			matchup: null,
			moves: [],
			held_by: {},
			rostered: []
		};
	}
	if (league.phase === 'offseason')
		return { ...named, status: 'complete', matchup: null, moves: [] };
	return named;
}

/** The phase a shot asked for, from the request's cookies: the in-season league by default. */
export function askedPhase(cookie: string | undefined): {
	phase: FixturePhase;
	one: boolean;
	many: boolean;
} {
	const pairs = new Map(
		(cookie ?? '').split('; ').map((pair) => {
			const at = pair.indexOf('=');
			return [pair.slice(0, at), pair.slice(at + 1)] as const;
		})
	);
	const asked = pairs.get(PHASE_COOKIE);
	return {
		phase: isFixturePhase(asked) ? asked : 'in_season',
		one: pairs.get(ONE_COOKIE) === '1',
		many: pairs.get(MANY_COOKIE) === '1'
	};
}

/** The site's season the fixture answers on /me: week 6 of the regular season. */
export const FIXTURE_SEASON: Account['season'] = {
	phase: 'in_season',
	week: 6,
	basis: 'Week 6 of the 2026 season.'
};

/** The variable naming the week the site's board ranks from (board_week) on /me and GET /season
 * (Lane 142): set on a run that ranks from it, so a page the Worker draws names the rail's week
 * order as the run's pages do. Unset, the season answers none, as before. */
export const BOARD_WEEK_VARIABLE = 'FIXTURE_BOARD_WEEK';

/** The fixture's season with the board's week when the variable names one. */
export function fixtureSeason(boardWeek: string | undefined): Account['season'] {
	if (boardWeek === undefined) return FIXTURE_SEASON;
	const week = Number(boardWeek);
	if (!Number.isInteger(week) || week < 1)
		throw new Error(`${BOARD_WEEK_VARIABLE} is not a week: ${boardWeek}`);
	return { ...FIXTURE_SEASON, board_week: week };
}
