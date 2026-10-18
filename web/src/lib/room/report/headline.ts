/** The report's facts (Lane 66o): the one big number with its caption, the finish and settings as
 * cells, the basis said once for every figure below it, and a pick's figures as the pick-by-pick
 * table prints them. The API's tenths print as given: whole numbers by formatting, never re-rounded. */
import { chanceShort } from '#lib/format/draft.ts';
import { count, ordinal, signed } from '#lib/format/number.ts';
import { isMarketPosition } from '#lib/run/market.ts';
import { POSITIONS } from '#lib/types/player.ts';
import type { FactCell } from '#lib/ui/facts.ts';
import type { MockReport } from '../api.ts';
import type { RoomPlayer } from '../model.ts';
import { scoringWords } from '../words.ts';

type Team = MockReport['standings'][number];
type Pick = MockReport['picks'][number];

/** The positions a team's points count: the projected ones, "QB, RB, WR and TE". A kicker or a
 * defense ranks in draft order with no projected points (the 2026-09-05 ruling), so no total counts
 * him. Joined here rather than by format/list.ts, which rides in the forms' chunk the report never
 * otherwise loads. */
const COUNTED = POSITIONS.filter((position) => !isMarketPosition(position))
	.join(', ')
	.replace(/, (?=[^,]*$)/, ' and ');

/** The team total's caption, one line: "points from your QB, RB, WR and TE starters". */
export function totalCaption(whose: 'your' | 'their'): string {
	return `points from ${whose} ${COUNTED} starters`;
}

/** A team's points as the report prints them: whole, by formatting. */
export function points(x: number): string {
	return count(x);
}

/** The seat's finish as cells: its place of the field, the team just ahead (or just behind, for the
 * leader), and the leader. Null when the standings do not hold the seat. */
export function standingCells(
	standings: readonly Team[],
	seat: number,
	teams: number
): { points: number; rank: number; cells: FactCell[] } | null {
	const mine = standings.find((t) => t.seat === seat);
	if (!mine) return null;
	const byRank = [...standings].sort((a, b) => a.rank - b.rank);
	const cells: FactCell[] = [
		{ label: `of ${String(teams)}`, value: ordinal(mine.rank), mine: true }
	];
	const leader = byRank[0];
	const near = byRank.find((t) => t.rank === (mine.rank === 1 ? 2 : mine.rank - 1));
	if (near && near.seat !== leader?.seat) {
		cells.push({ label: ordinal(near.rank), value: points(near.points) });
	}
	if (leader && leader.seat !== seat) cells.push({ label: 'Leader', value: points(leader.points) });
	return { points: mine.points, rank: mine.rank, cells };
}

/** The draft's settings as cells: teams, scoring, rounds, and who the other seats are. */
export function settingCells(report: MockReport, seats: string): FactCell[] {
	return [
		{ label: 'Teams', value: String(report.teams) },
		{ label: 'Scoring', value: scoringWords(report.settings), word: true },
		{ label: 'Rounds', value: String(report.rounds) },
		{ label: 'Other seats', value: seats, word: true }
	];
}

/** Every figure's basis on the report, said once: the board's own (whose points, the league, kickers
 * and defenses in draft order), what Picks later counts, and what Still there is. */
export function reportBasis(boardBasis: string, couldWaitFrom: number): string {
	const from = Math.round(couldWaitFrom * 100);
	return `${boardBasis} Picks later: the pick less his ADP, or less his place on our board (no kickers or defenses there), plus is later. Still there: the room's read at that pick, tinted from ${String(from)}%.`;
}

/** A pick's figure in the Over repl column: his points over replacement, or for a kicker or a
 * defense his place in draft order (the API's position rank, the order drafters take them). */
export function pickFigure(
	overReplacement: number | null,
	player: RoomPlayer | undefined
): { text: string; muted: boolean } {
	if (player !== undefined && isMarketPosition(player.position))
		return { text: `Draft order ${String(player.positionRank)}`, muted: true };
	if (overReplacement === null) return { text: 'no projection', muted: true };
	return { text: signed(overReplacement), muted: false };
}

/** A Picks later cell: the API's figure signed, and its tone. The site's one rule for a signed gap
 * (Lane 66o review L7): green when the sign favours the member, rose when it does not. Plus here is
 * a pick that came later than his place (the drafters' ADP or our board's), so plus is green. Null
 * when there is no figure. */
export interface Later {
	text: string;
	tone: 'loss' | 'gain' | 'even';
}

function later(gap: number, decimals: number): Later {
	const text = gap === 0 ? '0' : signed(gap, decimals);
	return { text, tone: gap > 0 ? 'gain' : gap < 0 ? 'loss' : 'even' };
}

/** Picks later against the drafters: the API's adp_gap (the pick less the printed ADP), as given. */
export function adpLater(pick: Pick): Later | null {
	return pick.adp_gap === null || pick.chip === 'kept' ? null : later(pick.adp_gap, 1);
}

/** Picks later against our board: the API's board_gap, whole picks, as given. */
export function boardLater(pick: Pick): Later | null {
	return pick.board_gap === null || pick.chip === 'kept' ? null : later(pick.board_gap, 0);
}

/** The Still there cell: the chance he was there at your next turn, tinted when he could have waited;
 * empty for a pick nobody chose. */
export function stillThereCell(
	pick: Pick,
	last: number | null,
	couldWaitFrom: number
): { text: string; wait: boolean; muted: boolean } {
	if (pick.made_by !== 'you' || pick.chip === 'kept') return { text: '', wait: false, muted: true };
	if (pick.still_there === null) {
		return { text: pick.pick === last ? 'last pick' : 'not read', wait: false, muted: true };
	}
	return {
		text: chanceShort(pick.still_there),
		wait: pick.still_there >= couldWaitFrom,
		muted: false
	};
}

type MadeFor = Readonly<Record<Pick['made_by'], string>>;

/** Who made each pick, for your draft and for a shared one. */
const BY: Readonly<Record<'your' | 'their', MadeFor>> = {
	your: { you: 'You', for_you: 'Pick for me', queue: 'Your queue', clock: 'Your clock' },
	their: { you: 'Them', for_you: 'Pick for me', queue: 'Their queue', clock: 'Their clock' }
};

/** The By cell: who made the pick, or Kept for a keeper. */
export function byWords(pick: Pick, whose: 'your' | 'their'): string {
	return pick.chip === 'kept' ? 'Kept' : BY[whose][pick.made_by];
}
