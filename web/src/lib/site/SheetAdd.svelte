<script lang="ts">
	import type { SheetPlayer } from '#lib/sheet/model.ts';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { lazySheet } from './lazy-sheet.svelte.ts';

	/** Add to my sheet on a nightly page: the sheet lane's button once the sheet has loaded, the same
	 * words until then, which add him as soon as it has. */
	interface Props {
		player: SheetPlayer;
		/** verb: the player page's one solid action. row: a quiet button at the end of a board row. */
		variant?: 'verb' | 'row';
		fill?: boolean;
	}

	let { player, variant = 'verb', fill = false }: Props = $props();

	const parts = $derived(lazySheet.parts);
</script>

{#if parts}
	{@const Add = parts.Add}
	<Add {player} {variant} {fill} />
{:else}
	<span class="add">
		{#if variant === 'row'}
			<Quiet size="sm" onclick={() => lazySheet.add(player)}>Add to my sheet</Quiet>
		{:else}
			<Verb size="lg" {fill} onclick={() => lazySheet.add(player)}>Add to my sheet</Verb>
		{/if}
	</span>
{/if}

<style>
	.add {
		display: flex;
	}
</style>
