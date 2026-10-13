<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { plural } from '#lib/format/number.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Face from '#lib/ui/Face.svelte';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import TagChip from '#lib/ui/TagChip.svelte';
	import { ranksOf, type SheetRow } from './model.ts';
	import { sheetStore } from './store.svelte.ts';
	import { FIXED_TAGS, ownTags, sameTag, tagLabel } from './tags.ts';

	/**
	 * The board's sheet rail: the top of your sheet with faces, filtered by a tag when you pick
	 * one. Mount it in the board's side column. Add to my sheet on a board row is AddToSheet with
	 * variant="row".
	 */
	interface Props {
		/** How many players the rail shows before the link to the rest. */
		shown?: number;
	}

	let { shown = 6 }: Props = $props();

	const NOTES = 'notes';
	let filter = $state<string | null>(null);

	onMount(() => sheetStore.load());

	const rows = $derived(sheetStore.sheet.rows);
	const ranks = $derived(ranksOf(rows));
	const tagsInUse = $derived([
		...FIXED_TAGS.map((fixed) => fixed.tag).filter((tag) =>
			rows.some((row) => row.tags.includes(tag))
		),
		...ownTags(rows.map((row) => row.tags))
	]);
	const hasNotes = $derived(rows.some((row) => row.note !== null));

	function matches(row: SheetRow): boolean {
		if (filter === null) return true;
		if (filter === NOTES) return row.note !== null;
		return row.tags.some((tag) => sameTag(tag, filter ?? ''));
	}

	const matching = $derived(rows.filter(matches));
	const top = $derived(matching.slice(0, shown));
	const aside = $derived(sheetStore.loaded ? plural(rows.length, 'player') : undefined);

	function pick(value: string): void {
		filter = filter === value ? null : value;
	}
</script>

<Panel as="aside" label="Your sheet">
	<h3 class="head">
		<span>Your sheet</span>{#if aside}<Label>{aside}</Label>{/if}
	</h3>
	{#if sheetStore.loaded && rows.length === 0}
		<p class="none">No one yet</p>
	{/if}
	<ul>
		{#each top as row (row.id)}
			<li>
				<Face src={row.headshot} size={32} />
				<span class="who">
					<span class="name">{row.name}</span>
					<span class="meta"
						><PositionPill position={row.position} rank={ranks.get(row.id)?.position} /></span
					>
				</span>
				{#if row.tags[0]}<TagChip label={tagLabel(row.tags[0])} />{/if}
			</li>
		{/each}
	</ul>
	{#if tagsInUse.length > 0 || hasNotes}
		<div class="tags">
			<ChipGroup label="Show" variant="loose">
				{#each tagsInUse as tag (tag)}
					<Chip size="sm" pressed={filter === tag} onclick={() => pick(tag)}>{tagLabel(tag)}</Chip>
				{/each}
				{#if hasNotes}
					<Chip size="sm" pressed={filter === NOTES} onclick={() => pick(NOTES)}>Notes</Chip>
				{/if}
			</ChipGroup>
		</div>
	{/if}
	{#if matching.length > shown}
		<div class="more">
			<Quiet href={resolve('/sheet')} size="sm">All {matching.length} on your sheet</Quiet>
		</div>
	{/if}
</Panel>

<style>
	.head {
		margin: 0 0 var(--s-3);
		font-size: var(--t-md);
		font-weight: 700;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.none {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	li {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--s-2);
		font-size: var(--t-sm);
	}

	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 2px;
	}

	.name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tags,
	.more {
		margin-top: var(--s-3);
	}
</style>
