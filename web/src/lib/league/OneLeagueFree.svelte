<script lang="ts">
	import { links } from '#lib/site/links.ts';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { ONE_LEAGUE_FREE } from './follow-many.ts';

	/** Where a free account would follow a second league: what more leagues come with, and the quiet
	 * way there. The same line on the attach page and the account page's league list. */
</script>

<p class="limit">
	<span>{ONE_LEAGUE_FREE}</span>
	<Quiet size="sm" href={links.pass()}>See the Draft Pass</Quiet>
</p>

<style>
	.limit {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2) var(--s-3);
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>
