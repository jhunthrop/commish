<script lang="ts">
	import type { RowFraming } from '#lib/run/row-framing.ts';
	import Label from './Label.svelte';

	/** The column heads over a run of Rows, on the same grid. On the phone it names only the columns whose cells print a bare number. */
	interface Props {
		/** The floor to ceiling column, on unless the view switches it off. Rows under it take the same. */
		range?: boolean;
		/** The rows under it carry an action column at their end. */
		action?: boolean;
		/** What the rows under it are ordered by. Match the Rows' order. */
		order?: 'board' | 'adp';
		/** The rows under it carry this season's figures: a Games column on a desk. */
		games?: boolean;
		/** How the rows under it frame their rank against the drafts (run/row-framing.ts): the
		 * Drafters column compares drafters with our rank ("vs us") only where they do. */
		framing: RowFraming;
	}

	let { range = true, action = false, order = 'board', games = false, framing }: Props = $props();
</script>

<div
	class="head"
	class:flat={!range}
	class:act={action}
	class:act-flat={action && !range}
	class:games
	aria-hidden="true"
>
	<span class="lead"
		>{#if order === 'adp'}<Label align="end">ADP</Label>{/if}</span
	>
	<span></span>
	<Label>Player</Label>
	{#if games}<span class="gp"><Label align="end">Games</Label></span>{/if}
	<span class="proj"><Label align="end">Projected</Label></span>
	<span class="end"
		><Label align="end"
			><span class="wide">Over replacement</span><span class="narrow">Over repl</span></Label
		></span
	>
	{#if range}<span class="rng"><Label>Range</Label></span>{/if}
	<Label
		><span class="wide">{framing.compare ? 'Drafters vs us' : 'Drafters'}</span><span class="narrow"
			>Drafters</span
		></Label
	>
	{#if action}<span class="act-end"></span>{/if}
</div>

<style>
	.head {
		display: grid;
		grid-template-columns: var(--board-cols);
		align-items: center;
		column-gap: var(--s-3);
		padding: 0 var(--s-3) var(--s-2);
		border-bottom: 1px solid var(--line);
	}

	.flat {
		grid-template-columns: var(--board-cols-flat);
	}

	.act {
		grid-template-columns: var(--board-cols-act);
	}

	.act-flat {
		grid-template-columns: var(--board-cols-act-flat);
	}

	.games {
		grid-template-columns: var(--board-cols-games);
	}

	.games.flat {
		grid-template-columns: var(--board-cols-games-flat);
	}

	.games.act {
		grid-template-columns: var(--board-cols-games-act);
	}

	.games.act-flat {
		grid-template-columns: var(--board-cols-games-act-flat);
	}

	.gp {
		display: flex;
		justify-content: flex-end;
	}

	@media (max-width: 1180px) {
		.gp {
			display: none;
		}
	}

	@media (min-width: 961px) and (max-width: 1439px) {
		.games > .rng {
			display: none;
		}
	}

	@media (min-width: 1181px) and (max-width: 1253px) {
		.games {
			column-gap: 9px;
		}
	}

	.lead,
	.proj,
	.end {
		display: flex;
		justify-content: flex-end;
	}

	@media (max-width: 960px) {
		.rng,
		.act-end {
			display: none;
		}
	}

	.narrow {
		display: none;
	}

	/* On the phone the head names the over replacement column, whose cells print the number alone. */
	@media (max-width: 760px) {
		.head {
			column-gap: var(--s-2);
			padding: 0 0 var(--s-2);
		}

		.lead,
		.proj,
		.wide,
		.act-end {
			display: none;
		}

		.narrow {
			display: inline;
		}
	}
</style>
