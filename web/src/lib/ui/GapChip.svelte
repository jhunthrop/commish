<script lang="ts">
	import { gapChipWords, gapTone } from '#lib/format/gap-picks.ts';
	import ToneChip from './ToneChip.svelte';

	interface Props {
		/** His ADP, null when the drafts do not take him: the chip says "No ADP". */
		adp: number | null;
		/** The run's Gap, drafters' ADP less our rank, as written (Lane 66q). Absent on a run older than
		 * the column, which draws no chip: the web never works it out. */
		gap?: number | null;
	}

	let { adp, gap }: Props = $props();

	const text = $derived(gapChipWords({ adp, gap }));
	const tone = $derived(gapTone(adp === null ? null : gap) ?? 'even');
</script>

{#if text !== null}<ToneChip {tone} size="md">{text}</ToneChip>{/if}
