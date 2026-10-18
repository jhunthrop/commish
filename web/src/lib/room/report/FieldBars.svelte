<script lang="ts">
	import { count } from '#lib/format/number.ts';
	import type { MockReport } from '../api.ts';

	interface Props {
		standings: MockReport['standings'];
		/** Each seat's name, seat 1 first. */
		names: readonly string[];
		you: number;
	}

	let { standings, names, you }: Props = $props();

	const top = $derived(Math.max(...standings.map((t) => t.points), 1));
</script>

<div class="field">
	{#each standings as team (team.seat)}
		<div class="t" class:you={team.seat === you}>
			<span class="n">{team.rank}</span>
			<span class="name">{names[team.seat - 1] ?? `Seat ${team.seat}`}</span>
			<span class="bar"><i style:width="{(team.points / top) * 100}%"></i></span>
			<span class="pts">{count(team.points)}</span>
		</div>
	{/each}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.t {
		display: grid;
		grid-template-columns: 28px 120px minmax(0, 1fr) 70px;
		gap: var(--s-2);
		align-items: center;
		font-size: var(--t-sm);
		min-height: 26px;
	}

	.n {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-md);
		color: var(--ink-3);
	}

	.name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.bar {
		height: 16px;
		background: var(--surface-2);
		border-radius: 3px;
		overflow: hidden;
	}

	.bar i {
		display: block;
		height: 100%;
		background: var(--ink-3);
	}

	.you {
		font-weight: 600;
	}

	.you .bar i {
		background: var(--accent);
	}

	.pts {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-lg);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 760px) {
		.t {
			grid-template-columns: 24px 84px minmax(0, 1fr) 56px;
		}
	}
</style>
