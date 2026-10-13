<script lang="ts">
	import type { LobbySeatState } from './lobby.ts';

	interface Props {
		seats: ReadonlyMap<number, LobbySeatState>;
		teams: number;
		you: number;
		/** The seat on the clock, null before the draft starts. */
		onClock: number | null;
	}

	let { seats, teams, you, onClock }: Props = $props();

	function name(seat: number, s: LobbySeatState | undefined): string {
		if (seat === you) return 'You';
		if (!s || s.kind === 'open') return 'Open';
		if (s.kind === 'bot') return 'Bot';
		return s.handle ?? 'Drafter';
	}

	function status(seat: number, s: LobbySeatState | undefined): string {
		if (seat === onClock) return 'on the clock';
		switch (s?.kind) {
			case 'left':
				return 'left, queue drafts';
			case 'bot':
				return 'bot';
			case 'drafter':
				return 'drafter';
			default:
				return 'waiting';
		}
	}
</script>

<ol class="seats" aria-label="Seats">
	{#each Array.from({ length: teams }, (_, i) => i + 1) as seat (seat)}
		{@const s = seats.get(seat)}
		<li
			class:you={seat === you}
			class:bot={s?.kind === 'bot' || !s || s.kind === 'open'}
			class:on={seat === onClock}
			class:left={s?.kind === 'left'}
		>
			<b>{name(seat, s)}</b><span>{status(seat, s)}</span>
		</li>
	{/each}
</ol>

<style>
	.seats {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding: 0 0 2px;
		margin: 0;
		list-style: none;
	}

	li {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 92px;
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
		max-width: 120px;
	}

	.bot b {
		color: var(--ink-3);
		font-weight: 500;
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
