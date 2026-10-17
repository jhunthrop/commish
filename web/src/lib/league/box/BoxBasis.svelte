<script lang="ts">
	import type { PlayerLine } from '../inseason/api.ts';
	import { PTS_BASIS, factsReadLine, projBasis } from './box.ts';

	/** What a box score's numbers are, said once under the boxes, one short line each: the
	 * projection and its read, points so far, and the game facts' read. */
	interface Props {
		/** The projection's read; undefined when the screen has no projection to speak of. */
		projectionReadAt?: string | null;
		/** Every line the boxes drew, for the facts' read. */
		lines: readonly PlayerLine[];
	}

	let { projectionReadAt, lines }: Props = $props();

	const facts = $derived(factsReadLine(lines));
</script>

<div class="basis">
	{#if projectionReadAt !== undefined}<p>{projBasis(projectionReadAt)}</p>{/if}
	<p>{PTS_BASIS}</p>
	{#if facts}<p>{facts}</p>{/if}
</div>

<style>
	.basis {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 72ch;
	}

	p {
		margin: 0;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-3);
	}
</style>
