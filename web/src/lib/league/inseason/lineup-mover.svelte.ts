/** The Lineup's move as one object (Lane 257): the panel's step, planned, confirmed and made through
 * move.ts's steps (planMove, makeMove), which never throw, so a failure in one league never stops
 * another. The league's own Lineup and the every-league page both drive it, so a league's move is
 * made the same way from either: planned, then made once with the token its plan gave, then the
 * lineup read again. */
import type { HostMoveInput } from './api.ts';
import { makeMove, planMove, type MoveCalls, type MoveHost, type MoveStep } from './move.ts';

export class LineupMover {
	step = $state<MoveStep>({ kind: 'closed' });
	/** The move as it was planned: the one the token makes, whatever the page reads meanwhile. */
	#planned: HostMoveInput | null = null;
	readonly #calls: MoveCalls;

	constructor(calls: MoveCalls) {
		this.#calls = calls;
	}

	/** Plans the move: the panel reads the host, then shows the move to confirm or why it cannot. */
	async open(move: HostMoveInput, at: MoveHost): Promise<void> {
		this.#planned = move;
		this.step = { kind: 'planning' };
		this.step = await planMove(this.#calls, move, at);
	}

	/** Makes the planned move once with its token, then reads the lineup again. */
	async confirm(at: MoveHost): Promise<void> {
		const planned = this.#planned;
		if (this.step.kind !== 'confirm' || planned === null) return;
		const { plan } = this.step;
		this.step = { kind: 'sending', plan };
		this.step = await makeMove(this.#calls, planned, plan, at);
	}

	close(): void {
		this.step = { kind: 'closed' };
		this.#planned = null;
	}
}
