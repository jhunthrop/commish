<script lang="ts">
	import type { ActionProps } from './actions.ts';

	interface Props extends ActionProps {
		variant: 'verb' | 'quiet';
	}

	let {
		variant,
		href,
		onclick,
		key,
		size = 'md',
		fill = false,
		disabled = false,
		type = 'button',
		expanded,
		controls,
		children
	}: Props = $props();
</script>

{#snippet body()}
	{@render children()}
	{#if key}<kbd>{key}</kbd>{/if}
{/snippet}

{#if href && !disabled}
	<a class="action {variant} {size}" class:fill {href} aria-keyshortcuts={key} {onclick}>
		{@render body()}
	</a>
{:else}
	<button
		class="action {variant} {size}"
		class:fill
		{type}
		{disabled}
		aria-keyshortcuts={key}
		aria-expanded={expanded}
		aria-controls={controls}
		{onclick}
	>
		{@render body()}
	</button>
{/if}

<style>
	.action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border-radius: var(--r-md);
		cursor: pointer;
		text-decoration: none;
		white-space: nowrap;
	}

	/* Unavailable reads as unavailable in both themes: the outline with the quietest ink, never a
	   faded fill that could pass for a pressed verb. Orange is never spent on what you cannot press. */
	.action:disabled {
		cursor: not-allowed;
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-3);
		filter: none;
	}

	.fill {
		width: 100%;
	}

	kbd {
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		border-radius: 3px;
		padding: 0 5px;
	}

	/* The one solid verb per viewport. */
	.verb {
		height: var(--verb-h);
		padding: 0 var(--s-5);
		border: 0;
		background: var(--accent);
		color: var(--accent-ink);
		font-weight: 700;
		font-size: var(--t-md);
	}

	.verb:hover:not(:disabled) {
		filter: brightness(1.06);
	}

	.verb kbd {
		border: 1px solid color-mix(in srgb, var(--accent-ink) 50%, transparent);
		opacity: 0.9;
	}

	.verb.lg {
		height: 46px;
		min-width: 200px;
	}

	.verb.sm {
		height: 34px;
		padding: 0 var(--s-3);
		font-size: var(--t-sm);
	}

	/* Every other action: the outline. */
	.quiet {
		gap: 6px;
		height: 38px;
		padding: 0 var(--s-3);
		border: 1px solid var(--line-strong);
		background: transparent;
		font-size: var(--t-sm);
		font-weight: 500;
		color: var(--ink-2);
	}

	.quiet:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--ink-3);
	}

	.quiet kbd {
		border: 1px solid var(--line-strong);
		color: var(--ink-3);
	}

	.quiet.sm {
		height: 34px;
		padding: 0 10px;
	}

	.quiet.lg {
		height: 46px;
		min-width: 200px;
		font-size: var(--t-md);
	}

	@media (max-width: 760px) {
		.lg {
			min-width: 0;
		}
	}
</style>
