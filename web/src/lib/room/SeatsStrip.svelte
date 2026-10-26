<script lang="ts">
	import { type LobbySeatState, seatName } from './lobby.ts';
	import { LOBBY, seatLabel } from './lobby-words.ts';

	interface Props {
		seats: ReadonlyMap<number, LobbySeatState>;
		teams: number;
		you: number;
		/** The seat on the clock, null before the draft starts. */
		onClock: number | null;
	}

	let { seats, teams, you, onClock }: Props = $props();

	let list = $state<HTMLOListElement | null>(null);

	function kindOf(seat: number): LobbySeatState['kind'] {
		return seats.get(seat)?.kind ?? 'open';
	}

	/** A bot's seat is a compact cell: people get the width. */
	function compact(seat: number): boolean {
		const kind = kindOf(seat);
		return seat !== you && (kind === 'bot' || kind === 'open');
	}

	function status(seat: number): string {
		if (seat === onClock) return LOBBY.seatOnClock;
		switch (kindOf(seat)) {
			case 'left':
				return LOBBY.seatLeft;
			case 'drafter':
				return LOBBY.seatDrafter;
			default:
				return LOBBY.seatWaiting;
		}
	}

	/** Keeps a seat in the strip's own view without scrolling the page. */
	function reveal(seat: number | null): void {
		const item = seat === null ? null : list?.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
		if (!list || !item) return;
		const left = item.offsetLeft;
		const right = left + item.offsetWidth;
		if (left < list.scrollLeft) list.scrollLeft = left;
		else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
	}

	/** The seat on the clock, then yours, so both are in view whenever they fit and yours always is. */
	function revealBoth(): void {
		reveal(onClock);
		reveal(you);
	}

	// When the clock moves to another seat.
	$effect(revealBoth);

	// When a cell changes width (a seat turning into a bot narrows, a handle arrives): every cell is
	// watched, so the seats move into view after the layout they moved in.
	$effect(() => {
		if (!list) return;
		const watch = new ResizeObserver(revealBoth);
		for (const cell of list.children) watch.observe(cell);
		return () => watch.disconnect();
	});
</script>

<ol class="seats" aria-label={LOBBY.seats} bind:this={list}>
	{#each Array.from({ length: teams }, (_, i) => i + 1) as seat (seat)}
		{@const s = seats.get(seat)}
		{@const name = seatName({ seat, handle: s?.handle ?? null, kind: kindOf(seat) }, you)}
		{@const small = compact(seat)}
		<!-- One cell per seat for the room's life, so the strip's size watch keeps every cell. -->
		<li
			class:bot={small}
			class:open={small && kindOf(seat) === 'open'}
			class:you={seat === you}
			class:on={seat === onClock}
			class:left={s?.kind === 'left'}
			data-seat={seat}
			aria-label={small
				? seatLabel(name, kindOf(seat) === 'open', seat === onClock)
				: undefined}
		>
			{#if small}
				<i aria-hidden="true"></i><b aria-hidden="true">{seat}</b>
			{:else}
				<b>{name}</b><span>{status(seat)}</span>
			{/if}
		</li>
	{/each}
</ol>

<style>
	/* Positioned, so a seat's offsetLeft is measured from the strip itself. */
	.seats {
		position: relative;
		display: flex;
		gap: 6px;
		overflow-x: auto;
		min-width: 0;
		padding: 2px;
		margin: 0;
		list-style: none;
		scrollbar-width: thin;
	}

	li {
		flex: none;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		min-width: 92px;
		max-width: 160px;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	b {
		font-size: var(--t-sm);
		color: var(--ink);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	li > span {
		white-space: nowrap;
	}

	/* A bot: a grey dot over its seat number. */
	.bot {
		min-width: 36px;
		align-items: center;
		padding: 6px 4px;
	}

	.bot i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--ink-3);
	}

	/* An open seat while the lobby fills: a hollow dot, nobody and no bot there yet. */
	.open i {
		background: transparent;
		border: 1.5px solid var(--ink-3);
	}

	.bot b {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
		font-weight: 600;
	}

	.you {
		border-color: var(--accent);
		background: var(--accent-wash);
	}

	.you b {
		color: var(--accent-text);
	}

	.on {
		outline: 2px solid var(--ink);
		outline-offset: -2px;
	}

	.left span {
		color: var(--loss-ink);
	}
</style>
