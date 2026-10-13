/** A word that shows for a moment and goes: "Link copied" in place of its verb, then the verb again. */
export class Flash {
	/** Whether the word is showing. */
	on = $state(false);
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly ms: number) {}

	/** Shows the word, restarting its moment if it is already showing. */
	show(): void {
		this.on = true;
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.on = false;
			this.#timer = null;
		}, this.ms);
	}
}
