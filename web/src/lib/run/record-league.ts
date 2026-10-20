/** The record opened from a league (Lane 93, rulings 4 and 6): starters right counted in the league's
 * own lineup from the run's graded players, the lineup said in the basis, and for an ESPN league one
 * sentence per graded week on how the lineup our set order picks from the member's roster scored
 * against the lineup ESPN's own projection picks (GET /leagues/attached/{id}/record). */
import { fixed, plural } from '#lib/format/number.ts';
import { listWords } from '#lib/format/list.ts';
import type { components } from '#lib/api/types.ts';
import {
	STANDARD_LINEUP,
	lineupFor,
	playersOf,
	startersRight,
	type PlacedSource,
	type StartingLineup
} from './record-starters.ts';
import type { LeagueBasis } from './record.ts';
import type { PlacedPlayer, RecordLine, RunRecord, Score } from './schema.ts';

export type LeagueRecord = components['schemas']['LeagueRecord'];
export type LeagueRecordWeek = components['schemas']['LeagueRecordWeek'];

/** The first week a league's own benchmark is read for (ruling 1b): the capture starts with week 7. */
export const LEAGUE_BENCHMARK_FROM_WEEK = 7;

/** The league's lineup as the starters count reads it. */
export function lineupOf(record: LeagueRecord): StartingLineup {
	const { qb, rb, wr, te, k, def, flex, super_flex: superFlex } = record.lineup;
	return { teams: record.teams, qb, rb, wr, te, k, def, flex, superFlex };
}

/** Each graded week's players, by week, as the run's players file serves them. */
export type PlayersByWeek = Readonly<Record<number, readonly PlacedPlayer[]>>;

/** Whether every graded week carries its players, so the league's count covers the same weeks as the
 * run's (a run before Lane 93 carries none). */
export function countable(record: RunRecord, players: PlayersByWeek): boolean {
	const graded = record.weeks.filter((week) => week.status === 'graded');
	return graded.length > 0 && graded.every((week) => (players[week.week]?.length ?? 0) > 0);
}

const SOURCES: readonly PlacedSource[] = ['ours', 'adp', 'published'];

function recounted(score: Score, count: { right: number; of: number }): Score {
	return { ...score, starters: count.right, startersOf: count.of };
}

/** A line with each order's starters counted in the lineup. */
function lineIn(
	line: RecordLine,
	players: readonly PlacedPlayer[],
	lineup: StartingLineup
): RecordLine {
	const at = playersOf(players, line.position);
	const shape = lineupFor(lineup, line.position);
	const count = (source: PlacedSource): { right: number; of: number } =>
		startersRight(at, shape, source);
	const [ours, adp, published] = SOURCES.map(count) as [
		ReturnType<typeof count>,
		ReturnType<typeof count>,
		ReturnType<typeof count>
	];
	return {
		...line,
		ours: recounted(line.ours, ours),
		adp: recounted(line.adp, adp),
		published: line.published === null ? null : recounted(line.published, published)
	};
}

/** The season to date's starters: each graded week's, summed, as the run sums its own. */
function toDateIn(record: RunRecord, weeks: RunRecord['weeks']): RecordLine[] {
	return record.toDate.map((line) => {
		const found = weeks.flatMap((week) =>
			week.status === 'graded' ? week.lines.filter((l) => l.position === line.position) : []
		);
		const sum = (pick: (l: RecordLine) => Score | null): { right: number; of: number } =>
			found.reduce(
				(acc, l) => {
					const s = pick(l);
					return s === null ? acc : { right: acc.right + s.starters, of: acc.of + s.startersOf };
				},
				{ right: 0, of: 0 }
			);
		const again = (score: Score | null, pick: (l: RecordLine) => Score | null): Score | null =>
			score === null ? null : recounted(score, sum(pick));
		return {
			...line,
			ours: recounted(
				line.ours,
				sum((l) => l.ours)
			),
			adp: recounted(
				line.adp,
				sum((l) => l.adp)
			),
			published: again(line.published, (l) => l.published),
			// Ours over the weeks that graded the published projection, beside it (review 66j N1).
			oursOnPublished: again(line.oursOnPublished, (l) => (l.published === null ? null : l.ours))
		};
	});
}

/** The lineup a page counts starters right in (Lane 93 fix round 1): the league's own once its
 * record and the run's graded players are read, else the run's standard one. The tiles, the table,
 * the basis and the honest sentence all read this one answer. */
export interface PageLineup {
	lineup: StartingLineup;
	/** True when it is the league's own. */
	league: boolean;
}

export function pageLineup(
	record: RunRecord,
	league: LeagueRecord | null,
	players: PlayersByWeek
): PageLineup {
	return league !== null && countable(record, players)
		? { lineup: lineupOf(league), league: true }
		: { lineup: STANDARD_LINEUP, league: false };
}

/** The record as the page shows it in its lineup: the run's own in the standard one. */
export function shownRecord(
	record: RunRecord,
	players: PlayersByWeek,
	shown: PageLineup
): RunRecord {
	return shown.league ? inLineup(record, players, shown.lineup) : record;
}

/** The starters clause the honest sentence says when a benchmark had more starters right than ours,
 * on the same starters; null when ours had as many. */
function startersClause(name: string, ours: Score | null, theirs: Score | null): string | null {
	if (ours === null || theirs === null) return null;
	if (theirs.starters <= ours.starters || theirs.startersOf !== ours.startersOf) return null;
	return `${name} had more of the week's starters right, ${String(theirs.starters)} of ${String(theirs.startersOf)} against our ${String(ours.starters)}.`;
}

/** The honest sentence in the page's lineup: the run's own in the standard lineup; in a league's,
 * the run's clauses on order matched and places off, and the starters clauses said again from the
 * league's counts, so the sentence and the tiles above it never disagree. */
export function honestWords(run: RunRecord, shown: RunRecord, lineup: PageLineup): string | null {
	if (!lineup.league) return run.honest;
	const kept = (run.honest ?? '')
		.split(/(?<=\.)\s+/u)
		.filter((sentence) => sentence !== '' && !sentence.includes('starters right'));
	const all = shown.toDate.find((line) => line.position === 'All');
	const starters = [
		startersClause('ADP', all?.ours ?? null, all?.adp ?? null),
		startersClause('The published projection', all?.oursOnPublished ?? null, all?.published ?? null)
	].filter((clause): clause is string => clause !== null);
	const said = [...kept, ...starters];
	return said.length === 0 ? null : said.join(' ');
}

/** The record with every graded line's starters counted in the league's lineup, the season to date
 * summed again; the run's own record where a graded week lacks its players. */
export function inLineup(
	record: RunRecord,
	players: PlayersByWeek,
	lineup: StartingLineup
): RunRecord {
	if (!countable(record, players)) return record;
	const weeks = record.weeks.map((week) =>
		week.status === 'graded'
			? { ...week, lines: week.lines.map((line) => lineIn(line, players[week.week] ?? [], lineup)) }
			: week
	);
	return { ...record, weeks, toDate: toDateIn(record, weeks) };
}

/** "QB, 2 RB, 2 WR, TE and a flex": a lineup as a player says it. */
export function lineupWords(lineup: StartingLineup): string {
	const slot = (n: number, name: string): string[] =>
		n === 0 ? [] : [n === 1 ? name : `${String(n)} ${name}`];
	const extra = (n: number, name: string): string[] =>
		n === 0 ? [] : [n === 1 ? `a ${name}` : `${String(n)} ${name}es`];
	return listWords([
		...slot(lineup.qb, 'QB'),
		...slot(lineup.rb, 'RB'),
		...slot(lineup.wr, 'WR'),
		...slot(lineup.te, 'TE'),
		...extra(lineup.flex, 'flex'),
		...extra(lineup.superFlex, 'superflex')
	]);
}

/** The league's own basis sentences: what starters right counts in its lineup, and its own benchmark
 * on an ESPN league. */
export function leagueBasis(record: LeagueRecord, shown: PageLineup): LeagueBasis {
	const { lineup } = shown;
	const unGraded =
		lineup.k + lineup.def > 0
			? ' Its kickers and defenses are not counted: the record grades neither in season.'
			: '';
	const starters = shown.league
		? `Starters right counts your league's lineup, ${lineupWords(lineup)} across ${plural(lineup.teams, 'team')}, and how many of the week's starters there the order also put there.${unGraded}`
		: null;
	const benchmark =
		record.host === 'espn'
			? `In your ESPN league, from week ${String(LEAGUE_BENCHMARK_FROM_WEEK)} each graded week also says how the lineup our order picks from your roster scored against the lineup ESPN's own projection picks, both as your league scores.`
			: null;
	return { starters, benchmark };
}

const BENCHMARK_NAMES: Readonly<Record<LeagueRecordWeek['benchmark'], string>> = {
	espn: "ESPN's projected lineup",
	published: "the published projection's lineup"
};

/** One graded week as the member reads it (ruling 6): "Week 7: our picks beat ESPN's projected lineup
 * by 8.4 points, 97.0 to 88.6." Every figure is the API's tenth, printed as given. */
export function weekSentence(week: LeagueRecordWeek): string {
	const lead = `Week ${String(week.week)}`;
	const them = BENCHMARK_NAMES[week.benchmark];
	const score = `${fixed(week.ours)} to ${fixed(week.theirs)}`;
	if (week.margin > 0)
		return `${lead}: our picks beat ${them} by ${fixed(week.margin)} points, ${score}.`;
	if (week.margin < 0)
		return `${lead}: ${them.charAt(0).toUpperCase()}${them.slice(1)} beat our picks by ${fixed(-week.margin)} points, ${fixed(week.theirs)} to ${fixed(week.ours)}.`;
	return `${lead}: our picks and ${them} scored the same, ${fixed(week.ours)} each.`;
}
