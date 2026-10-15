<script lang="ts">
	import { links } from '#lib/site/links.ts';
	import { LINES, POINTS_OVER_REPLACEMENT } from './words.ts';

	/** What a screen's rows are ranked by, said once above them: the API's own line, what points over
	 * replacement are, and where the order's record is kept. */
	interface Props {
		basis: string;
	}

	let { basis }: Props = $props();
</script>

<p class="basis">
	{basis}
	{POINTS_OVER_REPLACEMENT}
	<a href={links.record()}>{LINES.orderRecord}</a>
</p>

<style>
	.basis {
		margin: 0;
		max-width: 90ch;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	a {
		color: var(--accent-text);
		white-space: nowrap;
	}
</style>
