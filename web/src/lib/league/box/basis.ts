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

/** Why a side's Final reads "--" (Lane 121 fix round 1): its platform sends us no score for it (an
 * FFPC opponent the read holds no box for, a score unread). Said once where one is. */
export function finalNonePart(host: LeagueHost): string {
	return `A ${BOX.final} of ${BOX.none} is a score ${hostWords(host)} does not send us.`;
}

/** What the teams a platform sends no lineup for draw on a board (every side of FFPC's scoreboard but
 * the member's, Lane 125, B104; Lane 127, B105 and fix round 1), each said once where it is drawn. */
export interface UnlistedDrawn {
	/** A side's Proj or Proj final is our best lineup's from its roster (projection_best_lineup). */
	bestLineup: boolean;
	/** A side draws "--" under Proj or Proj final: the platform sends us no roster for it either. */
	noRoster: boolean;
	/** A best-lineup side draws a Proj final that counts a player in play at his projection's pace (the
	 * API's projected_final_paced, Lane 127 fix round 3), said in the same sentence. */
	paced: boolean;
}

export const NONE_UNLISTED: UnlistedDrawn = { bestLineup: false, noRoster: false, paced: false };

/** How a best lineup's in-play player counts where the platform gives no player's points (Lane 127 fix
 * round 3, roster_projection.go inPlayAt): the clause the sentence gains while a Proj final is drawn. */
export const PACE_CLAUSE = "in-play players at their projection's pace";

/** The words for the teams a platform sends no lineup for (Lane 127 fix round 1): one sentence covers
 * their Proj and their Proj final alike, said once, the "--" of a team with no roster read beside it
 * (the coordinator's ruling: one sentence); a board whose every such team draws "--" (no roster read,
 * or an answer before Lane 127) says why. Empty with none drawn. */
export function unlistedPart(host: LeagueHost, drawn: UnlistedDrawn): string {
	const platform = hostWords(host);
	if (drawn.bestLineup)
		return `${BOX.proj} for teams ${platform} sends no lineup for is our best lineup from their rosters${drawn.paced ? `, ${PACE_CLAUSE}` : ''}.`;
	return drawn.noRoster ? `Teams ${platform} sends no lineup or roster for read ${BOX.none}.` : '';
}

/** The Proj final's sentences: what it is once a game has kicked off, and why one is "--" where one
 * is; empty before kickoff. */
export function projFinalWords(started: boolean, missing: boolean): string {
	if (!started) return '';
	return missing ? `${PROJ_FINAL_PART} ${NO_PROJ_FINAL_PART}` : PROJ_FINAL_PART;
}

/** projFinalWords in a phone's one sentence (Lane 115 fix round 1, MEDIUM-1): why the Proj final is
 * "--" where it is, else what it adds. */
export function projFinalPhone(started: boolean, missing: boolean): string {
	if (!started) return '';
	return missing ? NO_PROJ_FINAL_PART : PROJ_FINAL_PART;
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

/** Which of the Proj sentence's clauses a width says (Lane 115): a phone leaves the defenses' scoring
 * to the desk, and the league's order's phone its scoring (its head says "Your league scores PPR."),
 * its read time and what a started game's Proj is too, qualifications the desk says (fix round 1,
 * MEDIUM-2: the "--" keeps its clause instead). */
interface ProjSays {
	defenses: boolean;
	scoring: boolean;
	kicked: boolean;
	read: boolean;
}

const DESK_SAYS: ProjSays = { defenses: true, scoring: true, kicked: true, read: true };
const PHONE_SAYS: ProjSays = { defenses: false, scoring: true, kicked: true, read: true };
const ORDER_PHONE_SAYS: ProjSays = { defenses: false, scoring: false, kicked: false, read: false };
/** The phone Matchup's (Lane 124): the defenses' scoring and what a started game's Proj is left to the
 * desk, as the phone order's, so its eight lines hold FFPC's tight end sentence beside the Final's. */
const MATCHUP_PHONE_SAYS: ProjSays = { defenses: false, scoring: true, kicked: false, read: true };

/** A clause of the Proj sentence and the ProjSays field that says it (null: every width says it). */
interface ProjClause {
	text: string;
	says: keyof ProjSays | null;
}

/** The clause a projection over a defense adds after its scoring. */
const DEFENSES_CLAUSE = ', defenses on default scoring';

/** What the projection is, clause by clause: "this week's published projection" ("week 7's" on a page
 * turned to week 7, Lane 111, B70), its scoring, the defenses', its read and a started game's Proj,
 * a clause empty where the projection has nothing to say there. */
function projClauses(proj: ProjFacts, clock: Clock): ProjClause[] {
	const format = FORMAT_WORDS[proj.scoring.format];
	const when = proj.readAt === null ? 'not in yet' : `read ${stamp(proj.readAt, clock)}`;
	const week =
		proj.weeks === undefined ? THIS_WEEKS : weeksWord(addressedWeek(proj.weeks), proj.weeks.week);
	return [
		{ text: `${week} published projection`, says: null },
		{ text: whoseScoring(proj, format), says: 'scoring' },
		{ text: proj.defense ? DEFENSES_CLAUSE : '', says: 'defenses' },
		{ text: `, ${when}`, says: 'read' },
		{ text: proj.kicked === true ? `, ${AS_OF_KICKOFF}` : '', says: 'kicked' }
	];
}

function saidBy(clause: ProjClause, says: ProjSays): boolean {
	return clause.says === null || says[clause.says];
}

/** What the projection is, the words after "Proj is": "this week's published projection, PPR nearest
 * your rules, defenses on default scoring, read Fri 9:00 pm, as of kickoff once started", each clause
 * where the width says it (ProjSays). */
function projWhat(proj: ProjFacts, clock: Clock, says: ProjSays): string {
	return projClauses(proj, clock)
		.filter((c) => saidBy(c, says))
		.map((c) => c.text)
		.join('');
}

/** A clause of a sentence and the widths that draw it. */
interface WidthClause {
	text: string;
	desk: boolean;
	phone: boolean;
}

/** One sentence whose clauses differ by width, as parts in the page once (Lane 132, B111): each run of
 * clauses the same widths draw is one part, every part after the first joined to the one before, so
 * each width draws its own clauses of the one sentence. */
function widthParts(clauses: readonly WidthClause[]): BasisPart[] {
	const runs = clauses
		.filter((c) => c.text !== '' && (c.desk || c.phone))
		.reduce<WidthClause[]>((acc, c) => {
			const last = acc.at(-1);
			return last?.desk === c.desk && last.phone === c.phone
				? [...acc.slice(0, -1), { ...last, text: last.text + c.text }]
				: [...acc, c];
		}, []);
	return runs.map((r, i) => ({
		text: r.text,
		phone: r.phone,
		...(r.desk ? {} : { desk: false as const }),
		...(i > 0 ? { joined: true as const } : {})
	}));
}

/** The tight end's extra after a Proj sentence, where the league's rules add one. */
function withBonus(said: string, proj: ProjFacts): string {
	const bonus = proj.league ? teBonusSentence(proj.scoring.te_bonus, proj.host) : null;
	return bonus === null ? said : `${said} ${bonus}`;
}

/** "Proj is this week's published projection, PPR nearest your rules, read Fri 9:00 pm.", "week 7's"
 * on a page turned to week 7 (Lane 111, B70), or for FFPC's rules "..., PPR shown, nearest FFPC's
 * rules, read Mon 6:00 pm. FFPC adds 0.5 a catch for TEs." */
export function projPart(proj: ProjFacts, clock: Clock): string {
	return withBonus(`${proj.head ?? BOX.proj} is ${projWhat(proj, clock, DESK_SAYS)}.`, proj);
}

/** The Matchup's Proj sentence, in the page once (Lane 132, B111): projPart's clauses at a desk, the
 * phone leaving the defenses' scoring and a started game's Proj to the desk (Lane 124,
 * MATCHUP_PHONE_SAYS), and FFPC's tight end extra after it at both widths. */
export function projMatchupParts(proj: ProjFacts, clock: Clock): BasisPart[] {
	const both = { desk: true, phone: true };
	const clauses = projClauses(proj, clock).map((c) => ({
		text: c.text,
		desk: saidBy(c, DESK_SAYS),
		phone: saidBy(c, MATCHUP_PHONE_SAYS)
	}));
	const bonus = proj.league ? teBonusSentence(proj.scoring.te_bonus, proj.host) : null;
	return [
		...widthParts([
			{ text: `${proj.head ?? BOX.proj} is `, ...both },
			...clauses,
			{ text: '.', ...both }
		]),
		...said(bonus)
	];
}

/** projPart with no read time (Lane 139, C12): where the tile itself says when the projection was
 * read, as the player card's week tile does. */
export function projUnstampedPart(proj: ProjFacts, clock: Clock): string {
	return withBonus(
		`${proj.head ?? BOX.proj} is ${projWhat(proj, clock, { ...DESK_SAYS, read: false })}.`,
		proj
	);
}

/** projPart in a phone's words (Lane 115): the defenses' scoring left to the desk. */
export function projPhonePart(proj: ProjFacts, clock: Clock): string {
	return withBonus(`${proj.head ?? BOX.proj} is ${projWhat(proj, clock, PHONE_SAYS)}.`, proj);
}

/** The rule our pick follows and what Proj is in one sentence, the phone Lineup's (Lane 115, B83):
 * "Our pick is each slot's highest Proj, this week's published projection, PPR nearest your rules,
 * read Fri 9:00 pm." */
export function pickProjPart(proj: ProjFacts, clock: Clock): string {
	return withBonus(`${PICK_PHONE} ${projWhat(proj, clock, PHONE_SAYS)}.`, proj);
}

/** The week column and what its Proj is in one sentence, the phone order's (Lane 115, B92): "Wk 6 is
 * Pts once final, -- until his stats land, else this week's published projection." Its "--" keeps its
 * clause (fix round 1, MEDIUM-2); the page's head says its scoring, the desk its read time and a
 * started game's Proj. */
export function weekProjPart(head: string, proj: ProjFacts, clock: Clock): string {
	return `${head} is ${BOX.pts} once final, ${BOX.none} until his stats land, else ${projWhat(proj, clock, ORDER_PHONE_SAYS)}.`;
}

/** A sentence a phone says shorter (Lane 111's phone-only parts): the desk's words at a desk, the
 * phone's on a phone; one part where they agree. */
export function deskOrPhone(desk: string | null, phone: string | null): BasisPart[] {
	if (desk === phone) return said(desk);
	return [
		...(desk === null || desk === '' ? [] : [{ text: desk, phone: false }]),
		...(phone === null || phone === '' ? [] : [{ text: phone, phone: true, desk: false as const }])
	];
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

/** The rule's phone clause, the head of the phone's Proj sentence (pickProjPart, Lane 115, B83). */
const PICK_PHONE = `Our pick is each slot's highest ${BOX.proj},`;

/** Our rank and Opp rank in a phone's words, the row's own "Opp 3rd" (Lane 115, B83). */
export const RANK_OPP_PHONE = `${BOX.ourRank} is his place at his position, ${BOX.opp} the points allowed to it, 1st fewest.`;

/** Opp rank in a phone's words, as its rows say it ("Opp 26th", Lane 115, B92). */
export const OPP_PHONE = `${BOX.opp} is points allowed to his position, 1st fewest.`;

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
export function phoneFinalsPart(host: LeagueHost, rows: RowsOf = 'rosters'): string {
	// The league's order mixes free agents, whom the platform does not score (Lane 115, B92).
	const whose = rows === 'pool' ? `${ROSTERED_PLAYERS} ${hostWords(host)}` : `${hostWords(host)}'s`;
	return `${BOX.avg} and ${BOX.last} count ${whose} finals, our stats ${STATS_BY_WEDNESDAY}`;
}

/** Whose finals the phone's sentence counts on the league's order (phoneFinalsPart). */
const ROSTERED_PLAYERS = "rostered players'";

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
	const short = host === null ? timing : phoneFinalsPart(host, rows);
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

/** The Pts sentence in a phone's words where the Team row adds the rows (the Lineup, Lane 115, B83):
 * what Team adds left to the desk, a platform with no player's points said in fewer words. */
export function ptsPhonePart(byPlayer: boolean, host: LeagueHost): string {
	const platform = hostWords(host);
	return byPlayer
		? `${BOX.pts} are ${platform}'s points so far.`
		: `${BOX.pts} are ${platform}'s team points alone.`;
}

/** The rules our stats lack in a sentence, the API's names in one of two frames (Lane 115, B92): where
 * a row counts the platform's points, which score every rule, the stats' sentence; where none does,
 * Avg and Last are our stats alone and the sentence says so. */
export const UNCOUNTED = {
	stats: (names: string): string => `Our stats omit ${names}.`,
	ours: (names: string): string => `${BOX.avg} and ${BOX.last} are our stats, which omit ${names}.`
} as const;

/** The sentence naming the rules our stats lack (Lane 111, B33), no link to follow; none when it
 * names none. Framed by whether any of the screen's rows counts the platform's points (UNCOUNTED); an
 * answer without basis_note_list (before Lane 115) prints its basis_note as sent. */
export function uncountedPart(
	advice: { basis_note: string; basis_note_list?: string },
	lines: readonly PlayerLine[]
): BasisPart[] {
	const names = advice.basis_note_list ?? '';
	if (names === '') return said(advice.basis_note);
	const counted = lines.some((line) => platformGame(line) !== null);
	return said(counted ? UNCOUNTED.stats(names) : UNCOUNTED.ours(names));
}

/** A sentence part for a basis, none for an empty one. */
export function said(text: string | null, phone = true): BasisPart[] {
	return text === null || text === '' ? [] : [{ text, phone }];
}

/** The block as one paragraph reads, every part drawn: a link that more words follow closes its
 * sentence (BasisBlock draws the same). */
export function basisText(parts: readonly BasisPart[]): string {
	return parts
		.map((p, i) => {
			const text = p.href && i < parts.length - 1 ? `${p.text}.` : p.text;
			return i === 0 || p.joined === true ? text : ` ${text}`;
		})
		.join('');
}

/** The block as one width draws it: a desk's parts (every part but a phone's alone), or a phone's
 * (every part it shows), read as basisText reads them. */
export function drawnText(parts: readonly BasisPart[], width: 'desk' | 'phone'): string {
	return basisText(parts.filter((p) => (width === 'desk' ? p.desk !== false : p.phone)));
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
	/** Every Team row reads Final (BoxTotals.allFinal, Lane 121 B99): no Proj final is drawn, so the
	 * key says nothing of it. Absent, as before. */
	allFinal?: boolean;
	/** A Team row reads Final with no total (an FFPC opponent with no box, Lane 121 fix round 1). */
	finalNone?: boolean;
	/** A Team row draws its Proj final from our best lineup of its roster (an FFPC opponent, the
	 * API's projection_best_lineup, Lane 127 fix round 1): said once, as the League page says it. */
	bestLineup?: boolean;
	/** That Proj final counts a player in play at his projection's pace (projected_final_paced). */
	paced?: boolean;
	host: LeagueHost;
	/** The Lineup's: the read the change counts from, and the API's sentence naming the rules our
	 * stats lack; null on the Matchup, which draws no evidence columns. */
	lineup: {
		previousReadAt: string | null;
		note: { basis_note: string; basis_note_list?: string };
	} | null;
}

/** A box score screen's key under its rows, one paragraph (Lane 66t): on the Lineup the rule for our
 * pick, Proj, its change (a desk column), the Game cell, Our rank, Opp rank, Pts and the rules Avg and
 * Last leave out; on the Matchup Proj, Our rank, Pts and the Game cell, the columns it draws. */
export function boxBasisParts(facts: BoxBasisFacts, clock: Clock, now: number): BasisPart[] {
	const defense = facts.lines.some((l) => l.player.position === 'DEF');
	const kicked = anyKicked(facts.lines, now);
	const projFacts: ProjFacts | null = facts.projection
		? { ...facts.projection, defense, league: true, kicked, host: facts.host }
		: null;
	// The phone Matchup's eight lines (Lane 124): the defenses' scoring and the started game's Proj
	// left to the desk, qualifications the desk says (MATCHUP_PHONE_SAYS), in one sentence (Lane 132).
	const proj = projFacts ? projMatchupParts(projFacts, clock) : [];
	// What the Team row's small figure is while a starter still plays (Lane 92, B22; once every one is
	// final the row reads Final, Lane 121 B99, and needs no key).
	const projFinal = kicked && facts.allFinal !== true;
	const final = [
		...said(projFinalWords(projFinal, facts.noFinal === true)),
		...said(facts.finalNone === true ? finalNonePart(facts.host) : null),
		...said(
			projFinal && facts.bestLineup === true
				? unlistedPart(facts.host, {
						bestLineup: true,
						noRoster: false,
						paced: facts.paced === true
					})
				: null
		)
	];
	const { lineup } = facts;
	// The Lineup's Team adds the lineup's rows; the Matchup's is the platform's total where it sends one.
	const team = lineup === null && facts.teamTotal ? 'platform' : 'rows';
	const pts = ptsPart(facts.byPlayer, facts.host, team);
	// When a row's Final and its stats land, said while one waits on either (Lane 85), and what Avg and
	// Last count meanwhile (Lane 111).
	const waiting = (onPhone: boolean): BasisPart[] =>
		finalsParts(facts.lines, now, facts.host, 'rosters', onPhone);
	if (lineup === null)
		return [
			...proj,
			...final,
			...said(RANK_PART),
			...said(pts),
			...said(gamePart(facts.lines, clock, now, 'full')),
			...waiting(true)
		];
	// The phone Lineup's eight lines (Lane 115, B83): the rule our pick follows said in one clause with
	// what Proj is, the defenses' scoring, the order Our rank is in and what Team adds left to the desk;
	// a "--" Proj final says why in place of what it adds (fix round 1, MEDIUM-1).
	return [
		...(projFacts
			? deskOrPhone(`${PICK_PART} ${projPart(projFacts, clock)}`, pickProjPart(projFacts, clock))
			: said(PICK_PART)),
		...deskOrPhone(
			projFinalWords(projFinal, facts.noFinal === true),
			projFinalPhone(projFinal, facts.noFinal === true)
		),
		...said(deltaPart(lineup.previousReadAt, clock), false),
		...said(gamePart(facts.lines, clock, now, 'full')),
		// On the Lineup phone the expected score and weather are the decision's facts and keep their
		// cells and sentence: the Final sentence is said at a desk while any row still draws them, and
		// on the phone too once none does (Lane 85 fix round 2, the coordinator's ruling on brief item 4).
		...waiting(!drawsFacts(facts.lines, now)),
		...deskOrPhone(RANK_OPP_PART, RANK_OPP_PHONE),
		...deskOrPhone(pts, ptsPhonePart(facts.byPlayer, facts.host)),
		...uncountedPart(lineup.note, facts.lines)
	];
}
