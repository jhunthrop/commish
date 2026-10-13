/** Keeps an element at the tallest it has been at its current width, so content that changes in
 * place (the room's call, pick after pick) never moves what sits below it. It can grow, never
 * shrink, until its width changes, when it lets go and starts over. A Svelte action:
 * `use:holdHeight`. */
export function holdHeight(node: HTMLElement): { destroy: () => void } {
	let tallest = 0;
	let width = 0;
	const observer = new ResizeObserver(([entry]) => {
		const size = entry?.borderBoxSize[0];
		const inline = size?.inlineSize ?? node.offsetWidth;
		const block = size?.blockSize ?? node.offsetHeight;
		if (inline !== width) {
			// A new width lays the content out again: hold what it measures there, unheld.
			width = inline;
			node.style.minBlockSize = '';
			hold(node.offsetHeight, true);
			return;
		}
		hold(block, false);
	});
	function hold(block: number, fresh: boolean): void {
		if (!fresh && block <= tallest) return;
		tallest = block;
		node.style.minBlockSize = `${String(tallest)}px`;
	}
	observer.observe(node);
	return {
		destroy: () => {
			observer.disconnect();
		}
	};
}
