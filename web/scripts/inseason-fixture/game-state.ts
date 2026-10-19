/** The fixture API's game states (Lane 80): every answer's games stamped with the state the API's
 * gameStateAt (api/internal/inseason/facts.go) gives them at the fixture's clock. A game is final
 * once the stored answer says played, or once the hourly capture's game status for either club says
 * final at or before the clock: data/game-status.json stands in for the `tank01_game_status` rows the
 * capture writes (research/pipeline/tank01/game_status.py), each club final at the first capture pass
 * three and a half hours after its kickoff. A kicker's or a defense's row moves to the kicked-off
 * section with its game, as the API's sectionOf does. */
import { readFileSync } from 'node:fs';

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

/** When the capture first held a final for a club's game at that kickoff, null before. */
function finalAt(team: string | null | undefined, kickoff: string): number | null {
	const row = STATUSES.find((r) => r.team === team && r.kickoff === kickoff);
	return row === undefined ? null : Date.parse(row.as_of);
}

function isGame(value: Record<string, unknown>): value is Record<string, unknown> & Game {
	return typeof value.played === 'boolean' && 'kickoff' in value;
}

/** The API's rule at `now`: final by the stored answer or the capture's status for either club. */
export function stateAt(game: Game, now: number): State | null {
	if (game.bye === true || game.kickoff === null) return null;
	const final = [finalAt(game.team, game.kickoff), finalAt(game.opponent, game.kickoff)].some(
		(at) => at !== null && at <= now
	);
	if (game.played || final) return 'final';
	return now >= Date.parse(game.kickoff) ? 'kicked_off' : 'upcoming';
}

function sectionOf(facts: Game, now: number): 'to_play' | 'kicked_off' | 'bye' {
	if (facts.bye === true) return 'bye';
	return stateAt(facts, now) === 'upcoming' ? 'to_play' : 'kicked_off';
}

/** The answer with every game stamped at `now`: a new value, the stored one left as it was. */
export function stamped(body: unknown, now: number): unknown {
	if (Array.isArray(body)) return body.map((item) => stamped(item, now));
	if (body === null || typeof body !== 'object') return body;
	const entries = Object.entries(body as Record<string, unknown>).map(
		([key, value]) => [key, stamped(value, now)] as const
	);
	const out: Record<string, unknown> = Object.fromEntries(entries);
	if (isGame(out)) {
		const state = stateAt(out, now);
		out.game_state = state;
		out.played = state === 'final';
	}
	const line = out.line as { facts?: unknown } | undefined;
	if (typeof out.section === 'string' && line?.facts && typeof line.facts === 'object') {
		out.section = sectionOf(line.facts as Game, now);
	}
	return out;
}
