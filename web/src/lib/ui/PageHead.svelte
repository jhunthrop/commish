<script lang="ts">
	import type { Snippet } from 'svelte';
	import DisplayTitle from './DisplayTitle.svelte';

	interface Props {
		/** The page's display title, set in the number face in capitals: "2026 Board". */
		title: string | Snippet;
		/** One line under the title naming the basis of everything on the page. */
		lead?: string;
		/** Quiet links or chips at the title's right end. */
		actions?: Snippet;
	}

	let { title, lead, actions }: Props = $props();
</script>

<div class="head">
	<div>
		<DisplayTitle size="hero"
			>{#if typeof title === 'string'}{title}{:else}{@render title()}{/if}</DisplayTitle
		>
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
</style>
