<script lang="ts">
	import type { BasisPart } from '#lib/run/board-basis.ts';

	/** A page's basis, said once (Lane 66n): its sentences, each left out on the phone where it names
	 * columns the phone does not draw, then the injury capture's sentence when the run carries one. */
	interface Props {
		parts: readonly BasisPart[];
		/** The capture's sentence, said on the member's clock once the page is live. */
		tail?: string | null;
	}

	let { parts, tail = null }: Props = $props();
</script>

<p class="basis">
	{#each parts as part, i (i)}{#if i > 0}{' '}{/if}<span class:desk={!part.phone}>{part.text}</span
		>{/each}{#if tail}{' '}{tail}{/if}
</p>

<style>
	.basis {
		margin: 0;
		max-width: 1040px;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-2);
	}

	@media (max-width: 760px) {
		.desk {
			display: none;
		}
	}
</style>
