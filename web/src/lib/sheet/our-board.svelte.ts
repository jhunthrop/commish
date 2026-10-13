/**
 * Our board for the sheet's format, as the sheet page and the board's rail read it: loaded for the
 * format the sheet has now, and loaded again when the sheet's format changes, so the pill, the ADP
 * cell and our rank never show another format's numbers. An answer for a format the sheet has
 * since left is dropped.
 */
import { boardById, type DirectoryPlayer, type PlayerDirectory } from './directory.ts';
import type { BoardFormat } from './model.ts';

/** loading: on its way. ready: here. none: we have no board for this format. failed: it did not
 * load. */
export type OurBoardState = 'loading' | 'ready' | 'none' | 'failed';

export class OurBoard {
	state = $state<OurBoardState>('loading');
	players = $state.raw<readonly DirectoryPlayer[] | null>(null);
	byId = $derived(boardById(this.players));

	readonly #directory: PlayerDirectory;
	#format: BoardFormat | null = null;

	constructor(directory: PlayerDirectory) {
		this.#directory = directory;
	}

	/** Loads our board for `format`, unless it is the one already held or on its way. */
	async follow(format: BoardFormat): Promise<void> {
		if (format === this.#format) return;
		this.#format = format;
		this.state = 'loading';
		this.players = null;
		try {
			const players = await this.#directory.board(format);
			if (format !== this.#format) return;
			this.players = players;
			this.state = players ? 'ready' : 'none';
		} catch {
			if (format !== this.#format) return;
			this.#format = null;
			this.state = 'failed';
		}
	}
}
