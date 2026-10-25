/** The fixture API's game states (Lane 80): every answer's games stamped with the state the API's
 * gameStateAt (api/internal/inseason/facts.go) gives them at the fixture's clock. A game is final
 * once the stored answer says played, or once the hourly capture's game status for either club says
 * final at or before the clock: data/game-status.json stands in for the `tank01_game_status` rows the
 * capture writes (research/pipeline/tank01/game_status.py), each club final at the first capture pass
 * three and a half hours after its kickoff. A kicker's or a defense's row moves to the kicked-off
 * section with its game, as the API's sectionOf does. */
import { readFileSync } from 'node:fs';
import {
	lineCell,
	scoreboardCell,
	type StatedLine
} from '../../src/lib/league/box/game-state-cell.ts';

type State = 'upcoming' | 'kicked_off' | 'final';

interface Game {
	played: boolean;
	kickoff: string | null;
	bye?: boolean;
	team?: string;
	opponent?: string | null;
	game_state?: State | null;
}

interface StatusRow {
	team: string;
	kickoff: string;
	status: 'final';
	as_of: string;
}

const STATUSES = (
	JSON.parse(readFileSync(new URL('./data/game-status.json', import.meta.url), 'utf8')) as {
		rows: StatusRow[];
	}
).rows;

/** The environment variable naming clubs whose final the capture has not held yet (Lane 91), comma
 * separated, both clubs of a game: `FIXTURE_LATE_FINAL=LV,BUF` keeps that game kicked off at any
 * clock, so the member's starters can all be final while the opponent's still plays. */
export const FIXTURE_LATE_FINAL_VARIABLE = 'FIXTURE_LATE_FINAL';

/** The clubs a `FIXTURE_LATE_FINAL` value names. */
export function lateFinals(value: string | undefined): ReadonlySet<string> {
	return new Set(
		(value ?? '').split(',').flatMap((club) => (club.trim() === '' ? [] : [club.trim()]))
	);
}

/** The fixture API's late finals, from its environment: none unless a shot asks. */
const LATE_FINALS = lateFinals(process.env[FIXTURE_LATE_FINAL_VARIABLE]);

/** When the capture first held a final for a club's game at that kickoff, null before or for a club
 * whose final is late. */
function finalAt(
	team: string | null | undefined,
	kickoff: string,
	late: ReadonlySet<string>
): number | null {
	if (team != null && late.has(team)) return null;
	const row = STATUSES.find((r) => r.team === team && r.kickoff === kickoff);
	return row === undefined ? null : Date.parse(row.as_of);
}

function isGame(value: Record<string, unknown>): value is Record<string, unknown> & Game {
	return typeof value.played === 'boolean' && 'kickoff' in value;
}

/** The API's rule at `now`: final by the stored answer or the capture's status for either club, the
 * `late` clubs' status not held yet. */
export function stateAt(
	game: Game,
	now: number,
	late: ReadonlySet<string> = LATE_FINALS
): State | null {
	if (game.bye === true || game.kickoff === null) return null;
	const final = [
		finalAt(game.team, game.kickoff, late),
		finalAt(game.opponent, game.kickoff, late)
	].some((at) => at !== null && at <= now);
	if (game.played || final) return 'final';
	return now >= Date.parse(game.kickoff) ? 'kicked_off' : 'upcoming';
}

function sectionOf(
	facts: Game,
	now: number,
	late: ReadonlySet<string>
): 'to_play' | 'kicked_off' | 'bye' {
	if (facts.bye === true) return 'bye';
	return stateAt(facts, now, late) === 'upcoming' ? 'to_play' : 'kicked_off';
}

/** The answer with every game stamped at `now`: a new value, the stored one left as it was. */
export function stamped(
	body: unknown,
	now: number,
	late: ReadonlySet<string> = LATE_FINALS
): unknown {
	if (Array.isArray(body)) return body.map((item) => stamped(item, now, late));
	if (body === null || typeof body !== 'object') return body;
	const entries = Object.entries(body as Record<string, unknown>).map(
		([key, value]) => [key, stamped(value, now, late)] as const
	);
	const out: Record<string, unknown> = Object.fromEntries(entries);
	if (isGame(out)) {
		const state = stateAt(out, now, late);
		out.game_state = state;
		out.played = state === 'final';
	}
	const line = out.line as { facts?: unknown } | undefined;
	if (typeof out.section === 'string' && line?.facts && typeof line.facts === 'object') {
		out.section = sectionOf(line.facts as Game, now, late);
	}
	// The wire's game_state (Lane 176), by the rule the API's lineGameState and scoreboardGameState
	// follow, over the facts and the game stamped above.
	if (isLine(out)) out.game_state = lineCell(out, now);
	else if (isScoreboardGame(out)) out.game_state = scoreboardCell(out, now);
	return out;
}

/** A player line: his player and his facts (PlayerLine). */
function isLine(value: Record<string, unknown>): value is Record<string, unknown> & StatedLine {
	const player = value.player as { team?: unknown } | undefined;
	return (
		typeof player === 'object' &&
		typeof player.team === 'string' &&
		typeof value.facts === 'object' &&
		value.facts !== null
	);
}

/** A scoreboard game: its state, its next kickoff and its sides (ScoreboardGame). */
function isScoreboardGame(
	value: Record<string, unknown>
): value is Record<string, unknown> & Parameters<typeof scoreboardCell>[0] {
	return typeof value.state === 'string' && 'next_kickoff' in value && Array.isArray(value.sides);
}
