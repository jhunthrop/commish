<script lang="ts">
	import Face from './Face.svelte';
	import Label from './Label.svelte';
	import PositionPill from './PositionPill.svelte';
	import type { SearchHit } from './search-hit.ts';

	interface Props {
		/** The listbox's id, which the search field names in aria-controls. */
		id: string;
		hits: readonly SearchHit[];
		/** The hit the arrow keys are on, or -1. */
		active: number;
		/** Shown when the query matches nobody, in words: "Nobody named zz". */
		empty?: string;
	}

	let { id, hits, active, empty }: Props = $props();
</script>

<div class="menu">
	{#if hits.length > 0}
		<ul {id} role="listbox" aria-label="Players">
			{#each hits as hit, i (hit.id)}
				<li id="{id}-{String(i)}" role="option" aria-selected={i === active}>
					<a href={hit.href} tabindex="-1">
						<Face src={hit.headshot} size={24} />
						<span class="name">{hit.name}</span>
						<PositionPill position={hit.position} />
						<Label>{hit.team}</Label>
					</a>
				</li>
			{/each}
		</ul>
	{:else if empty}
		<p {id}>{empty}</p>
	{/if}
</div>

<style>
	.menu {
		position: absolute;
		top: calc(100% + 6px);
		inset-inline: 0;
		z-index: 30;
		background: var(--bg);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		box-shadow: var(--shadow-pop);
		overflow: hidden;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 4px;
	}

	a {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) auto 40px;
		align-items: center;
		gap: var(--s-2);
		padding: 8px var(--s-3);
		border-radius: var(--r-sm);
		text-decoration: none;
	}

	[aria-selected='true'] a,
	a:hover {
		background: var(--surface-2);
	}

	.name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	p {
		margin: 0;
		padding: var(--s-3) var(--s-4);
		color: var(--ink-2);
		font-size: var(--t-sm);
	}
</style>
