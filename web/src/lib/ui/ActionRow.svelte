<script lang="ts">
	import type { Snippet } from 'svelte';

	/** One row of an ActionRows list: a bold lead (a link when it goes somewhere), a line under it,
	 * and the row's verb. */
	interface Props {
		lead: string;
		text?: string;
		href?: string;
		action?: Snippet;
	}

	let { lead, text, href, action }: Props = $props();
</script>

<li class="row">
	<span class="what">
		{#if href}<a {href}><b>{lead}</b></a>{:else}<b>{lead}</b>{/if}
		{#if text}<span class="text">{text}</span>{/if}
	</span>
	{#if action}{@render action()}{/if}
</li>

<style>
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
		padding: var(--s-2) 0;
		border-bottom: 1px solid var(--line);
	}

	.what {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	a,
	b {
		color: var(--ink);
		text-decoration: none;
		unicode-bidi: isolate;
	}

	a:hover b {
		text-decoration: underline;
	}

	.text {
		font-size: var(--t-sm);
		color: var(--ink-2);
		unicode-bidi: isolate;
	}
</style>
