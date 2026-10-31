<script lang="ts">
	import { NOT_AFFILIATED_LINE } from './affiliation.ts';

	/** The not-affiliated line (Lane 310) in small caption type: beside the connect step, at the foot
	 * of the legal pages and under the account's Platforms. One line from affiliation.ts, never a banner. */
</script>

<p class="not-affiliated">{NOT_AFFILIATED_LINE}</p>

<style>
	.not-affiliated {
		margin: 0;
		font-size: var(--t-xs);
		color: var(--ink-3);
		max-width: 70ch;
	}
</style>
