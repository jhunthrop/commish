/** The moves made on the host from our screen (spec §10.2): the start screen's changes and the
 * waiver screen's claim as the moves the API plans, the steps of the confirmation panel, and its
 * words. Pure, so every step and sentence the panel shows is tested here. */
import { ApiError } from '#lib/api/client.ts';
import type { LeagueHost } from '../api.ts';
import { hostWords } from '../names.ts';
import type {
	HostBid,
	HostMoveChange,
	HostMoveInput,
	HostMovePlan,
	HostMoveResult,
	LineupAdvice,
	WaiverAdvice,
	WaiverRow
} from './api.ts';
import { memberZone, weekdayTime } from '#lib/format/clock.ts';

/** The two moves: a lineup set and a claim. */
export type MoveKind = HostMoveInput['kind'];

/** The start screen's changes as the move sends them: each changed slot's player in, and the
 * starter it sits (null for a slot the host left empty), for the week the screen read. */
export function lineupMove(advice: Pick<LineupAdvice, 'week' | 'slots'>): HostMoveInput {
	const changes: HostMoveChange[] = advice.slots
		.filter((slot) => slot.changed)
		.map((slot) => ({
			slot: slot.slot,
			in: slot.ours.player.host_id,
			out: slot.host?.player.host_id ?? null
		}));
	return { kind: 'lineup', week: advice.week, changes };
}

/** A waiver row as the claim sends it: his add, the drop he displaces (null for an open spot) and
 * the bid the member typed (null where the league does not bid, or before one is typed), for the
 * week the screen read. */
export function claimMove(week: number, row: WaiverRow, bid: number | null): HostMoveInput {
	return {
		kind: 'claim',
		week,
		changes: [],
		claim: { add: row.add.player.host_id, drop: row.drop?.player.host_id ?? null, bid }
	};
}

/** Whether the start screen's verb sets the lineup on the host from here: the API says the move
 * is open, and there is a change to make. Otherwise the verb is the host's page. */
export function setsOnHost(advice: Pick<LineupAdvice, 'set' | 'slots' | 'moves'>): boolean {
	return (
		advice.moves.lineup === 'available' && !advice.set && advice.slots.some((slot) => slot.changed)
	);
}

/** The shape of a host id the claim route takes (api hostmoves checkClaim): ESPN's player ids, a
 * D/ST's negative. */
const HOST_ID = /^-?[0-9]{1,12}$/;

/** Whether a row's add can be claimed from here: the API names him by his host id. An add with none
 * (a defense ESPN does not name, any add on a host with no write path) keeps the host's page. */
export function claimable(row: WaiverRow): boolean {
	return HOST_ID.test(row.add.player.host_id);
}

/** Whether an add is claimed from here (review 66j N3): the API opens claims for the league and the
 * platform names him by an id the claim route takes. One rule for the Waivers screen and the order;
 * null moves (none read) never claim. */
export function claimsAdd(
	moves: Pick<WaiverAdvice['moves'], 'claim'> | null,
	hostId: string
): boolean {
	return moves?.claim === 'available' && HOST_ID.test(hostId);
}

/** A waiver row's own key, for marking it: the add's host id, else his board id. */
export function addKey(row: WaiverRow): string {
	return row.add.player.host_id === ''
		? `board:${row.add.player.board_id ?? row.add.player.name}`
		: row.add.player.host_id;
}

/** Whether the waiver screen's Add opens a claim on the host from here: the API says it is open. */
export function claimsOnHost(advice: Pick<WaiverAdvice, 'moves'>): boolean {
	return advice.moves.claim === 'available';
}

/** A plan ready to make: its sentence and token. */
export type ReadyPlan = HostMovePlan & { confirm: string };

/** Where the confirmation panel is. */
export type MoveStep =
	| { kind: 'closed' }
	| { kind: 'planning' }
	| { kind: 'confirm'; plan: ReadyPlan }
	| { kind: 'sending'; plan: ReadyPlan }
	| { kind: 'answered'; result: HostMoveResult }
	| { kind: 'unavailable'; sentence: string; href: string }
	| { kind: 'failed'; sentence: string; href: string | null };

/** The panel after a plan: the move to confirm, or the host's page when the API cannot make it. */
export function planStep(plan: HostMovePlan): MoveStep {
	if (plan.status === 'ready' && plan.confirm !== null) {
		return { kind: 'confirm', plan: { ...plan, confirm: plan.confirm } };
	}
	return { kind: 'unavailable', sentence: plan.sentence, href: plan.host_url };
}

/** The panel after the move: what it came to, or the host's page when it was unavailable. */
export function resultStep(result: HostMoveResult): MoveStep {
	if (result.outcome === 'unavailable') {
		return { kind: 'unavailable', sentence: result.sentence, href: result.host_url };
	}
	return { kind: 'answered', result };
}

/** What a move came to in words: the API's sentence, or, for a claim the host's queue holds with
 * when it runs, that time on the member's clock: "Claim submitted. ESPN processes it Fri 3:00 am,
 * and your lineup screen will show him once it goes through." */
export function resultWords(
	host: LeagueHost,
	result: HostMoveResult,
	zone: string = memberZone()
): string {
	if (result.outcome !== 'pending' || result.processes_at === null) return result.sentence;
	return `Claim submitted. ${hostWords(host)} processes it ${weekdayTime(result.processes_at, zone)}, and your lineup screen will show him once it goes through.`;
}

/** What a lineup move is made through: the league's plan and move calls, and its lineup's read. */
export interface MoveCalls {
	/** Plans the move in words with its confirm token; nothing is sent. */
	plan: (move: HostMoveInput) => Promise<HostMovePlan>;
	/** Makes the planned move once with its token. */
	make: (move: HostMoveInput, confirm: string) => Promise<HostMoveResult>;
	/** Reads the lineup again, once a move has been made. */
	reread: () => void;
}

/** The league's host and its lineup page, which a failed call's step names. */
export interface MoveHost {
	host: LeagueHost;
	href: string;
}

/** The panel once the move is planned; never throws (Lane 257). */
export async function planMove(
	calls: MoveCalls,
	move: HostMoveInput,
	at: MoveHost
): Promise<MoveStep> {
	try {
		return planStep(await calls.plan(move));
	} catch (error) {
		return failedStep(error, at.host, 'plan', at.href);
	}
}

/** The panel once the planned move is made with its token, the lineup read again after an answer;
 * never throws (Lane 257). */
export async function makeMove(
	calls: MoveCalls,
	move: HostMoveInput,
	plan: ReadyPlan,
	at: MoveHost
): Promise<MoveStep> {
	try {
		const step = resultStep(await calls.make(move, plan.confirm));
		calls.reread();
		return step;
	} catch (error) {
		return failedStep(error, at.host, 'make', at.href);
	}
}

/** When a call fails before the move could have left: nothing was sent. */
export const NOT_REACHED =
	'We could not reach Commish, and nothing was sent. Try again in a moment.';

/** The panel when a call fails: the API's own sentence for its refusal (an expired or spent
 * token says so in fields), never a raw error. When the move's call fails with no answer at all,
 * the move may have left, so the member is sent to check the host. */
export function failedStep(
	error: unknown,
	host: LeagueHost,
	stage: 'plan' | 'make',
	href: string,
	kind: MoveKind = 'lineup'
): MoveStep {
	const answered = error instanceof ApiError && error.status !== 0;
	if (answered) {
		const sentence = error.fields.confirm ?? error.fields.move ?? error.message;
		return { kind: 'failed', sentence, href: null };
	}
	if (stage === 'make') {
		return { kind: 'failed', sentence: lostWords(host, kind), href: href === '' ? null : href };
	}
	return { kind: 'failed', sentence: NOT_REACHED, href: null };
}

/** A move whose answer never came back: "We did not hear back, so the move may have been made.
 * Check your lineup on ESPN before you set it again." */
export function lostWords(host: LeagueHost, kind: MoveKind = 'lineup'): string {
	if (kind === 'claim') {
		return `We did not hear back, so the claim may have been made. Check your claims on ${hostWords(host)} before you claim again.`;
	}
	return `We did not hear back, so the move may have been made. Check your lineup on ${hostWords(host)} before you set it again.`;
}

/** The host's reason in its own words, under ours: "ESPN said: Lineup transaction could not be
 * completed, Alexander Mattison is locked." */
export function hostSaid(host: LeagueHost, words: string): string {
	const said = words.trim();
	return `${hostWords(host)} said: ${said}${/[.!?]$/.test(said) ? '' : '.'}`;
}

/** The panel's fixed words. */
export const MOVE_LINES = {
	/** The panel's name for a screen reader. */
	title: 'Your lineup move',
	claimTitle: 'Your claim',
	/** The way out. */
	notNow: 'Not now',
	done: 'Done'
} as const;

/** The panel's name for a screen reader. */
export function moveTitle(kind: MoveKind): string {
	return kind === 'claim' ? MOVE_LINES.claimTitle : MOVE_LINES.title;
}

/** The panel's verb while the move is on its way: "Setting it on ESPN", "Claiming on ESPN". */
export function settingWords(host: LeagueHost, kind: MoveKind = 'lineup'): string {
	return kind === 'claim' ? `Claiming on ${hostWords(host)}` : `Setting it on ${hostWords(host)}`;
}

/** The panel while the move is checked against the host: "Reading your lineup on ESPN". */
export function readingWords(host: LeagueHost, kind: MoveKind = 'lineup'): string {
	return `Reading your ${kind === 'claim' ? 'roster' : 'lineup'} on ${hostWords(host)}`;
}

/** The link to the host's page beside a refusal or a move not yet shown: "Open ESPN". */
export function openHostWords(host: LeagueHost): string {
	return `Open ${hostWords(host)}`;
}

/** The bid field's label, its number's basis named: "Your bid in waiver dollars, $0 to $500, what
 * your team has left", or the league's budget when the host did not say what was spent. We never
 * suggest a bid. */
export function bidLabel(bid: HostBid): string {
	const basis = bid.left_known ? 'what your team has left' : "the league's budget";
	return `Your bid in waiver dollars, $${String(bid.min)} to $${String(bid.max)}, ${basis}`;
}

/** A typed bid the league does not take, in the host's terms; null for a whole number in bounds. */
export function bidProblem(host: LeagueHost, typed: string, bid: HostBid): string | null {
	const value = Number(typed.trim());
	const fits =
		typed.trim() !== '' && Number.isInteger(value) && value >= bid.min && value <= bid.max;
	return fits
		? null
		: `${hostWords(host)} takes bids from $${String(bid.min)} to $${String(bid.max)} in this league.`;
}
