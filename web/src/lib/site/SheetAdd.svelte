<script lang="ts">
	import type { SheetPlayer } from '#lib/sheet/model.ts';
	import Verb from '#lib/ui/Verb.svelte';
	import { lazySheet } from './lazy-sheet.svelte.ts';

	/** Add to my sheet, the player page's one solid action: the sheet lane's button once the sheet
	 * has loaded, the same words until then, which add him as soon as it has. A board row's control
	 * is RowSheetMark, so the player page never loads the row's mark. */
	interface Props {
		player: SheetPlayer;
		fill?: boolean;
	}

	let { player, fill = false }: Props = $props();

	const parts = $derived(lazySheet.parts);
</script>

{#if parts}
	{@const Add = parts.Add}
	<Add {player} {fill} />
{:else}
	<span class="add">
		<Verb size="lg" {fill} onclick={() => lazySheet.add(player)}>Add to my sheet</Verb>
	</span>
{/if}

<style>
	.add {
		display: flex;
	}
</style>
