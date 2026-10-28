// The parity export: the web's League home readers over the shared fixtures, the file the apps' ports
// are held to. Run with `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CLOCKS,
	generate,
	instantOf,
	OUTPUT,
	RAIL_OUTPUT,
	SHELL_OUTPUT,
	SITE_PHASES
} from './export-parity.ts';
import { LINEUP_OUTPUT } from './lineup-parity.ts';
import { WAIVERS_OUTPUT } from './waivers-parity.ts';
import { TRADES_OUTPUT } from './trades-parity.ts';
import { BOARD_OUTPUT } from './board-parity.ts';
import { BOARD_RUN_OUTPUT } from './board-run-parity.ts';
import { PLAYER_SHEET_OUTPUT } from './player-sheet-parity.ts';
import { SHEET_PLAYER_IDS } from './sheet-players.ts';
import { ACCOUNT_OUTPUT } from './account-parity.ts';
import { GAP_WORDS } from '../../web/src/lib/run/board-basis.ts';

void test('a file clock reads back as its instant', () => {
	assert.equal(instantOf('2026-10-18T18-56-00Z'), '2026-10-18T18:56:00.000Z');
});

void test('every clock carries the bugs, the twelve standings rows and a team basis', async () => {
	const parity = JSON.parse((await generate()).get(OUTPUT) ?? '{}') as {
		clocks: Record<string, { bugs: unknown[]; standings: { me: boolean }[]; teamBasis: string }>;
		moves: unknown[];
		seeding: string | null;
	};
	assert.deepEqual(Object.keys(parity.clocks), [...CLOCKS]);
	for (const clock of CLOCKS) {
		const home = parity.clocks[clock];
		assert.equal(home?.bugs.length, 6, clock);
		assert.equal(home?.standings.length, 12, clock);
		assert.equal(home?.standings.filter((r) => r.me).length, 1, clock);
		assert.match(home?.teamBasis ?? '', /^A team's Proj adds/, clock);
	}
	assert.equal(parity.moves.length, 15);
	assert.match(parity.seeding ?? '', /^FFPC seeds 4 for the playoffs/);
});

void test('with no league the bar follows the site season: the draft bar outside it, the season bar in it', async () => {
	const rail = JSON.parse((await generate()).get(RAIL_OUTPUT) ?? '{}') as {
		phases: Record<string, { key: string }[]>;
		withoutLeague: { key: string }[];
		withoutLeagueBySeason: Record<string, { key: string }[]>;
		account: { key: string; label: string };
	};
	assert.deepEqual(Object.keys(rail.withoutLeagueBySeason), [...SITE_PHASES]);
	assert.deepEqual(rail.withoutLeagueBySeason.preseason, rail.phases.pre_draft);
	assert.deepEqual(rail.withoutLeagueBySeason.offseason, rail.phases.offseason);
	assert.deepEqual(rail.withoutLeagueBySeason.in_season, rail.withoutLeague);
	assert.deepEqual(rail.withoutLeagueBySeason.playoffs, rail.withoutLeague);
	assert.deepEqual(rail.account, { key: 'account', label: 'Account' });
});

void test("the switch's phase words appear only where the leagues' phases differ", async () => {
	const shell = JSON.parse((await generate()).get(SHELL_OUTPUT) ?? '{}') as {
		cases: {
			set: string;
			leagues: { id: string; name: string }[];
			names: Record<string, string>;
			phases: Record<string, string>;
		}[];
		sheetLoading: string;
		lines: { line: string }[];
	};
	assert.equal(shell.cases.length, 12);
	assert.equal(shell.lines.length, 40);
	assert.ok(shell.lines.some((l) => l.line === 'FFPC, half PPR, superflex'));
	for (const c of shell.cases) {
		assert.equal(Object.keys(c.names).length, c.leagues.length, c.set);
		assert.equal(Object.keys(c.phases).length, c.set === 'oneSeason' ? 0 : c.leagues.length, c.set);
	}
	const unnamed = shell.cases.find((c) => c.set === 'withUnnamed');
	assert.equal(unnamed?.names['6f1d1c52-2626-4a26-9a26-000000000099'], 'Your Yahoo league');
	assert.match(shell.sheetLoading, /read as the page opens\.$/);
});

void test('the Lineup at every clock: changes offered before kickoff, held once their players kick off', async () => {
	const lineup = JSON.parse((await generate()).get(LINEUP_OUTPUT) ?? '{}') as {
		clocks: Record<
			string,
			{
				title: string;
				starters: { move: string | null; state: string | null }[];
				pinned: { verb: string | null };
				basis: string;
			}
		>;
		writes: Record<string, { pinned: { verb: string | null } }>;
		moves: { host: string; verb: string; results: { outcome: string }[] }[];
	};
	assert.deepEqual(Object.keys(lineup.clocks), [...CLOCKS]);
	const saturday = lineup.clocks['2026-10-17T17-00-00Z'];
	assert.equal(saturday?.title, 'Three changes');
	assert.equal(saturday?.pinned.verb, 'Copy the lineup');
	assert.equal(lineup.writes['2026-10-17T17-00-00Z']?.pinned.verb, 'Make these changes');
	for (const clock of CLOCKS) {
		const at = lineup.clocks[clock];
		assert.ok(
			at?.starters.every((row) => row.move === null || row.state === 'upcoming'),
			`${clock}: a move only on a row still to come`
		);
		assert.match(at?.basis ?? '', /^Our pick is each slot's highest Proj/, clock);
	}
	assert.equal(lineup.clocks['2026-10-18T18-56-00Z']?.pinned.verb, null);
	assert.equal(lineup.moves.find((m) => m.host === 'espn')?.verb, 'Set it on ESPN');
	assert.deepEqual(
		lineup.moves[0]?.results.map((r) => r.outcome),
		['done', 'refused', 'pending']
	);
});

interface BoardWordsCase {
	rail: string;
	position: string | null;
	following: boolean;
	rosFromWeek: number | null;
	words: { bar: string; title: string; heading: string; verb: string | null };
}

void test("the board's parity: every rail's words for the board, the row's figures as the phone prints them", async () => {
	const board = JSON.parse((await generate()).get(BOARD_OUTPUT) ?? '{}') as {
		words: BoardWordsCase[];
		figures: { value: number; overReplacement: string; gap: string }[];
		noGap: string;
		basis: { view: string; parts: string[] }[];
	};
	const before = board.words.find(
		(c) => c.rail === 'pre_draft' && c.position === null && !c.following && c.rosFromWeek === null
	);
	assert.deepEqual(before?.words, {
		bar: 'Board',
		title: 'PPR Board',
		heading: '2026 Board',
		verb: 'mock'
	});
	const rest = board.words.find(
		(c) => c.rail === 'in_season' && c.position === 'WR' && c.following && c.rosFromWeek === 7
	);
	assert.equal(rest?.words.heading, 'Rest of 2026');
	assert.equal(rest?.words.verb, null);
	assert.equal(board.figures.find((f) => f.value === -0.04)?.overReplacement, '+0.0');
	assert.equal(board.figures.find((f) => f.value === -3.6)?.gap, '−3.6');
	assert.equal(board.noGap, '--');
	assert.ok(board.basis.find((c) => c.view === 'all')?.parts.includes(GAP_WORDS));
	assert.match(
		board.basis.find((c) => c.view === 'draftOrder')?.parts[0] ?? '',
		/^Kickers and defenses/
	);
});

interface BoardRunCase {
	stamp: string;
	restCaption: string | null;
	words: { heading: string };
	views: {
		position: string | null;
		tiers: { ids: string[]; cliff: string }[];
		basis: string[];
	}[];
}

void test("the board's run parity: the stand-in's tiers and cliffs, the fixture run's rest of season", async () => {
	const parity = JSON.parse((await generate()).get(BOARD_RUN_OUTPUT) ?? '{}') as {
		runs: BoardRunCase[];
	};
	const [standIn, rest] = parity.runs;
	assert.equal(standIn?.stamp, 'Stand-in, updated Sep 1');
	assert.equal(standIn?.restCaption, null);
	assert.equal(standIn?.words.heading, '2026 Board');
	const receivers = standIn?.views.find((view) => view.position === 'WR');
	assert.equal(receivers?.tiers[0]?.cliff, '23.4 PPR pts to tier 2');
	assert.ok(receivers?.basis.includes('Tiers are drawn within WR.'));
	assert.ok(receivers?.basis.includes('ADP from PPR drafts, Sep 5 to Sep 9.'));
	const tiered = receivers?.tiers.flatMap((tier) => tier.ids) ?? [];
	assert.equal(new Set(tiered).size, tiered.length, 'every receiver in one tier at most');
	assert.equal(rest?.words.heading, 'Rest of 2026');
	assert.match(rest?.restCaption ?? '', /from week 7, refreshed October 21$/);
	assert.ok(
		rest?.views.every((view) => view.basis.every((part) => !part.startsWith('ADP from'))),
		'the rest of the season names no drafts'
	);
});

void test("the player sheet's parity: every held read, each sheet player at each clock, every page's words", async () => {
	const parity = JSON.parse((await generate()).get(PLAYER_SHEET_OUTPUT) ?? '{}') as {
		weekRead: { shown: { withheld: boolean; words?: string } }[];
		noRead: { state: string | null; words: string }[];
		statusHeld: { built: { body: string | null } }[];
		sheets: {
			player: string;
			read: { written: boolean; withheld?: boolean; words?: string; caption?: string };
			tiles: { label: string; value: string }[];
		}[];
		pages: { run: string; underway: boolean; words: { drafters: string } }[];
		verbs: { label: string }[];
	};
	const words = parity.weekRead.flatMap((c) => (c.shown.withheld ? [c.shown.words] : []));
	assert.ok(words.includes('The published projection moved since this read was written.'), 'moved');
	assert.ok(
		words.includes('Our read for this game was not written.'),
		'not written once kicked off'
	);
	assert.ok(
		parity.weekRead.some((c) => !c.shown.withheld),
		'a read that stands'
	);
	const notWritten = 'Our read for this game was not written.';
	assert.deepEqual(
		parity.noRead.map((c) => c.words),
		[
			'Our read for his next game is not written yet.',
			'Our read for his next game is not written yet.',
			notWritten,
			notWritten,
			// Lane 256: until the week rolls over, the night the run names.
			'Our reads for week 8 are written Tuesday night.',
			'Our reads for week 8 are written Tuesday night.',
			notWritten,
			notWritten,
			'Our reads for week 9 are written Wednesday night.',
			'Our reads for week 9 are written Wednesday night.',
			notWritten,
			notWritten
		]
	);
	assert.ok(
		parity.statusHeld.some((c) => c.built.body === null),
		'a read an older run nulled for his status'
	);
	assert.ok(
		parity.statusHeld.some((c) => c.built.body !== null),
		'a read that stands'
	);
	for (const id of SHEET_PLAYER_IDS)
		assert.ok(
			parity.sheets.some((c) => c.player === id),
			id
		);
	const reads = parity.sheets.map((c) => c.read);
	assert.ok(
		reads.some((r) => r.written && r.withheld === false),
		'a written read on a sheet'
	);
	assert.ok(
		reads.some((r) => !r.written),
		'a sheet with no read written'
	);
	// Lane 274: the status caption goes over the kept read, never instead of it.
	assert.ok(
		reads.some(
			(r) =>
				r.withheld === false &&
				r.caption?.startsWith('His status changed since this read was written.') === true
		),
		'a sheet read under the status caption'
	);
	assert.ok(
		parity.sheets.every((c) => c.tiles.length === 6),
		'six tiles on every sheet'
	);
	assert.ok(
		parity.sheets.some((c) => c.tiles[0]?.label === 'Pts'),
		'Pts once kicked off'
	);
	assert.deepEqual([...new Set(parity.pages.map((p) => p.underway))].sort(), [false, true]);
	assert.ok(parity.pages.every((p) => p.words.drafters.length > 0));
	assert.equal(parity.verbs.length, 35);
});

void test("the Waivers at every clock, each ESPN stand-in's with its claim made here, and the claim's words (Lane 186)", async () => {
	const parity = JSON.parse((await generate()).get(WAIVERS_OUTPUT) ?? '{}') as {
		clocks: Record<
			string,
			{ pinned: { verb: string | null }; gaining: unknown[]; onHost: boolean }
		>;
		espn: Record<string, { screen: { pinned: { verb: string | null }; onHost: boolean } }>;
		claim: { title: string; hosts: { host: string; verb: string; results: { words: string }[] }[] };
	};
	assert.deepEqual(Object.keys(parity.clocks), [...CLOCKS]);
	for (const clock of CLOCKS) {
		const screen = parity.clocks[clock];
		assert.equal(screen?.onHost, false, clock);
		assert.ok((screen?.gaining.length ?? 0) > 0, clock);
	}
	assert.deepEqual(Object.keys(parity.espn), ['done', 'refused', 'pending']);
	assert.equal(parity.espn.pending?.screen.pinned.verb, 'Add on ESPN');
	assert.equal(parity.claim.title, 'Your claim');
	const espn = parity.claim.hosts.find((h) => h.host === 'espn');
	assert.equal(espn?.verb, 'Claim on ESPN');
	assert.ok(espn?.results.some((r) => r.words.includes('processes it Wed 2:00 am')));
});

void test("the Trades at every clock: each row's offer in the web's words, the strip's checks scored", async () => {
	interface Row {
		offer: string;
		opened: { groups: { rows: { slot: string }[] }[] };
	}
	const parity = JSON.parse((await generate()).get(TRADES_OUTPUT) ?? '{}') as {
		clocks: Record<string, { finder: { every: { mine: Row[] } }; basis: { closed: string } }>;
		checks: Record<string, { yours: { figures: { projBefore: string } }; sentence: string }[]>;
		copied: { done: string };
		words: { checks: { sentence: string }[]; under: string };
		holding: { rows: { key: string }[]; unheld: { decision: string } | null };
		builder: { yours: { rows: { pick: string }[] }; pin: string };
	};
	assert.deepEqual(Object.keys(parity.clocks), [...CLOCKS]);
	for (const clock of CLOCKS) {
		const rows = parity.clocks[clock]?.finder.every.mine ?? [];
		assert.ok(rows.length > 0, clock);
		for (const row of rows) {
			assert.match(row.offer, /^Trade with .+: .+ for .+\.$/, clock);
			assert.deepEqual(row.opened.groups.length, 2, clock);
		}
		assert.match(parity.clocks[clock]?.basis.closed ?? '', /How the order has done$/, clock);
	}
	// On Sunday afternoon the strip's trades move players already playing: no Proj before or after.
	const sunday = parity.checks['2026-10-18T18-56-00Z'] ?? [];
	assert.equal(sunday.length, 2);
	assert.ok(sunday.every((c) => c.yours.figures.projBefore === '--'));
	assert.equal(parity.copied.done, "Copied. Propose it on FFPC's trade page.");
	// Every checkWords branch, the under 0.1 gain, a holding read and the builder (fix round 1).
	assert.equal(
		new Set(parity.words.checks.map((c) => c.sentence)).size,
		parity.words.checks.length
	);
	assert.match(parity.words.under, /gains under 0\.1 points/);
	assert.ok(parity.holding.rows.length > 0);
	assert.match(parity.holding.unheld?.decision ?? '', /^No trade we found includes /);
	assert.deepEqual(
		['on', 'drop'].map((pick) => parity.builder.yours.rows.some((r) => r.pick === pick)),
		[true, true]
	);
	assert.equal(parity.builder.pin, '+5.7 a week for your lineup, +0.7 for theirs');
});

void test("the Account's words: who, the free season's plan, each league's row, each device's line (Lane 198)", async () => {
	const account = JSON.parse((await generate()).get(ACCOUNT_OUTPUT) ?? '{}') as {
		who: { name: string; line: string };
		plan: { title: string; line: string };
		leagues: { id: string; team: string; read: string }[];
		counts: { count: number; words: string }[];
		devices: { id: string; line: string }[];
		reads: { readAt: string | null; words: string }[];
		freeSeason: { now: string; flag: boolean | null; free: boolean }[];
	};
	assert.equal(account.who.line, 'fixture@example.com, with us since Sep 1');
	assert.equal(account.plan.title, 'Free this season');
	assert.equal(account.leagues.length, 12);
	assert.equal(account.leagues[0]?.team, 'McConkey Kong Country, on FFPC');
	assert.ok(account.counts.some((c) => c.words === '3, newest first'));
	assert.deepEqual(
		account.devices.map((d) => d.line),
		['Paired Oct 12, last used Oct 17', 'Paired Sep 3, not used yet']
	);
	assert.ok(account.reads.some((r) => r.words === '4 minutes ago'));
	assert.deepEqual(
		account.freeSeason.map((f) => f.free),
		[true, true, false, false, true, false]
	);
});
