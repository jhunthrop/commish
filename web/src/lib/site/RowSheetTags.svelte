<script lang="ts">
	import TagChip from '#lib/ui/TagChip.svelte';
	import { lazySheet } from './lazy-sheet.svelte.ts';

	/** A board row's tags from your sheet (Lane 66n), on his line beside his club, once the sheet is in. */
	interface Props {
		playerId: string;
	}

	let { playerId }: Props = $props();

	const marks = $derived(lazySheet.tags(playerId));
</script>

{#each marks as mark (mark.label)}<TagChip label={mark.label} tone={mark.tone} />{/each}
