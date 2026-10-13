<script lang="ts">
	import { draftersGap } from '#lib/format/draft.ts';
	import { fixed } from '#lib/format/number.ts';
	import GapChip from './GapChip.svelte';
	import Label from './Label.svelte';

	/**
	 * Where drafters take him against our rank: the board's ADP sentence ("2 picks later") with
	 * the ADP it is read from under it. A player outside the ADP window says so once, in the chip.
	 */
	interface Props {
		adp: number | null;
		ourRank: number;
		/** The "ADP 19.6" line under the chip. Off where a row has no room for it, the phone sheet. */
		figure?: boolean;
	}

	let { adp, ourRank, figure = true }: Props = $props();
</script>

<span class="adp">
	<GapChip gap={draftersGap(adp, ourRank)} />
	{#if figure && adp !== null}<Label size="cell">ADP {fixed(adp)}</Label>{/if}
</span>

<style>
	.adp {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 3px;
	}
</style>
