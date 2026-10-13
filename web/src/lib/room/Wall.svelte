<script lang="ts">
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import { lastName, pickLabel } from '#lib/format/draft.ts';
	import Face from '#lib/ui/Face.svelte';
	import Label from '#lib/ui/Label.svelte';
	import type { WallCell } from './model.ts';

	interface Props {
		rows: readonly (readonly WallCell[])[];
		/** Each seat's name across the top, seat 1 first. */
		names: readonly string[];
		/** Your seat, 1-based. */
		you: number;
		/** The pick on the clock, null when the draft is over. */
		now: number | null;
		teams: number;
		rounds: number;
	}

	let { rows, names, you, now, teams, rounds }: Props = $props();
</script>

<section aria-label="The wall">
	<div class="head">
		<DisplayTitle size="panel">The wall</DisplayTitle>
		<Label>rounds 1 to {rows.length} of {rounds}</Label>
	</div>
	<div class="wrap">
		<div class="wall" style:--teams={teams}>
			<span class="h"></span>
			{#each names as name, i (i)}
				<span class="h" class:you={i + 1 === you}>{name}</span>
			{/each}
			{#each rows as row, r (r)}
				<span class="rd">{r + 1}</span>
				{#each row as cell (cell.pick)}
					{#if cell.player}
						<span class="cell" class:mine={cell.seat === you}>
							<Face src={cell.player.headshot} size={22} />
							<span class="s">{cell.player.position} · {cell.player.team}</span>
							<b>{lastName(cell.player.name)}</b>
						</span>
					{:else if cell.pick === now}
						<span class="cell now">
							{cell.seat === you ? 'Your pick' : 'On the clock'}
							<span>{pickLabel(cell.pick, teams)}</span>
						</span>
					{:else}
						<span class="cell empty"></span>
					{/if}
				{/each}
			{/each}
		</div>
	</div>
</section>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		margin-bottom: var(--s-3);
	}

	.wrap {
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.wall {
		display: grid;
		grid-template-columns: 24px repeat(var(--teams), minmax(0, 1fr));
		min-width: 860px;
	}

	.h {
		padding: 8px 6px;
		font-size: var(--t-xs);
		font-weight: 600;
		color: var(--ink-3);
		border-bottom: 1px solid var(--line);
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.h.you {
		color: var(--accent-text);
	}

	.rd {
		display: grid;
		place-items: center;
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-lg);
		color: var(--ink-3);
		border-bottom: 1px solid var(--line);
	}

	.cell {
		display: grid;
		grid-template-columns: 22px minmax(0, 1fr);
		grid-template-rows: auto auto;
		column-gap: 5px;
		row-gap: 3px;
		align-items: center;
		padding: 6px;
		min-height: 54px;
		min-width: 0;
		border-bottom: 1px solid var(--line);
		border-left: 1px solid var(--line);
		font-size: var(--t-sm);
	}

	.cell b {
		grid-column: 1 / -1;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.s {
		font-size: var(--t-xs);
		color: var(--ink-3);
		white-space: nowrap;
	}

	.mine {
		background: var(--accent-wash);
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.now {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		outline: 2px dashed var(--accent);
		outline-offset: -4px;
		background: var(--accent-wash);
		color: var(--accent-text);
		font-weight: 700;
	}

	.now span {
		font-size: var(--t-xs);
		font-weight: 500;
	}
</style>
