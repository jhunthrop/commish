<script lang="ts">
	import { type LobbySeatState, seatName } from './lobby.ts';

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
		if (seat === onClock) return 'on the clock';
		switch (kindOf(seat)) {
			case 'left':
				return 'left, queue drafts';
			case 'drafter':
				return 'drafter';
			default:
				return 'waiting';
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

	// The seat on the clock, then yours, so both are in view whenever they fit and yours always is.
	$effect(() => {
		// A seat turning into a bot narrows the strip, so the seats are read here too.
		if (seats.size < 0) return;
		reveal(onClock);
		reveal(you);
	});
</script>

<ol class="seats" aria-label="Seats" bind:this={list}>
	{#each Array.from({ length: teams }, (_, i) => i + 1) as seat (seat)}
		{@const s = seats.get(seat)}
		{@const name = seatName({ seat, handle: s?.handle ?? null, kind: kindOf(seat) }, you)}
		{#if compact(seat)}
			<li
				class="bot"
				class:open={kindOf(seat) === 'open'}
				class:on={seat === onClock}
				data-seat={seat}
				aria-label="{name}{kindOf(seat) === 'open' ? ', open' : ''}{seat === onClock
					? ', on the clock'
					: ''}"
			>
				<i aria-hidden="true"></i><b aria-hidden="true">{seat}</b>
			</li>
		{:else}
			<li
				class:you={seat === you}
				class:on={seat === onClock}
				class:left={s?.kind === 'left'}
				data-seat={seat}
			>
				<b>{name}</b><span>{status(seat)}</span>
			</li>
		{/if}
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
