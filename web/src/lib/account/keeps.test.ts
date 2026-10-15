// The signed-out account page's words: the hosts open here named, the connect verbs of the open
// hosts, the copy guard. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leagueHostsLine } from '#lib/league/hosts.ts';
import { keeps, memberHosts } from './keeps.ts';

const ALL_OPEN = { ffpc: true, yahoo: true, espn: true };
const ALL_SHUT = { ffpc: false, yahoo: false, espn: false };

const words = (open: typeof ALL_OPEN): string[] => [
	...keeps(open).flatMap((k) => [k.lead, k.text]),
	...memberHosts(open).flatMap((h) => [h.lead, h.text, h.verb])
];

void test('the leagues line names every host open here, and no host switched off', () => {
	const line = keeps(ALL_OPEN).find((k) => k.lead === 'Your leagues')?.text ?? '';
	for (const host of ['Sleeper', 'MyFantasyLeague', 'FFPC', 'Yahoo', 'ESPN']) {
		assert.ok(line.includes(host), host);
	}
	assert.ok(line.includes(leagueHostsLine(ALL_OPEN)));
	const shut = keeps({ ffpc: false, yahoo: true, espn: false }).find(
		(k) => k.lead === 'Your leagues'
	)?.text;
	assert.equal(shut, 'on Sleeper, MyFantasyLeague or Yahoo, kept up to date');
	assert.equal(
		keeps(ALL_SHUT).find((k) => k.lead === 'Your leagues')?.text,
		'on Sleeper or MyFantasyLeague, kept up to date'
	);
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
	assert.match(espn, /so your league stays in sync and, when you ask, to make your moves\./);
	assert.doesNotMatch(espn, /a private ESPN league/);
});

void test('the copy has no em-dash, no semicolon, no doubled word and no trading words', () => {
	for (const line of [...words(ALL_OPEN), ...words(ALL_SHUT)]) {
		assert.doesNotMatch(line, /[—;]/, line);
		assert.doesNotMatch(line, /\b([a-z]+)\s+\1\b/i, line);
		assert.doesNotMatch(line, /\b(market|price|buy|sell)\b/i, line);
	}
});
