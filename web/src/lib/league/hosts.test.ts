// The hosts a league is followed from, named alike on /league/new and the signed-out /account, and
// the one sentence that names the in-season tools to a first-timer. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEAGUES_KEPT_TEXT } from '#lib/account/keeps.ts';
import { IN_SEASON_TOOLS_LINE, LEAGUE_HOSTS, LEAGUE_HOSTS_LINE, hostsLine } from './hosts.ts';
import { hostWords } from './names.ts';

const ALL_OPEN = { ffpc: true, yahoo: true, espn: true };

void test('both pages name the same hosts in the same order, from one list', () => {
	const named = (line: string): string[] =>
		LEAGUE_HOSTS.map(hostWords).filter((host) => line.includes(host));
	assert.deepEqual(named(LEAGUE_HOSTS_LINE), LEAGUE_HOSTS.map(hostWords));
	assert.deepEqual(named(hostsLine(ALL_OPEN)), LEAGUE_HOSTS.map(hostWords));
	const order = (line: string): number[] => LEAGUE_HOSTS.map((h) => line.indexOf(hostWords(h)));
	for (const line of [LEAGUE_HOSTS_LINE, hostsLine(ALL_OPEN)]) {
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
	assert.equal(LEAGUE_HOSTS_LINE, 'Sleeper, MyFantasyLeague, FFPC, Yahoo or ESPN');
	assert.equal(
		hostsLine({ ffpc: false, yahoo: false, espn: true }),
		'Works with Sleeper leagues, public MyFantasyLeague leagues and ESPN leagues.'
	);
});

void test('the follow page names the three in-season tools in one sentence, in fantasy words', () => {
	assert.equal(
		IN_SEASON_TOOLS_LINE,
		'Each week we show the lineup to start, your best add on waivers and the trades that help both teams.'
	);
	assert.doesNotMatch(IN_SEASON_TOOLS_LINE, /[—–;]|\b(market|price|buy|sell|value)\b/i);
});

void test('the account page reads the hosts and the tools from the same two lines', () => {
	assert.equal(
		LEAGUES_KEPT_TEXT,
		`on ${LEAGUE_HOSTS_LINE}, kept up to date. ${IN_SEASON_TOOLS_LINE}`
	);
});
