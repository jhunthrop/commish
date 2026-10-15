<script lang="ts">
	import { links } from '#lib/site/links.ts';
	import { LINES } from './words.ts';

	/** What a screen's rows are ranked by, said once above them: the API's own line, as the API says
	 * it (what the order is, what points over replacement are and what a week is), and where the
	 * order's record is kept. The page adds no sentence of its own. */
	interface Props {
		basis: string;
	}

	let { basis }: Props = $props();
</script>

<p class="basis">
	{basis}
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
