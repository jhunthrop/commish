<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	/** One row of an ActionRows list: a bold lead, a line under it, and the row's verb. A row that goes
	 * somewhere opens with a tap anywhere on it and shows a chevron; its verb stays its own tap, quiet
	 * at the end. */
	interface Props {
		lead: string;
		text?: string;
		href?: string;
		action?: Snippet;
	}

	let { lead, text, href, action }: Props = $props();
</script>

<li class="row" class:opens={href !== undefined}>
	<span class="what">
		{#if href}<a {href}><b>{lead}</b></a>{:else}<b>{lead}</b>{/if}
		{#if text}<span class="text">{text}</span>{/if}
	</span>
	{#if href}<span class="go" aria-hidden="true"><Icon name="chevron" size={18} /></span>{/if}
	{#if action}<span class="action">{@render action()}</span>{/if}
</li>

<style>
	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: var(--s-2) 0;
		border-bottom: 1px solid var(--line);
	}

	.what {
		min-width: 0;
		flex: 1;
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

	/* The link reaches over the whole row; the row's verb sits above it. */
	a::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.opens:hover b {
		text-decoration: underline;
	}

	.action {
		position: relative;
		z-index: 1;
	}

	.go {
		display: inline-flex;
		color: var(--ink-3);
		transform: rotate(-90deg);
	}

	.text {
		font-size: var(--t-sm);
		color: var(--ink-2);
		unicode-bidi: isolate;
	}
</style>
