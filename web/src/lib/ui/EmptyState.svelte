<script lang="ts">
	import type { Snippet } from 'svelte';

	/** What a view says when it has nothing to show: a format the run lacks, a player we could not
	 * find, a list with nothing on it yet. One line in plain words and the ways forward. */
	interface Props {
		/** The headline, short: "Half PPR is not on our board yet". */
		title: string;
		/** One sentence saying what there is instead. */
		line?: string;
		/** The heading level the page's outline needs. */
		level?: 2 | 3;
		/** Quiet links or the moment's verb. */
		actions?: Snippet;
	}

	let { title, line, level = 2, actions }: Props = $props();
</script>

<div class="empty">
	<svelte:element this={`h${String(level)}`}>{title}</svelte:element>
	{#if line}<p>{line}</p>{/if}
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		padding: var(--s-6) var(--s-5);
		border: 1px dashed var(--line-strong);
		border-radius: var(--r-md);
	}

	h2,
	h3 {
		margin: 0;
		font-size: var(--t-lg);
		font-weight: 700;
	}

	p {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--t-md);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-3);
		margin-top: var(--s-3);
	}

	@media (max-width: 760px) {
		.empty {
			padding: var(--s-5) var(--s-4);
		}
	}
</style>
