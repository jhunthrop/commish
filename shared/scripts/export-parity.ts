/** What the web's own readers draw from the shared fixtures, as JSON the apps' tests hold their ports
 * to: the League home's score bugs, standings, moves feed and bases (web/src/lib/league/home/home.ts)
 * at each fixture clock, in the fixture's zone, and every lineup line's and scoreboard game's state
 * (game-state-parity.ts), which the API's own test holds its wire field to. An app that ports a reader (plan 2026-10-24 Global
 * Constraints: no screen computes game state once the API serves it, until then it ports the web's
 * reader) asserts its output equals this file, so a change to the web's words or rules fails the
 * app's test until the port follows.
 *
 *   node shared/scripts/export-parity.ts
 *
 * It reads the committed fixtures (export-fixtures.ts writes them; check-gen holds both). */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPOSITORY, generatedBy, writeOutputs, type Outputs } from './generated.ts';
import { BOX } from '../../web/src/lib/league/box/box.ts';
import { fixed } from '../../web/src/lib/format/number.ts';
import {
	bugsFinalNone,
	bugsMissListedFinal,
	bugsOf,
	bugsPlayingListed,
	feedRows,
	playoffRule,
	projections,
	recordCell,
	seedingWords,
	standingsBasis,
	standingsRows,
	teamBasis,
	unlistedDrawn,
	waiverCell
} from '../../web/src/lib/league/home/home.ts';
import { leagueWeekParts, weekBasisText } from '../../web/src/lib/league/home/week-basis.ts';
import type { LeagueSync } from '../../web/src/lib/league/api.ts';
import {
	LEAGUE_PHASES,
	PHONE_RAIL_ITEMS,
	RAIL_FOOT,
	railKey,
	railPhase,
	type SitePhase
} from '../../web/src/lib/ui/nav.ts';
import { RAIL_WITHOUT_LEAGUE, railFor, railShown } from '../../web/src/lib/ui/rail-order.ts';
import { leagueLine, phaseWords } from '../../web/src/lib/context/menu-words.ts';
import type { ContextLeague } from '../../web/src/lib/context/words.ts';
import { followedName } from '../../web/src/lib/league/names.ts';
import { CARD, unreadBasis } from '../../web/src/lib/player/card.ts';
import { railItemLabel } from '../../web/src/lib/run/week-names.ts';
import type { Scoreboard } from '../../web/src/lib/league/inseason/api.ts';
import {
	GAME_STATE_OUTPUT,
	lineRows,
	renderGameState,
	scoreboardRows,
	type GameStateRow
} from './game-state-parity.ts';

const SCRIPT = 'shared/scripts/export-parity.ts';
export const OUTPUT = 'shared/fixtures/parity/league-home.json';
export const RAIL_OUTPUT = 'shared/fixtures/parity/phone-rail.json';
export const SHELL_OUTPUT = 'shared/fixtures/parity/shell.json';
/** The site's own seasons (GET /season's phase), each read with no league followed. */
export const SITE_PHASES: readonly SitePhase[] = [
	'preseason',
	'in_season',
	'playoffs',
	'offseason'
];
/** A week the season has named: the in-season rails' week item says Rankings then. */
const NAMED_WEEK = 7;
const INSEASON = 'shared/fixtures/inseason';
const LEAGUE = '6f1d1c52-2626-4a26-9a26-000000000026';
/** The fixture's zone: its clocks are named on Central time (shared/fixtures/README.md). */
export const ZONE = 'America/Chicago';
/** Every scoreboard clock the fixtures carry, as its file names it. */
export const CLOCKS = [
	'2026-10-16T02-00-00Z',
	'2026-10-17T17-00-00Z',
	'2026-10-18T18-56-00Z',
	'2026-10-19T16-00-00Z',
	'2026-10-20T00-40-00Z',
	'2026-10-20T17-00-00Z'
] as const;

/** A file name's clock as an instant: `2026-10-17T17-00-00Z` as `2026-10-17T17:00:00.000Z`. */
export function instantOf(clock: string): string {
	return clock.replace(/T(\d\d)-(\d\d)-(\d\d)Z$/, 'T$1:$2:$3.000Z');
}

const figure = (value: number | null): string => (value === null ? BOX.none : fixed(value, 1));

/** The League home at one clock: the score bugs, the standings rows as a phone draws them, the team
 * basis whole and the page's basis paragraph as a phone says it (with no Lineup read, so no Game
 * sentence), each exactly as the web's readers give them. */
export function homeAt(sync: LeagueSync, board: Scoreboard, now: string): unknown {
	const at = Date.parse(now);
	const bugs = bugsOf(board, sync, at, ZONE, {
		host: sync.host,
		readAt: board.read_at
	});
	const started = bugs.some((b) => b.state !== 'upcoming');
	return {
		now,
		bugs: bugs.map((b) => ({
			mine: b.mine,
			state: b.state,
			head: b.head,
			words: b.words,
			small: b.columns.small,
			big: b.columns.big,
			sides: b.sides.map((s) => ({
				name: s.name,
				record: s.record,
				me: s.me,
				small: s.small,
				big: s.big,
				toPlay: s.toPlay,
				stands: s.stands
			}))
		})),
		standings: standingsRows(sync, projections(board, at)).map((r) => ({
			rank: r.rank,
			team: r.team.name,
			record: recordCell(r.team),
			pointsFor: fixed(r.team.points_for, 1),
			pointsAgainst: figure(r.team.points_against),
			streak: r.team.streak ?? '',
			waiver: waiverCell(r.team, sync.terms),
			proj: figure(r.proj),
			me: r.me
		})),
		teamBasis: teamBasis(
			sync.host,
			board.projection_read_at,
			board.projection_scoring,
			false,
			ZONE,
			started,
			bugsMissListedFinal(bugs),
			bugsPlayingListed(bugs),
			bugsFinalNone(bugs),
			unlistedDrawn(bugs)
		),
		phoneBasis: weekBasisText(
			leagueWeekParts({
				sync,
				scoreboard: board,
				playerPoints: false,
				gameLines: null,
				bugs,
				now: at,
				zone: ZONE
			}),
			'phone'
		)
	};
}

/** The parity file from the league's sync answer and its scoreboard answers by clock. */
export function renderParity(sync: LeagueSync, boards: ReadonlyMap<string, Scoreboard>): string {
	const clocks = Object.fromEntries(
		[...boards].map(([clock, board]) => [clock, homeAt(sync, board, instantOf(clock))])
	);
	const parity = {
		about: generatedBy(SCRIPT, 'web/src/lib/league/home/home.ts over shared/fixtures/inseason'),
		zone: ZONE,
		league: sync.id,
		clocks,
		moves: feedRows(sync, ZONE).map((r) => ({
			when: r.when,
			kind: r.kind,
			teams: r.teams.map((t) => t.name),
			adds: r.adds.map((p) => ({
				name: p.name,
				position: p.position,
				club: p.club,
				to: p.to
			})),
			drops: r.drops.map((p) => ({
				name: p.name,
				position: p.position,
				club: p.club
			})),
			detail: r.detail,
			mine: r.mine
		})),
		playoffRule: playoffRule(sync.terms, sync.teams.length),
		seeding: seedingWords(sync.terms, sync.host),
		standingsBasis: standingsBasis(sync.host, sync.terms)
	};
	return `${JSON.stringify(parity, null, '\t')}\n`;
}

interface PhoneItem {
	key: string;
	label: string;
}

const phoneFive = (
	items: readonly { key: string; label: string; wideOnly: boolean }[]
): PhoneItem[] =>
	items
		.filter((item) => !item.wideOnly)
		.slice(0, PHONE_RAIL_ITEMS)
		.map((item) => ({ key: item.key, label: railItemLabel(item, NAMED_WEEK) }));

/** The phone's bottom bar for each phase of a followed league (web/src/lib/ui/rail-order.ts railFor),
 * the playoffs with waivers open and closed, the bar with no league followed, and that bar by the
 * site's own season (GET /season: the draft's bar before the season and after it, the season's bar
 * without a league in it, railShown), as the web draws them with the season's week named, and the
 * account's way in by its label. The apps' bars are held to it. */
export function renderRail(): string {
	const phases = Object.fromEntries(
		LEAGUE_PHASES.flatMap((phase) =>
			phase === 'playoffs'
				? [
						['playoffs', phoneFive(railFor(phase, false))],
						['playoffs_waivers', phoneFive(railFor(phase, true))]
					]
				: [[phase, phoneFive(railFor(phase, true))]]
		)
	);
	const rail = {
		about: generatedBy(SCRIPT, 'web/src/lib/ui/rail-order.ts'),
		phases,
		withoutLeague: phoneFive(RAIL_WITHOUT_LEAGUE),
		withoutLeagueBySeason: Object.fromEntries(
			SITE_PHASES.map((season) => [
				season,
				phoneFive(railShown(railKey(railPhase(null, season)), false))
			])
		),
		account: { key: RAIL_FOOT.key, label: RAIL_FOOT.label }
	};
	return `${JSON.stringify(rail, null, '\t')}\n`;
}

/** A followed league as the switch reads it: the attached league's id, name, platform, phase and
 * draft time. */
type SwitchLeague = Pick<ContextLeague, 'id' | 'name' | 'host' | 'phase' | 'draft_at'>;

/** The switch's clocks: the fixture's week (a draft today, one in four days), its Thursday night (a
 * draft in two days), its Tuesday (a draft tomorrow, one under way), and nine days before a draft
 * (named by its date). */
const SWITCH_NOWS = [
	'2026-10-17T17:00:00.000Z',
	'2026-10-16T02:00:00.000Z',
	'2026-10-20T17:00:00.000Z',
	'2026-10-12T17:00:00.000Z'
] as const;

/** The leagues the switch is held on: the fixture account's twelve, one more before a draft with no
 * time and no name read yet (its platform names it), and the season's seven alone (one phase, so no
 * phase words). */
function switchSets(attached: readonly SwitchLeague[]): Record<string, readonly SwitchLeague[]> {
	const unnamed: SwitchLeague = {
		id: '6f1d1c52-2626-4a26-9a26-000000000099',
		name: '',
		host: 'yahoo',
		phase: 'pre_draft',
		draft_at: null
	};
	return {
		account: attached,
		withUnnamed: [...attached, unnamed],
		oneSeason: attached.filter((league) => league.phase === 'in_season')
	};
}

/** The line under a league in the switch (context/menu-words.ts leagueLine) for every platform, every
 * scoring preset and both the boards a league can read on that change it (PPR, superflex). */
function switchLines(): { host: string; scoring: string; format: string; line: string }[] {
	const hosts = ['sleeper', 'mfl', 'ffpc', 'yahoo', 'espn'] as const;
	const scorings = ['ppr', 'half_ppr', 'standard', 'te_premium'] as const;
	const formats = ['ppr', 'superflex'] as const;
	return hosts.flatMap((host) =>
		scorings.flatMap((scoring) =>
			formats.map((format) => ({
				host,
				scoring,
				format,
				line: leagueLine({ host, scoring, format } as ContextLeague)
			}))
		)
	);
}

/** The league switch as the web's menu words it (context/menu-words.ts phaseWords, league/names.ts
 * followedName) for each set of leagues at each clock in the fixture's zone, and the player shelf's
 * basis line while his week is read (player/card.ts unreadBasis, the shelf's words as it opens). */
export function renderShell(attached: readonly SwitchLeague[]): string {
	const sets = switchSets(attached);
	const cases = Object.entries(sets).flatMap(([set, leagues]) =>
		SWITCH_NOWS.map((now) => ({
			set,
			now,
			leagues: leagues.map((league) => ({
				id: league.id,
				name: league.name,
				host: league.host,
				phase: league.phase,
				draft_at: league.draft_at
			})),
			names: Object.fromEntries(leagues.map((league) => [league.id, followedName(league)])),
			phases: Object.fromEntries(
				phaseWords(leagues as readonly ContextLeague[], new Date(now), ZONE)
			)
		}))
	);
	const shell = {
		about: generatedBy(
			SCRIPT,
			'web/src/lib/context/menu-words.ts and web/src/lib/player/card.ts over shared/fixtures/inseason'
		),
		zone: ZONE,
		cases,
		lines: switchLines(),
		sheetLoading: unreadBasis(false, CARD.proj)
	};
	return `${JSON.stringify(shell, null, '\t')}\n`;
}

async function answer<T>(file: string): Promise<T> {
	const text = await readFile(join(REPOSITORY, INSEASON, file), 'utf8');
	return (JSON.parse(text) as { data: T }).data;
}

/** The fixture answer a route names at a clock, as the game-state rows cite it. */
const sourceOf = (route: 'lineup' | 'scoreboard', clock: string) => ({
	route: `GET /leagues/attached/${LEAGUE}/${route}`,
	clock: instantOf(clock),
	fixture: `${INSEASON}/${route}-${LEAGUE}-${clock}.json`
});

/** Every lineup line and scoreboard game at every clock, by the web's game-state readers. */
async function gameStateRows(boards: ReadonlyMap<string, Scoreboard>): Promise<GameStateRow[]> {
	const rows: GameStateRow[] = [];
	for (const clock of CLOCKS) {
		const lineup = sourceOf('lineup', clock);
		rows.push(...lineRows(lineup, await answer<unknown>(`lineup-${LEAGUE}-${clock}.json`)));
		const board = boards.get(clock);
		if (board !== undefined) rows.push(...scoreboardRows(sourceOf('scoreboard', clock), board));
	}
	return rows;
}

export async function generate(): Promise<Outputs> {
	const sync = await answer<LeagueSync>(`leagues-attached-${LEAGUE}.json`);
	const boards = new Map<string, Scoreboard>();
	for (const clock of CLOCKS)
		boards.set(clock, await answer<Scoreboard>(`scoreboard-${LEAGUE}-${clock}.json`));
	const about = generatedBy(
		SCRIPT,
		'web/src/lib/league/box/kickoff.ts (lineState, gameHead) over shared/fixtures/inseason'
	);
	return new Map([
		[OUTPUT, renderParity(sync, boards)],
		[RAIL_OUTPUT, renderRail()],
		[SHELL_OUTPUT, renderShell(await answer<SwitchLeague[]>('leagues-attached.json'))],
		[GAME_STATE_OUTPUT, renderGameState(about, await gameStateRows(boards))]
	]);
}

if (import.meta.main) await writeOutputs(await generate());
