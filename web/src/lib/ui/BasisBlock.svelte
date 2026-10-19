<script lang="ts">
	import type { BasisPart } from '#lib/run/board-basis.ts';

	/** A screen's basis as one paragraph (Lane 66t): its sentences in order, a part about a column the
	 * phone does not draw left out there, a link part drawn as a link, closed with a full stop when
	 * more words follow. The shots count its rendered lines: five at a desk, eight on a phone. */
	interface Props {
		parts: readonly BasisPart[];
		/** The block's id, for a link to it (the trade builder's "What the figures are"). */
		id?: string;
	}

	let { parts, id }: Props = $props();
</script>

{#if parts.length > 0}
	<div class="basis" data-basis {id}>
		<p>
			{#each parts as part, i (i)}<span class:desk={!part.phone}
					>{i > 0 ? ' ' : ''}{#if part.href}<a href={part.href}>{part.text}</a>{i < parts.length - 1
							? '.'
							: ''}{:else}{part.text}{/if}</span
				>{/each}
		</p>
	</div>
{/if}

<style>
	.basis {
		max-width: 1000px;
		scroll-margin-top: var(--s-6);
	}

	p {
		margin: 0;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-3);
	}

	a {
		color: var(--accent-text);
	}

	@media (max-width: 760px) {
		.basis {
			max-width: none;
		}

		.desk {
			display: none;
		}
	}
</style>
