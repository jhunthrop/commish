<script lang="ts">
	import { onMount } from 'svelte';
	import { sheet } from '#lib/sheet/sheet.svelte.ts';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';

	interface Props {
		playerId: string;
		/** His last name, for the confirmation: "Olave is on your sheet". */
		name: string;
		fill?: boolean;
	}

	let { playerId, name, fill = false }: Props = $props();

	onMount(() => {
		if (!sheet.loaded) sheet.load();
	});

	const added = $derived(sheet.has(playerId));
</script>

<!-- Once he is on the sheet, the moment's action is done, so the verb steps down to a quiet link. -->
<span class="add" aria-live="polite">
	{#if added}
		<Quiet href={sectionHref('sheet')} size="lg" {fill}>{name} is on your sheet</Quiet>
	{:else}
		<Verb size="lg" {fill} onclick={() => sheet.add(playerId)}>Add to my sheet</Verb>
	{/if}
</span>

<style>
	.add {
		display: flex;
	}
</style>
