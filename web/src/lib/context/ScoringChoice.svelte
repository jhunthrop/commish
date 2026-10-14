<script lang="ts">
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { siteContext } from './context.svelte.ts';

	/** A format page's scoring, where its chooser was: the format the page is in, which follows the
	 * shell's switch. A tap opens the switch, the one place the league and its scoring are chosen. */
	interface Props {
		/** The page's format as a chip prints it: "PPR". */
		label: string;
	}

	let { label }: Props = $props();
</script>

<ChipGroup label="Scoring">
	<span class="one" data-opens-leagues>
		<Chip
			pressed
			label="{label}, change your league or scoring"
			onclick={() => (siteContext.open = !siteContext.open)}
			>{label}<Icon name="chevron" size={14} /></Chip
		>
	</span>
</ChipGroup>

<style>
	/* The chip keeps one width whatever the format's words, so the chips after it never move. */
	.one {
		display: inline-flex;
		min-width: 104px;
	}

	.one :global(.chip) {
		flex: 1;
		justify-content: center;
		gap: 4px;
	}
</style>
