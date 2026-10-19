// The kickers' and defenses' week (Lane 66w): its rows, sections, basis and empty state, over the
// fixture API's two answers (scripts/inseason-fixture/week-order.ts). Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { FIGURE } from '#lib/format/figure-words.ts';
import { KICKED_OFF_PART } from '#lib/league/box/basis.ts';
import { BOX } from '#lib/league/box/box.ts';
import type { WeekOrderAdvice } from './api.ts';
import { stamped } from '../../../scripts/inseason-fixture/game-state.ts';
import { weekOrderPath } from './path.ts';
import {
	foldedEvidence,
	landed,
	rulesLeftOut,
	weekBasis,
	weekRosterFilter,
	weekSections,
	weekStatus,
	weekView,
	WEEK_NOUNS,
	WEEK_TAB,
	type WeekView
} from './week.ts';
import { weekHeading, weekPositionOf } from './week-head.ts';
import { WEEK } from './words.ts';

const ZONE = 'America/Chicago';
/** Saturday noon Central of week 6, and the Tuesday before (scripts/inseason-fixture/clock.ts). */
const SATURDAY = Date.parse('2026-10-17T17:00:00.000Z');
const TUESDAY = Date.parse('2026-10-13T17:00:00.000Z');
/** The stored week, each tab with the API's rules sentence for a member (two rules each). */
const stored = JSON.parse(
	readFileSync(
		new URL('../../../scripts/inseason-fixture/data/week-order.json', import.meta.url),
		'utf8'
	)
) as Record<
	'read' | 'unread',
	Record<'K' | 'DEF', Omit<WeekOrderAdvice, 'basis_note' | 'basis_note_link'>>
>;
const RULES_NOTE = {
	basis_note: 'Avg and Last miss two of your rules our stats lack.',
	basis_note_link: 'Which two'
};
const withNote = (
	tabs: Record<'K' | 'DEF', Omit<WeekOrderAdvice, 'basis_note' | 'basis_note_link'>>
): Record<'K' | 'DEF', WeekOrderAdvice> => ({
	K: { ...tabs.K, ...RULES_NOTE },
	DEF: { ...tabs.DEF, ...RULES_NOTE }
});
// The fixture API's answers as it serves them: every game stamped with the API's state at its clock.
const fixture = {
	read: withNote(stamped(stored.read, SATURDAY) as typeof stored.read),
	unread: withNote(stamped(stored.unread, TUESDAY) as typeof stored.unread)
};
const visitor = (a: WeekOrderAdvice): WeekOrderAdvice => ({
	...a,
	read_at: null,
	moves: null,
	rows: a.rows.map((r) => ({ ...r, roster: null, move: null }))
});
const ESPN = { league: { id: 'office', host: 'espn' as const }, boardScoring: 'PPR' };
const VISITOR = { league: null, boardScoring: 'PPR' };
const settingsHref = (id: string): string => `/league/${id}?view=settings#uncounted`;
const text = (parts: readonly { text: string }[]): string => parts.map((p) => p.text).join(' ');
const views = (a: WeekOrderAdvice, now: number): WeekView[] =>
	a.rows.map((r) => weekView(r, ZONE, now));

void test("the tabs' heads and positions: never the rest of the season", () => {
	assert.equal(weekPositionOf('K'), 'K');
	assert.equal(weekPositionOf('DST'), 'DEF');
	assert.equal(weekPositionOf('RB'), null);
	assert.equal(weekHeading('K', 6), 'Week 6 kickers');
	assert.equal(weekHeading('DEF', 7), 'Week 7 defenses');
	assert.equal(weekHeading('DEF', null), "This week's defenses");
});

void test('the route asks for the position, in a league and with none', () => {
	assert.equal(weekOrderPath(null, 'K'), '/order/week?position=K');
	assert.equal(
		weekOrderPath('6f1d/x', 'DEF'),
		'/leagues/attached/6f1d%2Fx/order/week?position=DEF'
	);
});

void test("a defense's row is its club's D/ST with its mark from our route, a kicker his face", () => {
	const [def] = views(fixture.read.DEF, SATURDAY);
	assert.ok(def);
	assert.match(def.box.name, / D\/ST$/);
	assert.equal(def.box.face.mark, true);
	assert.match(def.box.face.src ?? '', /^\/img\/clubs\/nfl\/[a-z]+\/64$/);
	const [k] = views(fixture.read.K, SATURDAY);
	assert.ok(k);
	assert.equal(k.box.face.mark, false);
	assert.equal(k.box.pill?.rank ?? null, null);
	assert.equal(k.position, 'K');
});

void test('the sections: to play first, then the played Thursday games marked Final, then the byes', () => {
	const sections = weekSections(views(fixture.read.DEF, SATURDAY), 6, ZONE);
	assert.deepEqual(
		sections.map((s) => s.head),
		[null, 'Played Thursday', 'Bye in week 6']
	);
	const played = sections[1]?.rows ?? [];
	assert.equal(played.length, 2);
	for (const row of played) {
		assert.ok(row.box.game !== null && row.box.game !== 'bye');
		assert.equal(row.box.game.when, 'Final');
		assert.equal(row.box.expected, null);
	}
	assert.equal(sections[2]?.rows.length, 4);
	// A section with no rows is not drawn: on Tuesday nothing has kicked off.
	assert.deepEqual(
		weekSections(views(fixture.unread.DEF, TUESDAY), 6, ZONE).map((s) => s.head),
		[null, 'Bye in week 6']
	);
});

void test('a week whose games have kicked off but are not all final says so', () => {
	const sunday = fixture.read.K.rows.map((r) =>
		r.section === 'to_play'
			? { ...r, section: 'kicked_off' as const, line: { ...r.line, facts: { ...r.line.facts } } }
			: r
	);
	const heads = weekSections(
		sunday.map((r) => weekView(r, ZONE, Date.parse('2026-10-18T18:00:00.000Z'))),
		6,
		ZONE
	).map((s) => s.head);
	assert.deepEqual(heads, ['Kicked off', 'Bye in week 6']);
});

void test("the Monday after: the API's kicked-off rows say Kicked off, and the basis when Final lands (Lane 80)", () => {
	const monday = Date.parse('2026-10-19T11:00:00.000Z');
	const advice = visitor(fixture.read.K);
	const kicked: WeekOrderAdvice = {
		...advice,
		rows: advice.rows.map((r) =>
			r.section === 'to_play'
				? {
						...r,
						section: 'kicked_off' as const,
						line: { ...r.line, facts: { ...r.line.facts, game_state: 'kicked_off' as const } }
					}
				: r
		)
	};
	const view = views(kicked, monday).find(
		(v) => v.section === 'kicked_off' && v.box.game !== 'bye'
	);
	const game = view?.box.game;
	assert.ok(game !== undefined && game !== null && game !== 'bye');
	assert.equal(game.when, BOX.kickedOff);
	const said = weekBasis(kicked, VISITOR, ZONE, monday);
	assert.ok(
		said.some((p) => p.text === KICKED_OFF_PART && !p.phone),
		text(said)
	);
	// Saturday: Thursday's games are final, their kickers' stats not in yet, so the basis says they follow.
	assert.ok(text(weekBasis(advice, VISITOR, ZONE, SATURDAY)).includes(KICKED_OFF_PART));
});

void test('the projection is in once a row has a Proj, and not before', () => {
	assert.equal(landed(fixture.read.K), true);
	assert.equal(landed(fixture.unread.K), false);
	assert.equal(weekStatus(fixture.read.K), null);
	const status = weekStatus(fixture.unread.K);
	assert.deepEqual(status, {
		lead: "Week 6's projection for kickers is not in yet.",
		rest: 'Until it is, there is no Proj, and the kickers below are in order of Avg.'
	});
});

void test("a visitor's kickers' basis: the order with the model we lack, Opp rank, Avg and Last in PPR, the Game read", () => {
	const basis = weekBasis(visitor(fixture.read.K), VISITOR, ZONE, SATURDAY);
	assert.equal(
		text(basis),
		"Kickers are in order of Proj, this week's published projection in PPR scoring, read Fri 9:00 pm Central, as we have no kicker model of our own. " +
			'Opp rank is points allowed to kickers this season, 1st the fewest. ' +
			'Avg and Last are his points a game and last game, in PPR. ' +
			"Game is each club's expected points, his first, and the kickoff weather, read Fri 4:01 pm Central. " +
			KICKED_OFF_PART
	);
});

void test("a member's defenses' basis: its default scoring, the league's own points, and whose the rosters are", () => {
	const basis = weekBasis(fixture.read.DEF, ESPN, ZONE, SATURDAY);
	assert.deepEqual(
		basis.map((p) => p.phone),
		[true, true, true, true, false, false]
	);
	const said = text(basis);
	assert.match(
		said,
		/^Defenses are in order of Proj, this week's published projection on its default defense scoring, read Fri 9:00 pm Central, /
	);
	assert.match(said, /read Fri 9:00 pm Central, as we have no defense model of our own\./);
	assert.match(said, /Opp rank is points allowed to defenses this season/);
	assert.match(said, /its points a game and last game, in this league's scoring\./);
	assert.match(said, /the defense's first/);
	assert.match(said, /Roster is ESPN's, read /);
	assert.doesNotMatch(said, /host/i);
});

void test('before the projection the basis orders by Avg and says the Game cell has only the kickoff', () => {
	const said = text(weekBasis(visitor(fixture.unread.K), VISITOR, ZONE, TUESDAY));
	assert.match(
		said,
		/^Kickers are in order of Avg until this week's published projection is in\. /
	);
	assert.doesNotMatch(said, /model of our own/);
	assert.match(
		said,
		/The Game cell shows the opponent and kickoff\. Expected points and weather come later in the week\.$/
	);
});

void test("a visitor's basis names the board's own scoring", () => {
	const half = { league: null, boardScoring: 'Half PPR' };
	const said = text(weekBasis(visitor(fixture.read.K), half, ZONE, SATURDAY));
	assert.match(said, /projection in Half PPR scoring/);
	assert.match(said, /and last game, in Half PPR\./);
	assert.doesNotMatch(said, /\bin PPR\b/);
});

void test('the rules Avg and Last leave out are a count with the way to Settings, never a list', () => {
	assert.deepEqual(rulesLeftOut(fixture.read.K, ESPN, settingsHref), {
		text: 'Avg and Last miss two of your rules our stats lack.',
		link: { words: 'Which two', href: '/league/office?view=settings#uncounted' }
	});
	// The API's sentence, printed as it comes; a reader with no league has no Settings to open.
	const visitorNote = 'Avg and Last miss one of the PPR rules our stats lack.';
	assert.deepEqual(
		rulesLeftOut({ basis_note: visitorNote, basis_note_link: '' }, VISITOR, settingsHref),
		{ text: visitorNote, link: null }
	);
	assert.equal(rulesLeftOut({ basis_note: '', basis_note_link: '' }, ESPN, settingsHref), null);
});

void test('the roster chips filter the rows the API sent, the adds where the API set them', () => {
	const all = views(fixture.read.DEF, SATURDAY);
	const free = all.filter(weekRosterFilter('free'));
	const yours = all.filter(weekRosterFilter('yours'));
	assert.ok(free.length > 5 && free.every((r) => r.roster?.kind === 'free'));
	assert.ok(yours.length >= 1 && yours.every((r) => r.roster?.kind === 'yours'));
	assert.equal(all.filter(weekRosterFilter('everyone')).length, all.length);
	assert.equal(all.filter((r) => r.move === 'add').length, 5);
});

void test('the evidence folds under the name in one short line, no rank on a bye', () => {
	const all = views(fixture.read.K, SATURDAY);
	const playing = all.find((r) => r.section === 'to_play');
	const bye = all.find((r) => r.section === 'bye');
	assert.ok(playing && bye);
	assert.match(foldedEvidence(playing), /^Opp \d+(st|nd|rd|th), Avg \d+\.\d, Last \d+\.\d$/);
	assert.match(foldedEvidence(bye), /^Avg \d+\.\d, Last \d+\.\d$/);
});

void test('every word the tab prints passes the copy guard', () => {
	const banned = bannedPattern();
	for (const position of ['K', 'DEF'] as const) {
		for (const said of [
			text(weekBasis(fixture.read[position], ESPN, ZONE, SATURDAY)),
			text(weekBasis(visitor(fixture.unread[position]), VISITOR, ZONE, TUESDAY)),
			rulesLeftOut(fixture.read[position], ESPN, settingsHref)?.text ?? '',
			Object.values(weekStatus(fixture.unread[position]) ?? {}).join(' '),
			...Object.values(WEEK_NOUNS[position]),
			...Object.values(WEEK_TAB),
			...Object.values(WEEK)
		]) {
			// The one guard's words and marks (format/copy-guard.ts bannedPattern, BANNED_MARKS in it).
			assert.doesNotMatch(said, banned, said);
		}
	}
});

void test("the tab's figure heads are the site's one table (Lane 66s): Avg from figure-words, Proj the one-week box's own", () => {
	const said = text(weekBasis(fixture.read.K, ESPN, ZONE, SATURDAY));
	assert.equal(BOX.avg, FIGURE.avg);
	assert.ok(said.includes(`${FIGURE.avg} and ${BOX.last} are his points a game`), said);
	assert.equal(weekStatus(fixture.unread.K)?.rest.endsWith(`in order of ${FIGURE.avg}.`), true);
	assert.doesNotMatch(
		said,
		new RegExp(`\\b(${FIGURE.projected}|${FIGURE.perGame}|${FIGURE.week})\\b`)
	);
});
