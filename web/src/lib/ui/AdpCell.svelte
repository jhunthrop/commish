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
		/** What the line under the chip names: his ADP (a row in our order), or our rank (a row in
		 * ADP order, which leads with the ADP already). */
		under?: 'adp' | 'rank';
		/** Whether the chip compares drafters with our rank. Off in season, where the ADP is the drafts'
		 * preseason order and our rank the rest of the season's: the ADP stands alone, and a player with
		 * none says so in the chip as the preseason board does. */
		compare?: boolean;
		/** The word our rank shows as for a player on a season-long list ("IR"), null otherwise. */
		rankWord?: string | null;
	}

	let {
		adp,
		ourRank,
		figure = true,
		under = 'adp',
		compare = true,
		rankWord = null
	}: Props = $props();
</script>

<span class="adp">
	{#if compare || adp === null}<GapChip gap={compare ? draftersGap(adp, ourRank) : null} />{/if}
	{#if figure && under === 'rank'}
		<Label size="cell">Our rank {rankWord ?? ourRank}</Label>
	{:else if figure && adp !== null}
		<Label size="cell">ADP {fixed(adp)}</Label>
	{/if}
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
