<script lang="ts">
	import type { SheetPlayer } from '#lib/sheet/model.ts';
	import SheetMark from '#lib/ui/SheetMark.svelte';
	import { lazySheet } from './lazy-sheet.svelte.ts';
	import { links } from './links.ts';

	/** A board row's sheet control: a plus on the row's hover that adds him, then his place on your
	 * sheet. It adds through the lazily loaded sheet, so the row needs nothing loaded first. */
	interface Props {
		player: SheetPlayer;
		/** On a phone the plus says its word (SheetMark's named). */
		named?: boolean;
	}

	let { player, named = false }: Props = $props();
</script>

<SheetMark
	name={player.name}
	place={lazySheet.place(player.id)}
	sheetHref={links.sheet()}
	onadd={() => lazySheet.add(player)}
	{named}
/>
