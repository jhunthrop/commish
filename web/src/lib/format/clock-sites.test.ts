// The real clock is read only at the outermost layer (Lane 77): a page's own clock, a load or request
// handler, the build's one instant, and the few places that measure time rather than draw with it.
// Every product function whose words or figures depend on the time takes `now`, tests pass one from
// the fixture's week and the shots set the fixture clocks. This guard scans web/src and web/scripts,
// tests included, for Date.now(), new Date() and Temporal.Now and fails on any read outside the list,
// and on a listed site that no longer reads it. Run with `npm test`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const ROOTS = ['src', 'scripts'] as const;
const SOURCE = /\.(ts|svelte)$/;
const SELF = 'src/lib/format/clock-sites.test.ts';
/** A wall-clock read. performance.now() measures a span and draws nothing, so it is not one. */
const CLOCK_READ = /Date\.now\(\)|new Date\(\)|Temporal\.Now\b/g;

interface Site {
	reads: number;
	why: string;
}

/** Every allowed clock-reading site, by file under web/, with how many reads it holds and why. */
const ALLOWED: Readonly<Record<string, Site>> = {
	'src/lib/server/build-clock.ts': {
		reads: 1,
		why: 'the build instant every prerendered page and the site rail are drawn at'
	},
	'src/lib/league/LeaguePage.svelte': {
		reads: 3,
		why: "the league page's clock, set when it opens, at the league's read and at the week's"
	},
	'src/lib/league/inseason/InSeasonPage.svelte': {
		reads: 2,
		why: "a screen's clock, set at each read"
	},
	'src/lib/front/FrontWeek.svelte': { reads: 1, why: "the front door's week, drawn once" },
	'src/lib/account/AccountPage.svelte': {
		reads: 2,
		why: "the room's clock its connections and leagues draw at, and whether a bought pass has arrived, asked once a poll"
	},
	'src/lib/context/LeagueMenu.svelte': {
		reads: 1,
		why: "the league switch's phase words, said when the leagues are read"
	},
	'src/lib/order/OrderScreen.svelte': { reads: 1, why: "the order's clock, set at each read" },
	'src/lib/order/WeekScreen.svelte': { reads: 1, why: "the week order's clock, set at each read" },
	'src/lib/player/PlayerCompare.svelte': {
		reads: 1,
		why: "the compare page's cards, drawn when the weeks are read"
	},
	'src/routes/(run)/players/[slug]/+page.svelte': {
		reads: 1,
		why: "the player page's live card, drawn when the week is read"
	},
	'src/routes/lobby/[id]/+page.svelte': {
		reads: 2,
		why: "the lobby's ticking clock, on the server's offset"
	},
	'src/lib/run/live-status.ts': {
		reads: 1,
		why: "the browser's live clock the built status words are said again on"
	},
	'src/lib/room/lobby-socket.ts': {
		reads: 1,
		why: "measures the server clock's offset from the browser's"
	},
	'src/lib/context/held.ts': { reads: 2, why: "the held copy's age, a cache stamp, nothing drawn" },
	'src/lib/sheet/store.svelte.ts': {
		reads: 1,
		why: "the sheet store's injected clock, at its composition root"
	},
	'src/lib/format/clock.ts': {
		reads: 1,
		why: "the zone's generic name, the same at every instant"
	},
	'scripts/inseason-fixture/clock.ts': {
		reads: 3,
		why: "the fixture API's clock, run on from FIXTURE_CLOCK"
	},
	'scripts/room-shots.ts': { reads: 2, why: 'a wait deadline, nothing drawn' },
	'scripts/week-order-shots.ts': { reads: 2, why: 'a wait deadline, nothing drawn' },
	'scripts/run-from-mock-data.ts': {
		reads: 1,
		why: "the stand-in run's stamp, the stand-in build's own clock"
	},
	'scripts/run-fresh.ts': {
		reads: 1,
		why: "the deploy check's clock, the command's outermost layer"
	}
};

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
		return SOURCE.test(entry.name) ? [path] : [];
	});
}

function clockReads(): ReadonlyMap<string, number> {
	return new Map(
		ROOTS.flatMap((root) => sources(join(WEB, root)))
			.map((path) => [relative(WEB, path), readFileSync(path, 'utf8')] as const)
			.filter(([file]) => file !== SELF)
			.map(([file, text]) => [file, text.match(CLOCK_READ)?.length ?? 0] as const)
			.filter(([, count]) => count > 0)
	);
}

void test('the real clock is read only at the listed outermost sites', () => {
	const unlisted = [...clockReads()]
		.filter(([file, count]) => count !== ALLOWED[file]?.reads)
		.map(
			([file, count]) =>
				`${file}: ${String(count)} reads, ${String(ALLOWED[file]?.reads ?? 0)} allowed`
		);
	assert.deepEqual(unlisted, [], 'take `now` from the caller instead of reading the clock');
});

void test('every listed site still reads the clock, so the list holds no stale entry', () => {
	const reads = clockReads();
	assert.deepEqual(
		Object.keys(ALLOWED).filter((file) => !reads.has(file)),
		[]
	);
});

void test('the guard sees each form of a read and nothing else', () => {
	const said =
		'a(Date.now()); b(new Date()); c(Temporal.Now.instant()); d(new Date(at)); performance.now();';
	assert.equal(said.match(CLOCK_READ)?.length, 3);
});
