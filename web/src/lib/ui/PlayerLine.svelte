<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Position } from '#lib/types/player.ts';
	import Face from './Face.svelte';
	import Label from './Label.svelte';

	interface Props {
		name: string;
		position: Position;
		/** Rank at the position, printed after it: "WR 6". */
		positionRank?: number;
		/** His team, or null when he has none to print. */
		team: string | null;
		/** The headshot. Omitted where a list has no faces, the search menu. */
		headshot?: string;
		/** His page. */
		href?: string;
		/** The face's diameter: 32 in a side list, 40 in a table. */
		size?: 32 | 40;
		/** This is the player the page is about: the line takes your wash. */
		current?: boolean;
		/** The line's one number, at its right end, with its basis. */
		trailing?: Snippet;
		/** The line heads a card beside a big face: the name at a board row's size, the person first. */
		heads?: boolean;
	}

	let {
		name,
		position,
		positionRank,
		team,
		headshot,
		href,
		size = 32,
		current = false,
		trailing,
		heads = false
	}: Props = $props();

	const meta = $derived(
		[`${position}${positionRank === undefined ? '' : ` ${String(positionRank)}`}`, team]
			.filter((part) => part !== null)
			.join(' · ')
	);
</script>

<span class="line" class:current class:heads class:faceless={!headshot}>
	{#if headshot}<Face src={headshot} {size} />{/if}
	<span class="who">
		{#if href}<a class="name" {href}>{name}</a>{:else}<span class="name">{name}</span>{/if}
		<Label>{meta}</Label>
	</span>
	{#if trailing}<span class="end">{@render trailing()}</span>{/if}
</span>

<style>
	.line {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--s-2);
		padding: 6px var(--s-2);
		border-radius: var(--r-sm);
		font-size: var(--t-sm);
		min-width: 0;
	}

	.faceless {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.current {
		background: var(--accent-wash);
		font-weight: 700;
	}

	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
	}

	.heads .name {
		font-size: var(--t-md);
	}

	a.name:hover {
		text-decoration: underline;
	}

	.end {
		display: flex;
		align-items: baseline;
		gap: 6px;
	}
</style>
