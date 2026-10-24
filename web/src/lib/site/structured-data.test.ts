// The structured data (Lane 169, ruling 3): each type's builder makes data schema.org and the search
// engines' rich results accept, and the check catches each field a type cannot go without. The
// built pages are held to the same check (head-html.test.ts). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	RANKINGS_LIST_SIZE,
	datasetData,
	itemListData,
	organizationData,
	personData,
	structuredFaults
} from './structured-data.ts';

const PERSON = personData({
	name: 'Puka Nacua',
	position: 'WR',
	club: 'Los Angeles Rams',
	path: '/players/puka-nacua',
	image: 'https://trycommish.app/img/headshots/nfl/4426515/480'
});

void test("a player's Person names his position at his club, his page, his face and his club", () => {
	assert.deepEqual(structuredFaults(PERSON), []);
	assert.equal(PERSON.jobTitle, 'WR, Los Angeles Rams');
	assert.equal(PERSON.url, 'https://trycommish.app/players/puka-nacua');
	assert.deepEqual(PERSON.memberOf, { '@type': 'SportsTeam', name: 'Los Angeles Rams' });
	const free = personData({
		...PERSON,
		position: 'WR',
		club: null,
		path: '/players/a',
		image: null
	});
	assert.deepEqual(structuredFaults(free), []);
	assert.equal(free.memberOf, undefined);
	assert.equal(free.jobTitle, 'WR');
});

void test("the rankings page's ItemList is its first 50, each at its place with its page", () => {
	const players = Array.from({ length: 80 }, (_, at) => ({
		name: `Player ${String(at)}`,
		path: `/players/p-${String(at)}`
	}));
	const list = itemListData('Our 2026 order, top 50', players);
	assert.deepEqual(structuredFaults(list), []);
	assert.equal(list.itemListElement.length, RANKINGS_LIST_SIZE);
	assert.equal(list.itemListElement[0]?.position, 1);
	assert.equal(list.itemListElement[49]?.url, 'https://trycommish.app/players/p-49');
});

void test('the record is a Dataset with a description, a day interval and its address', () => {
	const data = datasetData({
		name: 'Commish record, 2026',
		description:
			"Our 2026 record in PPR: our weekly rankings against ESPN and the week's published projection.",
		from: '2026-09-10',
		through: '2026-10-21',
		path: '/record'
	});
	assert.deepEqual(structuredFaults(data), []);
	assert.equal(data.temporalCoverage, '2026-09-10/2026-10-21');
	assert.deepEqual(structuredFaults({ ...data, description: 'Too short.' }), [
		'Dataset description is 10 characters'
	]);
	assert.deepEqual(structuredFaults({ ...data, temporalCoverage: '2026' }), [
		'Dataset temporalCoverage is not a day interval'
	]);
});

void test('the front door is the company with its address and where a member writes', () => {
	const data = organizationData();
	assert.deepEqual(structuredFaults(data), []);
	assert.equal(data.name, 'Commish LLC');
	assert.equal(data.contactPoint.email, 'help@trycommish.app');
	assert.equal(data.url, 'https://trycommish.app/');
});

void test('the check names each missing field', () => {
	assert.deepEqual(structuredFaults({ ...PERSON, name: '', url: '/players/x' }), [
		'Person has no name',
		'Person has no url'
	]);
	const list = itemListData('List', [{ name: 'A', path: '/players/a' }]);
	assert.deepEqual(structuredFaults({ ...list, itemListElement: [] }), [
		'ItemList has no itemListElement',
		'ItemList numberOfItems is not its length'
	]);
});
