<script lang="ts">
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import { lastName, pickLabel } from '#lib/format/draft.ts';
	import Face from '#lib/ui/Face.svelte';
	import Label from '#lib/ui/Label.svelte';
	import NameWords from '#lib/ui/NameWords.svelte';
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
		/** Whose draft the wall is told for: the seat's own drafter, or a reader of a shared one. */
		whose?: 'your' | 'their';
	}

	let { rows, names, you, now, teams, rounds, whose = 'your' }: Props = $props();
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
				<span class="h" class:you={i + 1 === you}><NameWords {name} /></span>
			{/each}
			{#each rows as row, r (r)}
				<span class="rd">{r + 1}</span>
				{#each row as cell (cell.pick)}
					{#if cell.player}
						<span class="cell" class:mine={cell.seat === you}>
							<Face src={cell.player.headshot} name={cell.player.name} size={22} />
							<span class="s">{cell.player.position} · {cell.player.team}</span>
							<b data-name>{lastName(cell.player.name)}</b>
						</span>
					{:else if cell.pick === now}
						<span class="cell now">
							{cell.seat === you ? (whose === 'your' ? 'Your pick' : 'Their pick') : 'On the clock'}
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
		/* Each team's column is at least its widest word, so a handle is shown whole and the wall
		   scrolls, never cutting a name. */
		grid-template-columns: 24px repeat(var(--teams), minmax(min-content, 1fr));
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
		/* A name breaks only between its words, and its column is as wide as its longest word. */
		/* A league member's name keeps its direction to itself. */
		unicode-bidi: isolate;
		line-height: 1.25;
		align-self: end;
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
		/* Every team's column is at least a cell this wide, so a short head ("You") never narrows its
		   column below a last name, and a long handle widens its own. */
		min-width: 70px;
		border-bottom: 1px solid var(--line);
		border-left: 1px solid var(--line);
		font-size: var(--t-sm);
	}

	/* A last name wraps rather than being cut: at its space ("St. Brown"), or after the hyphen of a
	   double name ("Smith-" over "Njigba"), the only place a narrow cell can turn it. */
	.cell b {
		grid-column: 1 / -1;
		font-weight: 600;
		line-height: 1.2;
		overflow: hidden;
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
