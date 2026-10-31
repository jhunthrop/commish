// The hosts a league is followed from, named alike on /league/new and the signed-out /account (each
// switched host only where it is open, from one filtered list), and the one sentence that names the
// in-season tools to a first-timer. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { leaguesKeptText } from '#lib/account/keeps.ts';
import {
	IN_SEASON_TOOLS_LINE,
	LEAGUE_HOSTS,
	PLATFORMS,
	hostsLine,
	leagueHostsLine,
	liveDraftHosts,
	openLeagueHosts
} from './hosts.ts';
import { hostWords } from './names.ts';
import { NOT_AFFILIATED_LINE } from './affiliation.ts';

const ALL_OPEN = { ffpc: true, yahoo: true, espn: true };
const SWITCHES = [
	ALL_OPEN,
	{ ffpc: false, yahoo: true, espn: true },
	{ ffpc: true, yahoo: false, espn: false },
	{ ffpc: false, yahoo: false, espn: false }
];

void test('both pages name the same hosts in the same order, from one list', () => {
	const named = (line: string): string[] =>
		LEAGUE_HOSTS.map(hostWords).filter((host) => line.includes(host));
	assert.deepEqual(named(leagueHostsLine(ALL_OPEN)), LEAGUE_HOSTS.map(hostWords));
	assert.deepEqual(named(hostsLine(ALL_OPEN)), LEAGUE_HOSTS.map(hostWords));
	const order = (line: string): number[] => LEAGUE_HOSTS.map((h) => line.indexOf(hostWords(h)));
	for (const line of [leagueHostsLine(ALL_OPEN), hostsLine(ALL_OPEN)]) {
		const at = order(line);
		assert.deepEqual(
			at,
			[...at].sort((a, b) => a - b),
			line
		);
	}
	assert.equal(
		hostsLine(ALL_OPEN),
		'Works with Sleeper leagues, public MyFantasyLeague leagues, FFPC leagues, Yahoo leagues and ESPN leagues.'
	);
	assert.equal(leagueHostsLine(ALL_OPEN), 'Sleeper, MyFantasyLeague, FFPC, Yahoo or ESPN');
	assert.equal(
		hostsLine({ ffpc: false, yahoo: false, espn: true }),
		'Works with Sleeper leagues, public MyFantasyLeague leagues and ESPN leagues.'
	);
	assert.equal(
		leagueHostsLine({ ffpc: false, yahoo: false, espn: true }),
		'Sleeper, MyFantasyLeague or ESPN'
	);
});

void test('a switched-off host is named by neither page, whatever the switches', () => {
	for (const open of SWITCHES) {
		const hosts = openLeagueHosts(open).map(hostWords);
		const named = (line: string): string[] =>
			LEAGUE_HOSTS.map(hostWords).filter((host) => line.includes(host));
		assert.deepEqual(named(hostsLine(open)), hosts);
		assert.deepEqual(named(leagueHostsLine(open)), hosts);
	}
});

void test('the follow page names the three in-season tools in one sentence, in fantasy words', () => {
	assert.equal(
		IN_SEASON_TOOLS_LINE,
		'Each week we show the lineup to start, your best add on waivers and the trades that help both teams.'
	);
	assert.doesNotMatch(IN_SEASON_TOOLS_LINE, bannedPattern(/\bvalue\b/));
});

void test('the account page reads the hosts and the tools from the same two lines', () => {
	assert.equal(
		leaguesKeptText(ALL_OPEN),
		`on ${leagueHostsLine(ALL_OPEN)}, kept up to date. ${IN_SEASON_TOOLS_LINE}`
	);
});

void test("one platforms module says which a live draft is read from and which a league is followed from (the sweep's C13)", () => {
	assert.deepEqual(Object.keys(PLATFORMS), [...LEAGUE_HOSTS]);
	assert.deepEqual(liveDraftHosts(), ['sleeper']);
	// A platform a draft is read from is one a league is followed from, with no switch.
	for (const host of liveDraftHosts())
		assert.ok(openLeagueHosts(SWITCHES[3] ?? ALL_OPEN).includes(host));
	assert.deepEqual(openLeagueHosts(ALL_OPEN), [...LEAGUE_HOSTS]);
	assert.deepEqual(openLeagueHosts({ ffpc: false, yahoo: false, espn: false }), ['sleeper', 'mfl']);
});

void test('the not-affiliated line names every platform a league is read from, whatever the switches (Lane 310)', () => {
	assert.equal(
		NOT_AFFILIATED_LINE,
		'Commish is not affiliated with or endorsed by Sleeper, MyFantasyLeague, FFPC, Yahoo or ESPN.'
	);
	for (const host of LEAGUE_HOSTS) assert.ok(NOT_AFFILIATED_LINE.includes(hostWords(host)), host);
});
