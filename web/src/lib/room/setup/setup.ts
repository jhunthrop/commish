/** The setup page's league: the defaults, the bounds the API checks (api/internal/leagues), the round
 * count the roster makes, and the lobby closest to it. */
import type { LeagueSettings, LobbyFormat } from '../api.ts';
import { presetWords } from '../words.ts';

type Roster = LeagueSettings['roster'];
type Preset = NonNullable<LeagueSettings['scoring']['preset']>;

export const SCORING_CHOICES: readonly { preset: Preset; label: string }[] = [
	{ preset: 'ppr', label: 'PPR' },
	{ preset: 'half_ppr', label: 'Half PPR' },
	{ preset: 'standard', label: 'Standard' },
	{ preset: 'te_premium', label: 'TE premium' }
];

export const TEAM_CHOICES: readonly number[] = [8, 10, 12, 14];

export const LINEUP_CHOICES: readonly { lineup: LeagueSettings['lineup']; label: string }[] = [
	{ lineup: 'standard', label: 'Standard' },
	{ lineup: 'superflex', label: 'Superflex' },
	{ lineup: 'two_flex', label: '2 flex' }
];

/** Each roster count's label and its bounds, matching openapi.yaml's RosterCounts. */
export const ROSTER_FIELDS: readonly { key: keyof Roster; label: string; max: number }[] = [
	{ key: 'qb', label: 'QB', max: 4 },
	{ key: 'rb', label: 'RB', max: 6 },
	{ key: 'wr', label: 'WR', max: 6 },
	{ key: 'te', label: 'TE', max: 4 },
	{ key: 'k', label: 'K', max: 2 },
	{ key: 'dst', label: 'D/ST', max: 2 },
	{ key: 'bench', label: 'Bench', max: 15 }
];

/** The draft's round bounds (api/internal/leagues). */
export const MIN_ROUNDS = 8;
export const MAX_ROUNDS = 25;

export function defaultSettings(): LeagueSettings {
	return {
		scoring: { preset: 'ppr', custom: null },
		teams: 12,
		slot: null,
		roster: { qb: 1, rb: 2, wr: 2, te: 1, k: 1, dst: 1, bench: 6 },
		lineup: 'standard',
		keepers: [],
		bot_style: 'adp'
	};
}

/** The flex spots a lineup adds: standard one, superflex a flex and a superflex, two flex two. */
export function flexSpots(lineup: LeagueSettings['lineup']): number {
	return lineup === 'standard' ? 1 : 2;
}

/** Every roster spot, flex included: the draft's round count. */
export function roundsOf(s: LeagueSettings): number {
	const r = s.roster;
	return r.qb + r.rb + r.wr + r.te + r.k + r.dst + r.bench + flexSpots(s.lineup);
}

/** The lobby a league is nearest: ten teams draft in the ten-team room, superflex in the superflex one. */
export function nearestLobby(s: LeagueSettings): LobbyFormat {
	if (s.lineup === 'superflex') return '12_half_superflex';
	if (s.teams <= 10) return '10_ppr';
	return '12_ppr';
}

/** "12 teams, PPR" for a lobby format. */
export function lobbyTitle(
	teams: number,
	scoring: Preset,
	lineup: LeagueSettings['lineup']
): string {
	return `${teams} teams, ${presetWords(scoring)}${lineup === 'superflex' ? ', superflex' : ''}`;
}
