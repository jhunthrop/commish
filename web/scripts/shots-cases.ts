// The cases `npm run shots` (shots.ts) runs: each fixture shot script on the run its head names, once
// per clock, state or flag it shoots, with the fixture API started on that clock (Lane 132, B111).
import {
	FIXTURE_LIVE_CLOCK,
	FIXTURE_MONDAY_CLOCK,
	FIXTURE_MONDAY_NIGHT_CLOCK,
	FIXTURE_STATS_CLOCK,
	FIXTURE_SUNDAY_CLOCK,
	FIXTURE_SUNDAY_MORNING_CLOCK,
	FIXTURE_THURSDAY_NIGHT_CLOCK,
	FIXTURE_FRIDAY_CLOCK,
	FIXTURE_TUESDAY_CLOCK,
	FIXTURE_UNREAD_CLOCK,
	FIXTURE_WEEK7_READ_CLOCK,
	FIXTURE_WEEK_CLOCK
} from './inseason-fixture/clock.ts';
import {
	CONTRACT_RUN_ID,
	clubRunId,
	FORMATS_RUN_ID,
	ONE_BOARD_RUN_ID,
	RECORD_LIVE_RUN_ID,
	recordTwoRunId,
	SATURDAY_RUN_ID
} from './inseason-fixture/run-ids.ts';
import { BOARD_WEEK_VARIABLE, FREE_SEASON_VARIABLE } from './inseason-fixture/phases.ts';

/** Environment variables a case or a run sets on a child process. */
export type Vars = Readonly<Record<string, string | undefined>>;

export type RunKey =
	| 'standin'
	| 'contract'
	| 'saturday'
	| 'mover'
	| 'free-agent'
	| 'special-teams'
	| 'oneboard'
	| 'formats'
	| 'record-live'
	| 'two-upcoming'
	| 'two-graded'
	| 'two-published';

interface WriteStep {
	args: readonly string[];
	env?: Vars;
}

export interface ShotRun {
	/** The run's id under web/.runs/runs/. */
	id: string;
	/** A run copied as is, relative to this file. */
	copyFrom?: string;
	/** The repo's writers for the run, each a node script with its arguments. */
	write?: readonly WriteStep[];
	/** The fixture API reads this run's rest of season (FIXTURE_RUN_ID). */
	fixtureRun?: boolean;
	/** The script reads the run itself (PUBLIC_RUN_ID and PUBLIC_RUN_BASE_URL in its environment). */
	scriptRun?: boolean;
}

export const SHOT_RUNS: Readonly<Record<RunKey, ShotRun>> = {
	standin: { id: 'latest', write: [{ args: ['scripts/run-from-mock-data.ts'] }] },
	contract: {
		id: CONTRACT_RUN_ID,
		copyFrom: `../../research/nightly/contract/fixture/runs/${CONTRACT_RUN_ID}/`,
		fixtureRun: true,
		scriptRun: true
	},
	saturday: {
		id: SATURDAY_RUN_ID,
		write: [
			{
				args: ['scripts/inseason-fixture/saturday-run.ts'],
				env: { SATURDAY_OUT: '4429023', SATURDAY_PACE: '1', SATURDAY_READ: '1' }
			}
		],
		fixtureRun: true
	},
	mover: {
		id: clubRunId('mover'),
		write: [{ args: ['scripts/inseason-fixture/mover-run.ts', 'mover'] }],
		fixtureRun: true
	},
	'free-agent': {
		id: clubRunId('free-agent'),
		write: [{ args: ['scripts/inseason-fixture/mover-run.ts', 'free-agent'] }],
		fixtureRun: true
	},
	'special-teams': {
		id: clubRunId('special-teams'),
		write: [{ args: ['scripts/inseason-fixture/mover-run.ts', 'special-teams'] }],
		fixtureRun: true
	},
	oneboard: {
		id: ONE_BOARD_RUN_ID,
		write: [{ args: ['scripts/inseason-fixture/one-board-run.ts'] }],
		fixtureRun: true
	},
	formats: {
		id: FORMATS_RUN_ID,
		write: [
			{ args: ['scripts/inseason-fixture/one-board-run.ts'] },
			{ args: ['scripts/inseason-fixture/one-value-run.ts'] },
			{ args: ['scripts/inseason-fixture/formats-run.ts'] }
		],
		fixtureRun: true
	},
	'record-live': {
		id: RECORD_LIVE_RUN_ID,
		write: [{ args: ['scripts/record-fixture/run.ts', 'live'] }],
		scriptRun: true
	},
	'two-upcoming': {
		id: recordTwoRunId('upcoming'),
		write: [{ args: ['scripts/record-fixture/run.ts', 'two', 'upcoming'] }],
		scriptRun: true
	},
	'two-graded': {
		id: recordTwoRunId('graded'),
		write: [{ args: ['scripts/record-fixture/run.ts', 'two', 'graded'] }],
		scriptRun: true
	},
	'two-published': {
		id: recordTwoRunId('published'),
		write: [{ args: ['scripts/record-fixture/run.ts', 'two', 'published'] }],
		scriptRun: true
	}
};

interface Origins {
	web: string;
	api: string;
	apiPort: number;
	out: string;
}

export interface ShotCase {
	name: string;
	/** The script under web/scripts/, without .ts. */
	script: string;
	run: RunKey;
	/** The fixture API's clock (FIXTURE_CLOCK). */
	clock: string;
	/** The fixture API's other flags. */
	fixture?: Vars;
	/** The script's own environment. */
	env?: Vars;
	args: (o: Origins) => string[];
	/** The script starts the fixture API itself, on the port it is given. */
	ownFixture?: boolean;
	/** The script shoots the dev-only system page from the dev server. */
	dev?: boolean;
}

const plain = (o: Origins): string[] => [o.web, o.out];

/** One case per clock of a script that takes its clock as CLOCK (or STATE). */
function clocked(
	script: string,
	run: RunKey,
	clocks: Readonly<Record<string, string>>,
	extra: {
		variable?: string;
		env?: Vars;
		fixture?: Vars;
		tag?: string;
	} = {}
): ShotCase[] {
	return Object.entries(clocks).map(([day, clock]) => ({
		name: `${script}-${extra.tag ?? ''}${day}`,
		script,
		run,
		clock,
		fixture: extra.fixture,
		env: { ...extra.env, [extra.variable ?? 'CLOCK']: day },
		args: plain
	}));
}

function once(script: string, run: RunKey, clock: string, more: Partial<ShotCase> = {}): ShotCase {
	return { name: script, script, run, clock, args: plain, ...more };
}

const IR_DROP = { FIXTURE_IR_DROP: '1' };
/** The fixture API's season naming the board's week 7, for a run that ranks from it (Lane 142). */
const BOARD_WEEK_7 = { [BOARD_WEEK_VARIABLE]: '7' };

export const SHOT_CASES: readonly ShotCase[] = [
	// The stand-in run.
	once('shelf-shots', 'standin', FIXTURE_WEEK_CLOCK),
	// Lane 158: a player in play with a read, his noon game under way.
	once('shelf-shots', 'standin', FIXTURE_SUNDAY_CLOCK, {
		name: 'shelf-shots-in-play',
		env: { SHELF_IN_PLAY: '1' }
	}),
	// Lane 160: a read withheld for his status, his game final.
	once('shelf-shots', 'standin', FIXTURE_MONDAY_CLOCK, {
		name: 'shelf-shots-after-games',
		env: { SHELF_AFTER_GAMES: '1' }
	}),
	once('player-card-shots', 'standin', FIXTURE_WEEK_CLOCK),
	once('inseason-shots', 'standin', FIXTURE_WEEK_CLOCK),
	// Every league's Lineup on one page and its one verb (Lane 257).
	once('every-lineup-shots', 'contract', FIXTURE_WEEK_CLOCK),
	...clocked('platform-finals-shots', 'standin', {
		saturday: FIXTURE_WEEK_CLOCK,
		sunday: FIXTURE_SUNDAY_MORNING_CLOCK,
		monday: FIXTURE_MONDAY_NIGHT_CLOCK,
		tuesday: FIXTURE_TUESDAY_CLOCK,
		wednesday: FIXTURE_STATS_CLOCK,
		thursday: FIXTURE_WEEK7_READ_CLOCK
	}),
	...clocked(
		'game-state-shots',
		'standin',
		{ sunday: FIXTURE_SUNDAY_CLOCK, monday: FIXTURE_MONDAY_CLOCK, tuesday: FIXTURE_TUESDAY_CLOCK },
		{ env: { SET: 'standin' }, tag: 'standin-' }
	),
	once('standing-shots', 'standin', FIXTURE_WEEK_CLOCK, { name: 'standing-shots-week' }),
	once('standing-shots', 'standin', FIXTURE_LIVE_CLOCK, { name: 'standing-shots-live' }),
	once('standing-shots', 'standin', FIXTURE_TUESDAY_CLOCK, { name: 'standing-shots-tuesday' }),
	...clocked('week-turn-shots', 'standin', {
		saturday: FIXTURE_WEEK_CLOCK,
		'monday-night': FIXTURE_MONDAY_NIGHT_CLOCK
	}),
	once('trades-shots', 'standin', FIXTURE_WEEK_CLOCK),
	...clocked(
		'waiver-gain-shots',
		'standin',
		{ saturday: FIXTURE_WEEK_CLOCK, 'monday-night': FIXTURE_MONDAY_NIGHT_CLOCK },
		{ fixture: IR_DROP }
	),
	once('stash-shots', 'standin', FIXTURE_WEEK_CLOCK, {
		name: 'stash-shots-present',
		fixture: { ...IR_DROP, FIXTURE_IR_SLOT: '1' },
		env: { STASH: 'present' }
	}),
	once('stash-shots', 'standin', FIXTURE_WEEK_CLOCK, {
		name: 'stash-shots-absent',
		env: { STASH: 'absent' }
	}),
	once('stash-shots', 'standin', FIXTURE_MONDAY_NIGHT_CLOCK, {
		name: 'stash-shots-monday-night',
		fixture: { ...IR_DROP, FIXTURE_IR_SLOT: '1' },
		env: { STASH: 'present' }
	}),
	once('stash-shots', 'standin', FIXTURE_WEEK_CLOCK, {
		name: 'stash-shots-season-taken',
		fixture: { ...IR_DROP, FIXTURE_IR_SLOT: '1', FIXTURE_SEASON_TAKEN: '1' },
		env: { STASH: 'present', FIXTURE_SEASON_TAKEN: '1' }
	}),
	once('ffpc-standin-shots', 'standin', FIXTURE_WEEK_CLOCK),
	...clocked('ffpc-no-box-shots', 'standin', {
		'thursday-night': FIXTURE_THURSDAY_NIGHT_CLOCK,
		friday: FIXTURE_FRIDAY_CLOCK,
		saturday: FIXTURE_WEEK_CLOCK,
		sunday: FIXTURE_SUNDAY_MORNING_CLOCK,
		'monday-live': FIXTURE_LIVE_CLOCK,
		monday: FIXTURE_MONDAY_NIGHT_CLOCK,
		tuesday: FIXTURE_TUESDAY_CLOCK,
		wednesday: FIXTURE_STATS_CLOCK
	}),
	once('ffpc-no-box-shots', 'standin', FIXTURE_TUESDAY_CLOCK, {
		name: 'ffpc-no-box-shots-tuesday-late',
		fixture: { FIXTURE_LATE_FINAL: 'LV,BUF' },
		env: { CLOCK: 'tuesday-late' }
	}),
	// The member's opponent with no lineup or roster read (Lane 141, B121): "--" said in its own words.
	...clocked(
		'ffpc-no-box-shots',
		'standin',
		{
			saturday: FIXTURE_WEEK_CLOCK,
			sunday: FIXTURE_SUNDAY_MORNING_CLOCK,
			'monday-live': FIXTURE_LIVE_CLOCK
		},
		{
			fixture: { FIXTURE_FFPC_ROSTERLESS_OPPONENT: '1' },
			env: { ROSTERLESS: '1' },
			tag: 'rosterless-'
		}
	),
	once('front-account-shots', 'standin', FIXTURE_WEEK_CLOCK),
	// The free season (Lane 150): on an API before Lane 149's flag, and with it true and false.
	once('pass-shots', 'standin', FIXTURE_WEEK_CLOCK),
	once('pass-shots', 'standin', FIXTURE_WEEK_CLOCK, {
		name: 'pass-shots-flag',
		fixture: { [FREE_SEASON_VARIABLE]: '1' },
		env: { [FREE_SEASON_VARIABLE]: '1' }
	}),
	// The flag false inside the clock's season: the founder ended it, and the API wins (fix round 1).
	once('pass-shots', 'standin', FIXTURE_WEEK_CLOCK, {
		name: 'pass-shots-ended',
		fixture: { [FREE_SEASON_VARIABLE]: '0' },
		env: { [FREE_SEASON_VARIABLE]: '0' }
	}),
	once('league-rail-shots', 'standin', FIXTURE_WEEK_CLOCK),
	once('purpose-shots', 'standin', FIXTURE_WEEK_CLOCK, { name: 'purpose-shots-week' }),
	once('purpose-shots', 'standin', FIXTURE_MONDAY_CLOCK, { name: 'purpose-shots-monday' }),
	once('purpose-shots', 'standin', FIXTURE_TUESDAY_CLOCK, { name: 'purpose-shots-tuesday' }),
	...clocked(
		'week-done-shots',
		'standin',
		{ kicked: FIXTURE_MONDAY_NIGHT_CLOCK, final: FIXTURE_TUESDAY_CLOCK },
		{ variable: 'STATE' }
	),
	once('week-done-shots', 'standin', FIXTURE_TUESDAY_CLOCK, {
		name: 'week-done-shots-locked',
		fixture: { FIXTURE_LATE_FINAL: 'LV,BUF' },
		env: { STATE: 'locked' }
	}),
	once('polish-shots', 'standin', FIXTURE_WEEK_CLOCK),
	once('front-lead-shots', 'standin', FIXTURE_LIVE_CLOCK, {
		fixture: { FIXTURE_LEAD_FINAL: '1' },
		dev: true
	}),
	once('game-facts-shots', 'standin', FIXTURE_WEEK_CLOCK),
	once('live-truth-shots', 'standin', FIXTURE_LIVE_CLOCK),
	once('rail-shots', 'standin', FIXTURE_WEEK_CLOCK),
	// The bare lobby and companion addresses and the signed-out mock setup's console (Lane 166).
	once('section-doors-shots', 'standin', FIXTURE_WEEK_CLOCK),
	// The legal pages and the site footer under the pages it closes (Lane 151).
	once('legal-shots', 'standin', FIXTURE_WEEK_CLOCK, { args: (o) => [o.web, o.api, o.out] }),
	// The heads the served site answers with, its sitemap, robots file and /llms.txt (Lane 169).
	once('head-shots', 'standin', FIXTURE_WEEK_CLOCK),
	// The whistle in the rail and the phone bar, and the persona gate's mocks (Lane 170).
	once('mark-shots', 'standin', FIXTURE_WEEK_CLOCK, { args: (o) => [o.web, o.api, o.out] }),
	once('season-pages-shots', 'standin', FIXTURE_WEEK_CLOCK),
	once('board-row-shots', 'standin', FIXTURE_WEEK_CLOCK, { dev: true }),
	// The Week N rankings page's K and D/ST chips (Lane 155): the week read, and the Tuesday before.
	once('players-kdst-shots', 'standin', FIXTURE_WEEK_CLOCK),
	once('players-kdst-shots', 'standin', FIXTURE_UNREAD_CLOCK, {
		name: 'players-kdst-shots-empty',
		env: { STATE: 'empty' }
	}),
	// The in-season Rankings row as a box score on a phone (Lane 209), on the graded two records' run
	// so /record draws its weekly record, at the Sunday clock.
	once('rankings-row-shots', 'two-graded', FIXTURE_SUNDAY_CLOCK),
	// One number for a player everywhere (Lane 234, B233): the Rankings' full-order number with the
	// byes last, the every-format table's rank in each scoring, and compare, at the Sunday clock.
	once('one-number-shots', 'formats', FIXTURE_SUNDAY_CLOCK),
	once('week-order-shots', 'standin', FIXTURE_WEEK_CLOCK, {
		ownFixture: true,
		args: (o) => [o.web, String(o.apiPort), o.out]
	}),
	// The Saturday run (Lane 86: the rest of season between a run and the next).
	...clocked(
		'game-state-shots',
		'saturday',
		{ sunday: FIXTURE_SUNDAY_CLOCK, monday: FIXTURE_MONDAY_CLOCK, tuesday: FIXTURE_TUESDAY_CLOCK },
		{ env: { SET: 'contract' }, tag: 'contract-' }
	),
	// The contract run.
	once('player-card-shots', 'contract', FIXTURE_WEEK_CLOCK, {
		name: 'player-card-shots-ros',
		env: { ROS_FROM_WEEK: '7' }
	}),
	once('season-pages-shots', 'contract', FIXTURE_WEEK_CLOCK, {
		name: 'season-pages-shots-ros',
		env: { ROS_FROM_WEEK: '7' }
	}),
	once('order-shots', 'contract', FIXTURE_WEEK_CLOCK),
	// The contract run with Gibbs rewritten (mover-run.ts).
	once('club-move-shots', 'mover', FIXTURE_WEEK_CLOCK),
	once('free-agent-shots', 'free-agent', FIXTURE_WEEK_CLOCK),
	once('club-move-shots', 'special-teams', FIXTURE_WEEK_CLOCK, {
		name: 'club-move-shots-special-teams',
		env: { MOVE: 'special-teams' }
	}),
	// The Saturday run.
	once('horizon-shots', 'saturday', FIXTURE_WEEK_CLOCK, {
		fixture: { FIXTURE_TITLE_WEEK: '18:2' }
	}),
	once('player-bye-shots', 'saturday', FIXTURE_WEEK_CLOCK),
	once('player-bye-shots', 'saturday', FIXTURE_TUESDAY_CLOCK, {
		name: 'player-bye-shots-compare',
		env: { VERB: 'Compare' }
	}),
	// The one-board run.
	once('one-board-shots', 'oneboard', FIXTURE_WEEK_CLOCK),
	once('one-board-shots', 'oneboard', FIXTURE_WEEK_CLOCK, {
		name: 'one-board-shots-two-qb',
		fixture: { FIXTURE_TWO_QB: '1' },
		env: { TWO_QB: '1' }
	}),
	// Lane 223: the run's game state on the schedule and a club, a club's head, the bye cells.
	once('game-day-polish-shots', 'saturday', FIXTURE_SUNDAY_CLOCK, {
		name: 'game-day-polish-shots-schedule',
		args: (o) => ['schedule', o.web, o.api, o.out]
	}),
	// The record runs.
	once('record-shots', 'record-live', FIXTURE_MONDAY_NIGHT_CLOCK, {
		args: (o) => [o.web, o.api, o.out]
	}),
	// The two records' runs rank from week 7, which the fixture API's season names too (Lane 142), so
	// a page the Worker draws names the rail's week order as the run's pages do.
	once('record-two-shots', 'two-upcoming', FIXTURE_WEEK_CLOCK, {
		name: 'record-two-shots-upcoming',
		fixture: BOARD_WEEK_7,
		args: (o) => ['upcoming', o.web, o.api, o.out]
	}),
	once('record-two-shots', 'two-graded', FIXTURE_WEEK_CLOCK, {
		name: 'record-two-shots-graded',
		fixture: BOARD_WEEK_7,
		args: (o) => ['graded', o.web, o.api, o.out]
	}),
	// Lane 223: the record and its front card name the rest-of-season order.
	once('game-day-polish-shots', 'two-graded', FIXTURE_SUNDAY_CLOCK, {
		name: 'game-day-polish-shots-record',
		fixture: BOARD_WEEK_7,
		args: (o) => ['record', o.web, o.api, o.out]
	}),
	once('record-two-shots', 'two-published', FIXTURE_WEEK_CLOCK, {
		name: 'record-two-shots-published',
		fixture: BOARD_WEEK_7,
		args: (o) => ['published', o.web, o.api, o.out]
	})
];
