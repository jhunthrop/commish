/** Every league's Lineup on one page (Lane 257, B262): what each league's block is once its lineup
 * is read, the page's one verb over them (Make every change), which plans each league's move and then
 * makes each with its own token, one league at a time through the league's own calls, and every
 * sentence the page prints of them. Pure but for the movers it is handed, so it is tested apart from
 * the page. */
import { listWords } from '#lib/format/list.ts';
import { plural } from '#lib/format/number.ts';
import type { LeagueHost } from '../api.ts';
import { hostWords } from '../names.ts';
import { heldLineup, lineupBox } from '../box/lineup.ts';
import type { HostMoveInput, LineupAdvice } from './api.ts';
import { lineupMove, setsOnHost, type MoveHost, type MoveStep } from './move.ts';

/** A league's block once its lineup is read: changes we make from here, changes the member makes on
 * the host (its own screen's copy verb), nothing to change, or the week done, each a count or the
 * API's own sentence. */
export type LineupBlock =
	| { kind: 'here'; changes: number }
	| { kind: 'elsewhere'; changes: number }
	| { kind: 'set' }
	| { kind: 'done'; line: string };

/** What a block is, as its own Lineup screen would draw it at the same clock: the answer with no
 * change on a row whose game has kicked off, its swaps, and whether the API opens the move. */
export function lineupBlock(answer: LineupAdvice, now: number, zone: string): LineupBlock {
	const advice = heldLineup(answer, now);
	if (advice.week_done) return { kind: 'done', line: advice.week_done };
	const changes = lineupBox(advice, zone, now).swaps.length;
	if (changes === 0) return { kind: 'set' };
	return setsOnHost(advice) ? { kind: 'here', changes } : { kind: 'elsewhere', changes };
}

/** A block's move as the page's verb drives it: the league's own mover. */
export interface Movable {
	readonly step: MoveStep;
	open: (move: HostMoveInput, at: MoveHost) => Promise<void>;
	confirm: (at: MoveHost) => Promise<void>;
	close: () => void;
}

/** A league the page's verb moves: its mover, the lineup it read at its clock and its host. */
export interface MoveEntry {
	id: string;
	mover: Movable;
	advice: LineupAdvice;
	now: number;
	host: LeagueHost;
}

/** A block's state as the page counts it: still reading, no lineup in its phase, a read the API
 * refused, or its lineup's block, with its changes and, where the page's verb makes them, its move. */
export interface BlockReport {
	id: string;
	kind: LineupBlock['kind'] | 'reading' | 'none' | 'refused';
	changes: number;
	entry: MoveEntry | null;
}

const hostOf = (entry: MoveEntry): MoveHost => ({
	host: entry.host,
	href: entry.advice.host_lineup_url
});

/** Plans every league's move, one league at a time (one host at a time), each its own plan with its
 * own token; a league whose plan fails says so in its block and the next is planned. */
export async function planEvery(entries: readonly MoveEntry[]): Promise<void> {
	for (const entry of entries) {
		await entry.mover.open(lineupMove(heldLineup(entry.advice, entry.now)), hostOf(entry));
	}
}

/** The leagues whose plan is ready to make. */
export function readyEntries(entries: readonly MoveEntry[]): MoveEntry[] {
	return entries.filter((entry) => entry.mover.step.kind === 'confirm');
}

/** Makes each planned move once with its token, one league at a time; a refusal or a failure in one
 * league never stops the next. */
export async function makeEvery(entries: readonly MoveEntry[]): Promise<void> {
	for (const entry of readyEntries(entries)) await entry.mover.confirm(hostOf(entry));
}

/** Closes every league's panel: the page's way out. */
export function closeEvery(entries: readonly MoveEntry[]): void {
	for (const entry of entries) entry.mover.close();
}

/** What the moves came to: the leagues set, those that may have been set (the host took the move but
 * its read-back did not show it, or the move's answer never came back: each says how to check), and
 * those that did not change (a refusal, a move the API could not make, a failed plan or an answered
 * failure: each says why). */
export interface EveryOutcome {
	set: number;
	unknown: number;
	unchanged: number;
}

export function everyOutcome(entries: readonly MoveEntry[]): EveryOutcome {
	const steps = entries.map((entry) => entry.mover.step);
	const set = steps.filter((s) => s.kind === 'answered' && s.result.outcome === 'done').length;
	const unknown = steps.filter(
		(s) =>
			(s.kind === 'answered' && s.result.outcome === 'pending') ||
			(s.kind === 'failed' && s.lost === true)
	).length;
	return { set, unknown, unchanged: steps.length - set - unknown };
}

/** The changes the planned moves make, counted from the lineups they were planned from: the count the
 * plans' own sentences spell out, whatever a later read says. */
export function plannedChanges(entries: readonly MoveEntry[]): number {
	return entries.reduce(
		(sum, entry) => sum + lineupMove(heldLineup(entry.advice, entry.now)).changes.length,
		0
	);
}

/** The hosts in words, each once: "ESPN", "ESPN and FFPC". */
function hostsWords(hosts: readonly LeagueHost[]): string {
	return listWords([...new Set(hosts)].map(hostWords));
}

/** The page's fixed words. */
export const EVERY = {
	/** The page's name, in the bar and the tab. */
	title: 'Lineups',
	/** The one verb. */
	verb: 'Make every change',
	/** A block with nothing to change. */
	set: 'Set. Nothing to change.',
	/** A block's way to its league's own Lineup. */
	open: 'Open its lineup',
	/** A block's way to its league's page, for a league with no lineup in its phase. */
	openLeague: 'Open the league',
	/** A league with no lineup in its phase (before its draft, after its season). */
	noLineup: 'No lineup to set this week.',
	allSet: 'Every league is set. Nothing to change.',
	/** The panel's name for a screen reader. */
	panel: 'Every lineup move'
} as const;

/** The head's line over the blocks, once every league has answered: "Changes in 2 of your 4
 * leagues.", with those the member sets on the host: "1 more to set on Sleeper yourself." */
export function everyLine(leagues: number, here: number, elsewhere: readonly LeagueHost[]): string {
	const changing = here + elsewhere.length;
	if (changing === 0) return EVERY.allSet;
	const head =
		changing === leagues
			? `Changes in ${leagues === 2 ? 'both' : `all ${String(leagues)}`} of your leagues.`
			: `Changes in ${String(changing)} of your ${plural(leagues, 'league')}.`;
	if (elsewhere.length === 0) return head;
	const more = here === 0 ? String(elsewhere.length) : `${String(elsewhere.length)} more`;
	return `${head} ${more} to set on ${hostsWords(elsewhere)} yourself.`;
}

/** The panel while the moves are checked: "Reading your lineups on ESPN". */
export function readingEveryWords(hosts: readonly LeagueHost[]): string {
	return `Reading your lineups on ${hostsWords(hosts)}`;
}

/** The panel once the moves are planned: "5 changes in 2 leagues, each spelled out in its league
 * below." */
export function confirmEveryWords(changes: number, leagues: number): string {
	return `${plural(changes, 'change')} in ${plural(leagues, 'league')}, each spelled out in its league below.`;
}

/** The panel's verb that makes them: "Set them on ESPN", "Set it on ESPN" for one league. */
export function setEveryWords(hosts: readonly LeagueHost[], leagues: number): string {
	return `Set ${leagues === 1 ? 'it' : 'them'} on ${hostsWords(hosts)}`;
}

/** The verb while the moves are sent: "Setting them on ESPN". */
export function settingEveryWords(hosts: readonly LeagueHost[]): string {
	return `Setting them on ${hostsWords(hosts)}`;
}

/** What the moves came to: "Set in 2 leagues.", "Set in 1 league. 1 may have been set. Its league says
 * how to check below.", "1 did not change. Its league says why below.", or "Nothing changed. Each league says why
 * below." when no league was set or may have been. */
export function everyReport(outcome: EveryOutcome): string {
	const { set, unknown, unchanged } = outcome;
	if (set === 0 && unknown === 0) return 'Nothing changed. Each league says why below.';
	const its = (n: number): string => (n === 1 ? 'Its league says' : 'Each league says');
	const parts = [
		set > 0 ? `Set in ${plural(set, 'league')}.` : null,
		unknown > 0
			? `${String(unknown)} may have been set. ${its(unknown)} how to check below.`
			: null,
		unchanged > 0 ? `${String(unchanged)} did not change. ${its(unchanged)} why below.` : null
	];
	return parts.filter((part) => part !== null).join(' ');
}

/** The verb while leagues are still read: "1 league still reading". */
export function stillReadingWords(leagues: number): string {
	return `${plural(leagues, 'league')} still reading`;
}

/** No plan was ready to make: every league says why in its block. */
export const NONE_READY = 'None of these could be set from here. Each league says why below.';
