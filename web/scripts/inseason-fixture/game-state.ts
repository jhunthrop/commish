/** The fixture API's game states (Lane 80): every answer's games stamped with the state the API's
 * gameStateAt (api/internal/inseason/facts.go) gives them at the fixture's clock, so a shots script on
 * the Monday or the Tuesday clock draws what the API would. A game is final once the stored answer
 * says played, or, for a game kicked off before the finals land, from FIXTURE_FINALS_AT on (the
 * weekly pass that brings the week's stats, clock.ts). A kicker's or a defense's row moves to the
 * kicked-off section with its game, as the API's sectionOf does. */
import { FIXTURE_FINALS_AT } from './clock.ts';

type State = 'upcoming' | 'kicked_off' | 'final';

interface Game {
	played: boolean;
	kickoff: string | null;
	bye?: boolean;
	game_state?: State | null;
}

const FINALS = Date.parse(FIXTURE_FINALS_AT);

function isGame(value: Record<string, unknown>): value is Record<string, unknown> & Game {
	return typeof value.played === 'boolean' && 'kickoff' in value;
}

/** The API's rule at `now`, the finals landing at FIXTURE_FINALS_AT. */
export function stateAt(game: Game, now: number): State | null {
	if (game.bye === true || game.kickoff === null) return null;
	const kickoff = Date.parse(game.kickoff);
	if (game.played || (kickoff < FINALS && now >= FINALS)) return 'final';
	return now >= kickoff ? 'kicked_off' : 'upcoming';
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
