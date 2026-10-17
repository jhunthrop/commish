/** The setup page's league: the defaults, the bounds the API checks (api/internal/leagues), the round
 * count the roster makes, and the lobby closest to it. */
import type { BoardFormat } from '#lib/sheet/model.ts';
import type { FactCell } from '#lib/ui/facts.ts';
import type { LeagueSettings, LobbyFilling, LobbyFormat } from '../api.ts';
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
/** The most teams a league holds (api/internal/leagues MaxTeams). */
export const MAX_TEAMS = 14;

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

/** The setup in the site's format with no league selected: a scoring board sets the scoring, the
 * superflex board the lineup; any other format (or none) leaves the setup as it is. */
export function inFormat(settings: LeagueSettings, format: BoardFormat | null): LeagueSettings {
	switch (format) {
		case 'ppr':
		case 'half_ppr':
		case 'standard':
			return { ...settings, scoring: { preset: format, custom: null } };
		case 'superflex':
			return { ...settings, lineup: 'superflex' };
		default:
			return settings;
	}
}

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

/** A lobby starts this long after its first drafter joins, bots in the open seats (lobby.FillWindow). */
export const LOBBY_FILL_SECONDS = 90;

type Lineup = LeagueSettings['lineup'];

/** The FLEX spots a lineup has: two in two flex, one otherwise. */
export function flexCount(lineup: Lineup): number {
	return lineup === 'two_flex' ? 2 : 1;
}

/** The superflex spots a lineup has: one in superflex, none otherwise. */
export function superflexCount(lineup: Lineup): number {
	return lineup === 'superflex' ? 1 : 0;
}

/** The FLEX stepper's bounds: a superflex lineup keeps its one FLEX, the others step from one to two. */
export function flexMax(lineup: Lineup): number {
	return lineup === 'superflex' ? 1 : 2;
}

/** The lineup a FLEX count makes: two FLEX is two flex, one is standard (or superflex, kept). */
export function lineupForFlex(lineup: Lineup, flex: number): Lineup {
	if (flex >= 2) return 'two_flex';
	return lineup === 'two_flex' ? 'standard' : lineup;
}

/** The lineup a superflex count makes: one is superflex (with one FLEX), none is standard. */
export function lineupForSuperflex(superflex: number): Lineup {
	return superflex >= 1 ? 'superflex' : 'standard';
}

/** The flex spots a lineup adds: standard one, superflex a flex and a superflex, two flex two. */
export function flexSpots(lineup: Lineup): number {
	return flexCount(lineup) + superflexCount(lineup);
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

/** The setup as a settings table (Lane 66o), where three sentences once said the clocks and the
 * lobby: the format, the teams, your seat, the rounds, no clock against bots, the nearest lobby's
 * clock as the API gives it (left out until the lobbies are read), and when a lobby starts. */
export function setupCells(
	s: LeagueSettings,
	rounds: number,
	lobby: Pick<LobbyFilling, 'clock_seconds'> | undefined
): FactCell[] {
	const lobbyClock: FactCell[] = lobby
		? [{ label: 'Clock in a lobby', value: `${String(lobby.clock_seconds)} s a pick`, word: true }]
		: [];
	return [
		{ label: 'Format', value: formatWords(s), word: true },
		{ label: 'Teams', value: String(s.teams) },
		{
			label: 'Your seat',
			value: s.slot === null ? 'Random' : String(s.slot),
			word: s.slot === null
		},
		{ label: 'Rounds', value: String(rounds) },
		{ label: 'Clock against bots', value: 'None', word: true },
		...lobbyClock,
		{
			label: 'A lobby starts',
			value: `Full or ${String(LOBBY_FILL_SECONDS)} s`,
			word: true
		}
	];
}

/** "PPR", "Half PPR, superflex". */
function formatWords(s: LeagueSettings): string {
	const scoring = s.scoring.preset ? presetWords(s.scoring.preset) : 'Your scoring';
	const lineup = LINEUP_CHOICES.find((c) => c.lineup === s.lineup && c.lineup !== 'standard');
	const said = lineup ? `${scoring}, ${lineup.label.toLowerCase()}` : scoring;
	return said.charAt(0).toUpperCase() + said.slice(1);
}

/** "12 teams, PPR" for a lobby format. */
export function lobbyTitle(
	teams: number,
	scoring: Preset,
	lineup: LeagueSettings['lineup']
): string {
	return `${teams} teams, ${presetWords(scoring)}${lineup === 'superflex' ? ', superflex' : ''}`;
}
