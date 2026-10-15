/** The one move made on the host from our screen (spec §10.2): the start screen's changes as the
 * move the API plans, the steps of the confirmation panel, and its words. Pure, so every step and
 * sentence the panel shows is tested here. */
import type { LeagueHost } from '../api.ts';
import { hostWords } from '../names.ts';
import type {
	HostMoveChange,
	HostMoveInput,
	HostMovePlan,
	HostMoveResult,
	LineupAdvice
} from './api.ts';

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

/** Whether the start screen's verb sets the lineup on the host from here: the API says the move
 * is open, and there is a change to make. Otherwise the verb is the host's page. */
export function setsOnHost(advice: Pick<LineupAdvice, 'set' | 'slots' | 'moves'>): boolean {
	return (
		advice.moves.lineup === 'available' && !advice.set && advice.slots.some((slot) => slot.changed)
	);
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
	| { kind: 'failed'; sentence: string };

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
	/** The way out. */
	notNow: 'Not now',
	done: 'Done'
} as const;

/** The panel's verb while the move is on its way: "Setting it on ESPN". */
export function settingWords(host: LeagueHost): string {
	return `Setting it on ${hostWords(host)}`;
}

/** The panel while the move is checked against the host: "Reading your lineup on ESPN". */
export function readingWords(host: LeagueHost): string {
	return `Reading your lineup on ${hostWords(host)}`;
}

/** The link to the host's page beside a refusal or a move not yet shown: "Open ESPN". */
export function openHostWords(host: LeagueHost): string {
	return `Open ${hostWords(host)}`;
}
