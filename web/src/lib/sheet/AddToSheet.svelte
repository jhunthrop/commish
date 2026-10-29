<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { lastName } from '#lib/format/draft.ts';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { SheetPlayer } from './model.ts';
	import { sheetStore } from './store.svelte.ts';
	import { SHEET } from './words.ts';

	interface Props {
		player: SheetPlayer;
		/** verb: the player page's one solid action. row: a quiet button at the end of a board row. */
		variant?: 'verb' | 'row';
		fill?: boolean;
	}

	let { player, variant = 'verb', fill = false }: Props = $props();

	onMount(() => sheetStore.load());

	const added = $derived(sheetStore.has(player.id));
	const sheetHref = resolve('/sheet');
</script>

<!-- Once he is on the sheet the moment's action is done, so the verb steps down to a quiet link. -->
<span class="add" aria-live="polite">
	{#if variant === 'row'}
		{#if added}
			<Quiet size="sm" href={sheetHref}>{SHEET.onYourSheet}</Quiet>
		{:else}
			<Quiet size="sm" onclick={() => sheetStore.add(player)}>{SHEET.addToSheet}</Quiet>
		{/if}
	{:else if added}
		<Quiet href={sheetHref} size="lg" {fill}>{lastName(player.name)} is on your sheet</Quiet>
	{:else}
		<Verb size="lg" {fill} onclick={() => sheetStore.add(player)}>{SHEET.addToSheet}</Verb>
	{/if}
</span>

<style>
	.add {
		display: flex;
	}
</style>
