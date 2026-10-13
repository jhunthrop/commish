<script lang="ts">
	import type { SheetPlayer } from '#lib/sheet/model.ts';
	import SheetMark from '#lib/ui/SheetMark.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { lazySheet } from './lazy-sheet.svelte.ts';
	import { links } from './links.ts';

	/** Add to my sheet on a nightly page. verb: the player page's one solid action, the sheet lane's
	 * button once the sheet has loaded and the same words until then, which add him as soon as it has.
	 * row: a board row's SheetMark, a plus on the row's hover that becomes his place on your sheet. */
	interface Props {
		player: SheetPlayer;
		variant?: 'verb' | 'row';
		fill?: boolean;
	}

	let { player, variant = 'verb', fill = false }: Props = $props();

	const parts = $derived(lazySheet.parts);
</script>

{#if variant === 'row'}
	<SheetMark
		name={player.name}
		place={lazySheet.place(player.id)}
		sheetHref={links.sheet()}
		onadd={() => lazySheet.add(player)}
	/>
{:else if parts}
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
