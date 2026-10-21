<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { BasisPart } from '#lib/run/board-basis.ts';

	/** A page's basis, said once (Lane 66n): its sentences, each left out on the phone where it names
	 * columns the phone does not draw, then the injury capture's sentence when the run carries one, then
	 * a page's own last words (after: the week tab's rules our stats lack, Lane 66w, named since Lane 111). */
	interface Props {
		parts: readonly BasisPart[];
		/** The capture's sentence, said on the member's clock once the page is live. */
		tail?: string | null;
		after?: Snippet;
	}

	let { parts, tail = null, after }: Props = $props();
	/** The space between the basis and a page's own last words. */
	const GAP = ' ';
</script>

<p class="basis">
	{#each parts as part, i (i)}<span class:desk={!part.phone} class:phone={part.desk === false}
			>{i > 0 ? ` ${part.text}` : part.text}</span
		>{/each}{tail ? ` ${tail}` : ''}{#if after}{GAP}{@render after()}{/if}
</p>

<style>
	.basis {
		margin: 0;
		max-width: 1040px;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-2);
	}

	.phone {
		display: none;
	}

	@media (max-width: 760px) {
		.desk {
			display: none;
		}

		.phone {
			display: inline;
		}
	}
</style>
