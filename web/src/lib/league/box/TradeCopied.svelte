<script lang="ts">
	import { TRADES, type CopiedTrade } from './trades.ts';

	/** The line once a trade verb has copied the offer (Lane 66g): "Copied. Propose it on Sleeper's
	 * trade page.", the page its link when the API knows it. One line for the strip, the finder and the
	 * builder. */
	interface Props {
		line: CopiedTrade;
		href: string;
	}

	let { line, href }: Props = $props();
</script>

<span role="status"
	>{line.said}
	{TRADES.proposeItOn}
	{#if href !== ''}<a {href} target="_blank" rel="noopener">{line.page}</a
		>{:else}{line.page}{/if}.</span
>

<style>
	a {
		color: var(--ink);
		font-weight: 600;
	}
</style>
