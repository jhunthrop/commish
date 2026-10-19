// The signed-out account page's words: the hosts open here named, the connect verbs of the open
// hosts, the copy guard. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { leagueHostsLine } from '#lib/league/hosts.ts';
import { CONNECT, keeps, leaguesKeptText, memberHosts, signedOutTitle } from './keeps.ts';

const ALL_OPEN = { ffpc: true, yahoo: true, espn: true };
const ALL_SHUT = { ffpc: false, yahoo: false, espn: false };

const words = (open: typeof ALL_OPEN): string[] => [
	...keeps(open, false).flatMap((k) => [k.lead, k.text]),
	...memberHosts(open).flatMap((h) => [h.lead, h.text, h.verb])
];

const leaguesLine = (open: typeof ALL_OPEN): string =>
	keeps(open, false).find((k) => k.lead === 'Your leagues')?.text ?? '';

void test('the leagues line names every host open here, and no host switched off', () => {
	for (const host of ['Sleeper', 'MyFantasyLeague', 'FFPC', 'Yahoo', 'ESPN']) {
		assert.ok(leaguesLine(ALL_OPEN).includes(host), host);
	}
	assert.equal(leaguesLine(ALL_OPEN), leaguesKeptText(ALL_OPEN));
	assert.ok(leaguesLine(ALL_OPEN).includes(leagueHostsLine(ALL_OPEN)));
	assert.ok(
		leaguesLine({ ffpc: false, yahoo: true, espn: false }).startsWith(
			'on Sleeper, MyFantasyLeague or Yahoo, kept up to date.'
		)
	);
	assert.ok(leaguesLine(ALL_SHUT).startsWith('on Sleeper or MyFantasyLeague, kept up to date.'));
	assert.doesNotMatch(leaguesLine(ALL_SHUT), /FFPC|Yahoo|ESPN/);
});

void test('a connect verb for Yahoo and for ESPN, each only where it is open', () => {
	assert.deepEqual(
		memberHosts(ALL_OPEN).map((h) => h.verb),
		['Connect Yahoo', 'Connect ESPN']
	);
	assert.deepEqual(
		memberHosts({ ffpc: true, yahoo: false, espn: true }).map((h) => h.verb),
		['Connect ESPN']
	);
	assert.deepEqual(memberHosts(ALL_SHUT), []);
});

void test('connecting ESPN is for any ESPN league and says what the session is kept for', () => {
	const espn = memberHosts(ALL_OPEN).find((h) => h.lead === 'ESPN')?.text ?? '';
	assert.match(espn, /public or private/);
	assert.match(espn, /so your league stays in sync and we can make your moves when you ask\./);
	assert.doesNotMatch(espn, /a private ESPN league/);
});

void test('the copy has no em-dash, no semicolon, no doubled word and no trading words', () => {
	for (const line of [...words(ALL_OPEN), ...words(ALL_SHUT)]) {
		assert.doesNotMatch(line, bannedPattern(), line);
		assert.doesNotMatch(line, /\b([a-z]+)\s+\1\b/i, line);
		// Ruling R1: a platform is named as a place to connect, never set against us.
		assert.doesNotMatch(line, /\b(than|unlike|versus|vs)\b/i, line);
	}
});

void test('the connect section is headed by the league, never "host", under the line naming the platforms', () => {
	assert.equal(CONNECT.head, 'Connect your league');
	// The platforms are named once, in the leagues line the section follows.
	assert.ok(leaguesLine(ALL_OPEN).includes('Sleeper, MyFantasyLeague, FFPC, Yahoo or ESPN'));
	for (const said of [CONNECT.head, CONNECT.label])
		assert.doesNotMatch(said, bannedPattern(), said);
});

void test('in season the signed-out page leads with your leagues, before the draft with your prep', () => {
	assert.equal(signedOutTitle(true), 'Sign in to keep your leagues and your prep');
	assert.equal(signedOutTitle(false), 'Sign in to keep your prep');
	assert.deepEqual(
		keeps(ALL_OPEN, true).map((k) => k.lead),
		['Your leagues', 'Your cheat sheets', 'Your mock drafts', 'Your Draft Pass or Membership']
	);
	assert.deepEqual(
		keeps(ALL_OPEN, false).map((k) => k.lead),
		['Your cheat sheets', 'Your mock drafts', 'Your leagues', 'Your Draft Pass or Membership']
	);
});
