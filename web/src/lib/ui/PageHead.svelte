<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The page's display title, set in the number face in capitals: "2026 Board". */
		title: string;
		/** One line under the title naming the basis of everything on the page. */
		lead?: string;
		/** Quiet links or chips at the title's right end. */
		actions?: Snippet;
	}

	let { title, lead, actions }: Props = $props();
</script>

<div class="head">
	<div>
		<h2>{title}</h2>
		{#if lead}<p>{lead}</p>{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		justify-content: space-between;
		gap: var(--s-3);
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-2xl);
		line-height: 0.9;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}

	p {
		margin: 6px 0 0;
		color: var(--ink-2);
		font-size: var(--t-sm);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
	}

	@media (max-width: 760px) {
		h2 {
			/* The mock's phone title, between --t-xl and --t-2xl. */
			font-size: calc((var(--t-xl) + var(--t-2xl)) / 2);
		}
	}
</style>
