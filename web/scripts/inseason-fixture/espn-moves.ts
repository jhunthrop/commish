// The ESPN stand-ins' moves (Lanes 35 and 39), moved out of serve.ts (Lane 86, review L2): the
// lineup plan and its outcome in the API's words, and the claim's, over the recorded answers.
import type {
	HostMoveInput,
	HostMovePlan,
	HostMoveResult,
	LineupAdvice,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';
import { espnDefenseId } from './week-order-serve.ts';

const MINUTE_MS = 60_000;
/** The shape of a host id the claim route takes (api hostmoves checkClaim). */
export const HOST_ID = /^-?[0-9]{1,12}$/;
/** The API's words for a claim whose add it cannot name (hostmoves claimFormWords). */
export const CLAIM_FORM_WORDS = 'Send the claim from the waivers screen.';
/** How long a plan's token holds, and the held league's wait. */
export const HOLD_MS = 10 * MINUTE_MS;

/** What the moves are made over: the recorded answers, the waivers by position, the clock and what
 * each ESPN league's move comes to. */
export interface MoveDeps {
	lineup: LineupAdvice;
	waivers: WaiverAdvice;
	waiversAt: (position: string | null) => WaiverAdvice;
	now: () => number;
	outcomes: ReadonlyMap<string, 'done' | 'refused' | 'pending'>;
}

/** The ESPN stand-ins' lineup, waivers and moves over `deps`. */
export function espnMoves({ lineup, waivers, waiversAt, now, outcomes }: MoveDeps): {
	espnLineup: () => LineupAdvice;
	espnWaivers: (position: string | null) => WaiverAdvice;
	moveAnswer: (id: string, plan: boolean, body: unknown) => HostMovePlan | HostMoveResult;
} {
	const ESPN_MOVES = outcomes;
	/** The API's own sentences for a move (api/internal/hostmoves words.go). */
	const MOVE_SENTENCES = {
		done: 'Set on ESPN. Your lineup there now reads as ours.',
		refused: 'ESPN did not make the move, so nothing changed there.',
		pending:
			'Sent to ESPN, but your lineup there did not show it when we read it back. Check your lineup on ESPN before you set it again.'
	} as const;
	/** The API's own sentences for a claim (api/internal/hostmoves words.go and claim.go). */
	const CLAIM_SENTENCES = {
		done: 'Done on ESPN. He is on your roster there now.',
		refused: 'ESPN did not take the claim, so nothing changed there.',
		pending:
			'Claim submitted. ESPN processes claims on Wednesday, and your lineup screen will show him once it goes through.'
	} as const;
	/** The stand-in leagues' waiver settings: the pending one bids (a budget of 100, 13 spent), the
	 * done one adds a free agent at once, the refused one does not bid. */
	const CLAIM_BUDGET = { min: 0, max: 87 } as const;
	/** When the pending league's claims run: ESPN's processDate, a Wednesday's 07:00 UTC. */
	const CLAIM_RUNS_AT = '2026-10-21T07:00:00.000Z';
	const ESPN_LEAGUE_URL =
		'https://fantasy.espn.com/football/league?leagueId=1081607624&seasonId=2026';
	const ESPN_LINEUP_URL =
		'https://fantasy.espn.com/football/team?leagueId=1081607624&seasonId=2026&teamId=3';
	/** A changed slot's place in the API's words: "at RB", "in the flex". */
	function slotPlace(slot: string): string {
		if (slot === 'FLEX') return 'in the flex';
		if (slot === 'SUPERFLEX') return 'in the superflex';
		// A defense's slot as the Lineup prints it (hostmoves slotPlace).
		if (slot === 'DEF') return 'at D/ST';
		return `at ${slot}`;
	}

	/** The plan's sentence as the API words it (hostmoves lineupWords): every change, then the host. */
	function planSentence(): string {
		const clauses = lineup.slots
			.filter((slot) => slot.changed)
			.map(
				(slot) =>
					`${slot.ours.player.name}${slot.host ? ` over ${slot.host.player.name}` : ''} ${slotPlace(slot.slot)}`
			);
		const joined =
			clauses.length < 2
				? (clauses[0] ?? '')
				: `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1) ?? ''}`;
		return `Start ${joined}, on ESPN now.`;
	}

	/** The ESPN league's lineup: the move open and the verb ESPN's lineup page. ESPN gives each player's
	 * points for the week (Lane 79), so the lines keep the recorded league's. */
	function espnLineup(): LineupAdvice {
		return {
			...lineup,
			host_lineup_url: ESPN_LINEUP_URL,
			moves: { lineup: 'available', note: null, takes_writes: true, writes_on: true, reason: null }
		};
	}

	/** The ESPN league's waivers, as the API answers an ESPN league: each add named by his board id
	 * (ESPN's own), a defense by its D/ST id (api hostIDOfAdd), the claim open, the verb ESPN's league
	 * page. */
	function espnWaivers(position: string | null): WaiverAdvice {
		const named = waiversAt(position);
		const withId = (row: WaiverAdvice['rows'][number]): WaiverAdvice['rows'][number] => {
			const board = row.add.player.board_id ?? '';
			const hostId =
				row.add.player.position === 'DEF'
					? espnDefenseId(row.add.player.team)
					: HOST_ID.test(board)
						? board
						: '';
			return { ...row, add: { ...row.add, player: { ...row.add.player, host_id: hostId } } };
		};
		return {
			...named,
			rows: named.rows.map(withId),
			pickups: named.pickups.map(withId),
			host_waivers_url: ESPN_LEAGUE_URL,
			moves: { claim: 'available', note: null, takes_writes: true, writes_on: true, reason: null }
		};
	}

	/** A player in the waiver answer by his host id, for the plan's words. */
	function nameOf(hostId: string | null): string {
		const lines = waivers.rows.flatMap((row) => (row.drop ? [row.add, row.drop] : [row.add]));
		// An ESPN add is named by his board id or his D/ST id (espnWaivers), a roster player by his host id.
		return (
			lines.find(
				(line) =>
					line.player.host_id === hostId ||
					line.player.board_id === hostId ||
					(line.player.position === 'DEF' && espnDefenseId(line.player.team) === hostId)
			)?.player.name ?? ''
		);
	}

	/** A claim on an ESPN fixture league: the plan in the API's words with a token (and the bid where
	 * the league bids), or what the claim came to. */
	function claimAnswer(
		id: string,
		plan: boolean,
		move: HostMoveInput
	): HostMovePlan | HostMoveResult {
		const outcome = ESPN_MOVES.get(id) ?? 'done';
		const claim = move.claim ?? { add: '', drop: null, bid: null };
		if (plan) {
			const bids = outcome === 'pending';
			const amount = claim.bid ?? CLAIM_BUDGET.min;
			const named = `Add ${nameOf(claim.add)}${claim.drop ? `, drop ${nameOf(claim.drop)}` : ''}`;
			const bidWords = bids ? `, bid $${String(amount)}` : '';
			const sentence =
				outcome === 'done'
					? `${named}, on ESPN now. He is a free agent, so the add is made at once.`
					: `${named}${bidWords}. He is on waivers, so ESPN runs the claim on Wednesday.`;
			return {
				status: 'ready',
				sentence,
				confirm: 'fixture-token',
				expires_at: new Date(now() + HOLD_MS).toISOString(),
				host_url: ESPN_LEAGUE_URL,
				bid: bids ? { amount, ...CLAIM_BUDGET, left_known: true } : null
			};
		}
		return {
			outcome,
			sentence: CLAIM_SENTENCES[outcome],
			// ESPN's refusal as captured live (jwulff 06-espn-add-drop-surface p1, TRAN_PLAYER_NOT_FREEAGENT).
			host_words: outcome === 'refused' ? `Player ${claim.add} is not a free agent` : null,
			host_url: ESPN_LEAGUE_URL,
			move_id: '6f1d1c52-2626-4a26-9a26-0000000000f2',
			processes_at: outcome === 'pending' ? CLAIM_RUNS_AT : null
		};
	}

	/** A move on an ESPN fixture league: the plan in words with a token, or what the move came to. */
	function moveAnswer(id: string, plan: boolean, body: unknown): HostMovePlan | HostMoveResult {
		const move = (plan ? body : (body as { move?: unknown } | null)?.move) as
			HostMoveInput | undefined;
		if (move?.kind === 'claim') return claimAnswer(id, plan, move);
		if (plan) {
			return {
				status: 'ready',
				sentence: planSentence(),
				confirm: 'fixture-token',
				expires_at: new Date(now() + HOLD_MS).toISOString(),
				host_url: ESPN_LINEUP_URL,
				bid: null
			};
		}
		const outcome = ESPN_MOVES.get(id) ?? 'done';
		const first = lineup.slots.find((slot) => slot.changed)?.ours.player.name ?? '';
		return {
			outcome,
			sentence: MOVE_SENTENCES[outcome],
			// ESPN's refusal as captured live (jwulff 05-espn-write-surface.md 5.1, TRAN_LINEUP_LOCKED).
			host_words:
				outcome === 'refused'
					? `Lineup transaction could not be completed, ${first} is locked`
					: null,
			host_url: ESPN_LINEUP_URL,
			move_id: '6f1d1c52-2626-4a26-9a26-0000000000f1',
			processes_at: null
		};
	}

	return { espnLineup, espnWaivers, moveAnswer };
}
