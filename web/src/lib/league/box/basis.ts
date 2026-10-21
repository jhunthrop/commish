/** The in-season screens' basis parts (Lane 66t): what each column is, one short sentence each, so a
 * screen's basis names only the columns it draws, says each thing once, and fits five rendered lines
 * at a desk and eight on a phone. A screen joins the API's sentences (its rule, Gain, the figure a
 * game, the rules our stats lack) with these and hides the ones about columns its phone does not
 * draw (BasisPart.phone). Pure, tested in basis.test.ts. */
import { weekdayTime, zoneWord } from '#lib/format/clock.ts';
import { sentenceStart } from '#lib/format/sentence.ts';
import { lineState, pastKickoff, toPlay } from './kickoff.ts';
import type { BasisPart } from '#lib/run/board-basis.ts';
import type { LeagueHost } from '../api.ts';
import type { PlayerLine, ProjectionScoring } from '../inseason/api.ts';
import { hostWords, nearestRules, rulesOwner } from '../names.ts';
import { BOX, FORMAT_WORDS, expectedWords, factsReadAt, weatherCell } from './box.ts';
import { addressedWeek } from './next-week.ts';

export type { BasisPart };

/** The member's clock as a basis says its times: zoned names the zone after each, where the page says
 * it nowhere else (the in-season pages say it once in their head). */
export interface Clock {
	zone: string;
	zoned: boolean;
}

export function stamp(at: string, clock: Clock): string {
	const time = weekdayTime(at, clock.zone);
	return clock.zoned ? `${time} ${zoneWord(clock.zone)}` : time;
}

export interface ProjFacts {
	readAt: string | null;
	scoring: ProjectionScoring;
	/** A defense is drawn on the screen, so its scoring is named. */
	defense: boolean;
	/** The rows are a league's, so the scoring is said against its rules. */
	league: boolean;
	/** The column's head: Proj on a box score, Wk 6 where the season's Projected sits beside it. */
	head?: string;
	/** A row's game has kicked off, so the sentence says its Proj is as of kickoff (Lane 92, B27). */
	kicked?: boolean;
	/** The league's platform, named where its rules add what the column does not carry. */
	host?: LeagueHost;
	/** The platform's week and the week the page addresses (the API's week and for_week, Lane 95): a
	 * page turned past the platform's week names the week its Proj is for (Lane 111, B70). */
	weeks?: { week: number; for_week?: number };
}

const THIS_WEEKS = "this week's";

/** Whose week a figure is: "this week's" on the platform's week, "week 7's" on a page turned to the
 * week after it (Lane 111, B70). */
export function weeksWord(week: number, platformWeek: number): string {
	return week === platformWeek ? THIS_WEEKS : `week ${String(week)}'s`;
}

/** What a game past kickoff keeps (Lane 92, B27), the end of the Proj sentence. */
export const AS_OF_KICKOFF = 'as of kickoff once started';

/** What Proj final is (Lane 92, B22, round 2), said once where a game has kicked off: a starter to
 * play has his whole Proj left, one in play the rest of it, one done none (Lane 99 fix round 1 said it
 * in one clause, so the phone's basis keeps to eight lines). */
export const PROJ_FINAL_PART = `${BOX.projFinal} adds the ${BOX.pts} and the ${BOX.proj} each starter has left.`;

/** Why a Proj final is drawn "--" (round 2), said once where one is. */
export const NO_PROJ_FINAL_PART = `No ${BOX.projFinal} while a starter still to play has no ${BOX.proj}.`;

/** The Proj final's sentences: what it is once a game has kicked off, and why one is "--" where one
 * is; empty before kickoff. */
export function projFinalWords(started: boolean, missing: boolean): string {
	if (!started) return '';
	return missing ? `${PROJ_FINAL_PART} ${NO_PROJ_FINAL_PART}` : PROJ_FINAL_PART;
}

/** Any row's game past its kickoff at the page's clock, by the one rule (kickoff.ts). */
export function anyKicked(lines: readonly PlayerLine[], now: number): boolean {
	return lines.some(({ facts }) => pastKickoff(facts, now));
}

/** The tight end's extra a catch the league's rules add, its own sentence (Lane 94 fix round 1: said
 * beside "nearest", never as the only difference), credited to whoever sets the rules: "FFPC adds 0.5
 * a catch for TEs.", "Your league adds 0.5 a catch for TEs.", null without one. */
export function teBonusSentence(bonus: number | undefined, host?: LeagueHost): string | null {
	if (bonus === undefined) return null;
	return `${sentenceStart(rulesOwner(host))} adds ${String(bonus)} a catch for TEs.`;
}

/** A league's figures' scoring against its rules: its own, or the column shown nearest them (Lane 94 ruling: "PPR shown, nearest FFPC's rules" where the rules add a tight end's extra). One
 * phrase for every league screen, the League page's team sentence too (Lane 108, B82). */
export function leagueScoringWords(scoring: ProjectionScoring, host?: LeagueHost): string {
	const format = FORMAT_WORDS[scoring.format];
	if (scoring.league_own) return ' on your rules';
	if (scoring.te_bonus === undefined) return `, ${format} nearest your rules`;
	return `, ${format} shown, ${nearestRules(host)}`;
}

/** The figures' scoring: a league's against its rules, else the format alone. */
function whoseScoring(proj: ProjFacts, format: string): string {
	return proj.league ? leagueScoringWords(proj.scoring, proj.host) : ` in ${format}`;
}

/** "Proj is this week's published projection, PPR nearest your rules, read Fri 9:00 pm.", "week 7's"
 * on a page turned to week 7 (Lane 111, B70), or for FFPC's rules "..., PPR shown, nearest FFPC's
 * rules, read Mon 6:00 pm. FFPC adds 0.5 a catch for TEs." */
export function projPart(proj: ProjFacts, clock: Clock): string {
	const format = FORMAT_WORDS[proj.scoring.format];
	const whose = whoseScoring(proj, format);
	const defenses = proj.defense ? ', defenses on default scoring' : '';
	const when = proj.readAt === null ? 'not in yet' : `read ${stamp(proj.readAt, clock)}`;
	const kicked = proj.kicked === true ? `, ${AS_OF_KICKOFF}` : '';
	const bonus = proj.league ? teBonusSentence(proj.scoring.te_bonus, proj.host) : null;
	const week =
		proj.weeks === undefined ? THIS_WEEKS : weeksWord(addressedWeek(proj.weeks), proj.weeks.week);
	const said = `${proj.head ?? BOX.proj} is ${week} published projection${whose}${defenses}, ${when}${kicked}.`;
	return bonus === null ? said : `${said} ${bonus}`;
}

/** "Δ Proj is its change since Thu 9:00 pm.", null without a read before. */
export function deltaPart(previousReadAt: string | null, clock: Clock): string | null {
	return previousReadAt === null
		? null
		: `${BOX.delta} is its change since ${stamp(previousReadAt, clock)}.`;
}

/** The Game cell said whole where the screen draws the expected points and weather in it, its read
 * alone where the cell explains itself, or his next game's on the player card; null when no game still to be played holds a read. */
export function gamePart(
	lines: readonly PlayerLine[],
	clock: Clock,
	now: number,
	say: 'full' | 'read' | 'next'
): string | null {
	const read = factsReadAt(lines, now);
	if (read === null) return null;
	const at = stamp(read, clock);
	if (say === 'next') return `His next game's expected points and weather were read ${at}.`;
	return say === 'full'
		? `${BOX.game} is each club's expected points, his first, and weather, read ${at}.`
		: `${BOX.game} was read ${at}.`;
}

export const OPP_PART = `${BOX.oppRank} is points allowed to his position, 1st fewest.`;

/** Our rank and Opp rank in one sentence where both are drawn (the Lineup, Lane 99 fix round 1). */
export const RANK_OPP_PART = `${BOX.ourRank} is his place at his position in our order, ${BOX.oppRank} the points allowed to it, 1st fewest.`;

/** What the position chip under the Our rank head is (Lane 99, B24), one sentence for the Matchup and
 * the Lineup (fix round 1: short, so the phone's basis keeps to eight lines). */
export const RANK_PART = `${BOX.ourRank} is his place at his position in our order.`;

/** The rule our pick follows, said under the Lineup's rows (Lane 99, B11; fix round 1 shortened it
 * to one clause beside the Our rank sentence). */
export const PICK_PART = `Our pick starts the highest ${BOX.proj} at each slot.`;

/** The words every sentence of when our stats land ends on (KICKED_OFF_PART, Lane 111's two), which
 * the shots scripts look for. */
export const STATS_BY_WEDNESDAY = 'by Wednesday.';

/** When a game's final and its stats land (Lane 80), short enough for a phone's basis: the hourly
 * capture reads the game's status while any game of the week waits on its final, so it turns Final at
 * the pass after it ends, however many passes were missed (Lane 84: no promise of "within the hour");
 * its stats, and so Avg and Last, come with the weekly pass on Tuesday or by Wednesday evening
 * (research JOBS.md). */
/** When a game's Final lands, the start of KICKED_OFF_PART and liveFinalsPart (fix round 1: short, so
 * the phone's basis keeps to eight lines beside the rules our stats omit). */
const FINAL_LANDS = `${BOX.final} lands the hour after a game`;

export const KICKED_OFF_PART = `${FINAL_LANDS}, stats ${STATS_BY_WEDNESDAY}`;

/** KICKED_OFF_PART where a row's game has kicked off with no final yet, or is final with the week's
 * stats not in his games yet, each by the one game-state rule at the page's clock (kickoff.ts
 * lineState), on every screen that asks; else null. */
export function kickedOffPartAt(lines: readonly PlayerLine[], now: number): string | null {
	const waiting = lines.some(({ facts }) => {
		const state = lineState(facts, now);
		// A final the platform's points count (Lane 111) still waits on our stats.
		return (
			state === 'kicked_off' ||
			(state === 'final' &&
				!facts.last_games.some((game) => game.week === facts.week && game.source !== 'platform'))
		);
	});
	return waiting ? KICKED_OFF_PART : null;
}

/** What Avg and Last count of a final our stats have not landed (Lane 111, B23), said once where a row
 * counts the platform's points for one (the API's last_games source): this week's finals, or the
 * platform week's on a page turned past it. */
export function platformFinalsPart(host: LeagueHost, week: string, rostered: string): string {
	return `${BOX.avg} and ${BOX.last} count ${week} finals from ${hostWords(host)}'s points${rostered}, our stats ${STATS_BY_WEDNESDAY}`;
}

/** KICKED_OFF_PART and platformFinalsPart in one sentence, where a row's game is still in play beside
 * one the platform's points count (Lane 108's budget: merge before hiding). */
export function liveFinalsPart(host: LeagueHost, rostered: string): string {
	return `${FINAL_LANDS}, ${BOX.avg} and ${BOX.last} then count ${hostWords(host)}'s points${rostered}, our stats ${STATS_BY_WEDNESDAY}`;
}

/** The phone's sentence where the platform's points count (Lane 111 fix round 1, HIGH-1): the figure
 * the phone draws keeps a sentence that says what it counts, within its eight lines. */
export function phoneFinalsPart(host: LeagueHost): string {
	return `${BOX.avg} and ${BOX.last} count ${hostWords(host)}'s finals, our stats ${STATS_BY_WEDNESDAY}`;
}

/** Waivers' sentence once a final is in (Lane 111 fix round 1, MEDIUM-3): its rows are free agents,
 * whom the platform does not score, so their Avg and Last are our stats until the week's land. */
export function freeAgentsPart(week: number): string {
	return `Free agents' ${BOX.avg} and ${BOX.last} are our stats, week ${String(week)}'s ${STATS_BY_WEDNESDAY}`;
}

/** Said on the league's order, whose rows mix rostered players and free agents: the platform scores
 * only rostered players, so a free agent's Avg and Last wait on our stats and the sentence does not
 * claim his. */
export const FOR_ROSTERED = ' for rostered players';

/** A row's final the platform's points count, null without one. */
function platformGame(line: PlayerLine): PlayerLine['facts']['last_games'][number] | null {
	return line.facts.last_games.find((game) => game.source === 'platform') ?? null;
}

/** Whose rows a screen draws: the league's rostered players alone (the Lineup, the Matchup, Trades),
 * or its pool too (the league's order). */
export type RowsOf = 'rosters' | 'pool';

/** When a row's Final and its stats land, and what Avg and Last count meanwhile, by the one game-state
 * rule at the page's clock: the platform's points for a final where any row counts them (Lane 111),
 * merged with when Final lands while a game is still in play; else kickedOffPartAt. No platform (a
 * reader with no league) is our stats alone. */
export function finalsPartAt(
	lines: readonly PlayerLine[],
	now: number,
	host: LeagueHost | null,
	rows: RowsOf
): string | null {
	const counted = lines.find((line) => platformGame(line) !== null);
	const game = counted === undefined ? null : platformGame(counted);
	if (host === null || counted === undefined || game === null) return kickedOffPartAt(lines, now);
	const rostered = rows === 'pool' ? FOR_ROSTERED : '';
	if (lines.some(({ facts }) => lineState(facts, now) === 'kicked_off'))
		return liveFinalsPart(host, rostered);
	return platformFinalsPart(host, weeksWord(game.week, counted.facts.week), rostered);
}

/** finalsPartAt as a basis's parts: the sentence where the platform's points count (Lane 111) at a
 * desk, and on a phone, whose eight lines cannot hold it beside the rules our stats lack (Lane 108's
 * budget, measured on the fixture's five rules), its short form (phoneFinalsPart, fix round 1) while
 * a row waits on Final or our stats. onPhone false says neither on a phone (the Lineup while a row
 * still draws its fact cells, Lane 85). */
export function finalsParts(
	lines: readonly PlayerLine[],
	now: number,
	host: LeagueHost | null,
	rows: RowsOf,
	onPhone: boolean
): BasisPart[] {
	const full = finalsPartAt(lines, now, host, rows);
	if (full === null) return [];
	const timing = kickedOffPartAt(lines, now);
	// Nothing waits on Final or our stats in the page's week (a page turned past the platform's):
	// the one sentence is said on both.
	if (full === timing || timing === null) return [{ text: full, phone: onPhone }];
	// Here full is the platform's sentence (finalsPartAt is kickedOffPartAt otherwise), so its host is
	// named.
	const short = host === null ? timing : phoneFinalsPart(host);
	const phone: BasisPart[] = onPhone ? [{ text: short, phone: true, desk: false }] : [];
	return [{ text: full, phone: false }, ...phone];
}

/** Waivers' parts: once a row counts the platform's points (a drop on the member's roster), the
 * free agents' own state, one sentence on both (fix round 1, MEDIUM-3); else when Final and the stats
 * land (kickedOffPartAt). */
export function waiverFinalsParts(lines: readonly PlayerLine[], now: number): BasisPart[] {
	const game = lines.map(platformGame).find((g) => g !== null) ?? null;
	return said(game === null ? kickedOffPartAt(lines, now) : freeAgentsPart(game.week));
}

/** Avg and Last where a page says what they are (the player card): in the scoring the rows are in. */
export function avgLastPart(scoring: string): string {
	return `${BOX.avg} and ${BOX.last} are his points a game and last game, ${scoring}.`;
}

/** What a screen's Team row prints: the rows it shows added, or the platform's own total (the Matchup
 * on a platform that sends one, ruling (a) of Lane 79). */
export type TeamFigure = 'rows' | 'platform';

/** The Pts column and the Team row in one sentence, by the API's per-platform rule (player_points,
 * team_total, Lane 79): the platform's points by player so far and what Team is, else its team points
 * with none by player (Team is then that total). */
export function ptsPart(byPlayer: boolean, host: LeagueHost, team: TeamFigure): string {
	const platform = hostWords(host);
	if (!byPlayer) return `${BOX.pts} are ${platform}'s team points, none by player.`;
	return team === 'platform'
		? `${BOX.pts} are ${platform}'s points by player so far, each to a tenth, and Team is ${platform}'s score.`
		: `${BOX.pts} are ${platform}'s points so far, Team adds the rows.`;
}

/** The API's sentence naming the rules our stats lack (Lane 111, B33: "Our stats omit two-point
 * and safety."), no link to follow; none when it names none. */
export function uncountedPart(advice: { basis_note: string }): BasisPart[] {
	return said(advice.basis_note);
}

/** A sentence part for a basis, none for an empty one. */
export function said(text: string | null, phone = true): BasisPart[] {
	return text === null || text === '' ? [] : [{ text, phone }];
}

/** The block as one paragraph reads, every part drawn: a link that more words follow closes its
 * sentence (BasisBlock draws the same). */
export function basisText(parts: readonly BasisPart[]): string {
	return parts.map((p, i) => (p.href && i < parts.length - 1 ? `${p.text}.` : p.text)).join(' ');
}

/** Whether any row still to be played draws the Game cell's expected score or weather. */
function drawsFacts(lines: readonly PlayerLine[], now: number): boolean {
	return lines.some(
		({ facts }) =>
			toPlay(facts, now) && (expectedWords(facts) !== null || weatherCell(facts) !== null)
	);
}

/** What a box score screen's key is told (BoxBasis): the projection, the lines drawn, the Pts
 * column's source, and on the Lineup its evidence columns' change and uncounted rules. */
export interface BoxBasisFacts {
	projection: { readAt: string | null; scoring: ProjectionScoring } | null;
	lines: readonly PlayerLine[];
	byPlayer: boolean;
	/** The platform sends the side's own total, which the Matchup's Team row prints (team_total). */
	teamTotal: boolean;
	/** A Team row draws its Proj final "--" (no figure from the API while the game is live). */
	noFinal?: boolean;
	host: LeagueHost;
	/** The Lineup's: whether its strip already says whose lineup it is ("as set on ESPN"; the rule for
	 * our pick is then said at a desk alone, Lane 99 fix round 1), the read the change counts from,
	 * and the API's sentence naming the rules our stats lack; null on the Matchup, which draws no
	 * evidence columns. */
	lineup: {
		asSetShown: boolean;
		previousReadAt: string | null;
		note: { basis_note: string };
	} | null;
}

/** A box score screen's key under its rows, one paragraph (Lane 66t): on the Lineup the rule for our
 * pick, Proj, its change (a desk column), the Game cell, Our rank, Opp rank, Pts and the rules Avg and
 * Last leave out; on the Matchup Proj, Our rank, Pts and the Game cell, the columns it draws. */
export function boxBasisParts(facts: BoxBasisFacts, clock: Clock, now: number): BasisPart[] {
	const defense = facts.lines.some((l) => l.player.position === 'DEF');
	const kicked = anyKicked(facts.lines, now);
	const proj = facts.projection
		? said(
				projPart({ ...facts.projection, defense, league: true, kicked, host: facts.host }, clock)
			)
		: [];
	// What the Team row's small figure is once a game has kicked off (Lane 92, B22).
	const final = said(projFinalWords(kicked, facts.noFinal === true));
	const { lineup } = facts;
	// The Lineup's Team adds the lineup's rows; the Matchup's is the platform's total where it sends one.
	const team = lineup === null && facts.teamTotal ? 'platform' : 'rows';
	const pts = said(ptsPart(facts.byPlayer, facts.host, team));
	// When a row's Final and its stats land, said while one waits on either (Lane 85), and what Avg and
	// Last count meanwhile (Lane 111).
	const waiting = (onPhone: boolean): BasisPart[] =>
		finalsParts(facts.lines, now, facts.host, 'rosters', onPhone);
	if (lineup === null)
		return [
			...proj,
			...final,
			...said(RANK_PART),
			...pts,
			...said(gamePart(facts.lines, clock, now, 'full')),
			...waiting(true)
		];
	return [
		...said(PICK_PART, !lineup.asSetShown),
		...proj,
		...final,
		...said(deltaPart(lineup.previousReadAt, clock), false),
		...said(gamePart(facts.lines, clock, now, 'full')),
		// On the Lineup phone the expected score and weather are the decision's facts and keep their
		// cells and sentence: the Final sentence is said at a desk while any row still draws them, and
		// on the phone too once none does (Lane 85 fix round 2, the coordinator's ruling on brief item 4).
		...waiting(!drawsFacts(facts.lines, now)),
		...said(RANK_OPP_PART),
		...pts,
		...uncountedPart(lineup.note)
	];
}
