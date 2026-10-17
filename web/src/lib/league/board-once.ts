/** The League page's board, loaded once per league read (Lane 66i re-review N1). The page asks on
 * every read; a load is made only when the format asked for is new, or the last load for it failed,
 * and never while one is in flight. The guard keys on the format asked for, never the board's own:
 * a run without the league's format answers with its fallback, which would never match. A failed
 * load waits for the page's next read. */
export interface BoardOnce<B> {
	read: (format: string, onLoad: (board: B) => void, onFail: (error: unknown) => void) => void;
}

export function boardOnce<B>(load: (format: string) => Promise<B>): BoardOnce<B> {
	let asked: string | null = null;
	let failed = false;
	let inFlight = false;
	return {
		read(format, onLoad, onFail) {
			if (inFlight || (asked === format && !failed)) return;
			asked = format;
			inFlight = true;
			load(format)
				.then((board) => {
					failed = false;
					onLoad(board);
				})
				.catch((error: unknown) => {
					failed = true;
					onFail(error);
				})
				.finally(() => {
					inFlight = false;
				});
		}
	};
}
