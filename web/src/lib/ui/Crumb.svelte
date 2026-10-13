<script lang="ts">
	interface Step {
		label: string;
		/** Every step but the page itself links back. */
		href?: string;
	}

	interface Props {
		/** From the section down to this page: Board, WR, Chris Olave. */
		trail: readonly Step[];
	}

	let { trail }: Props = $props();
</script>

<nav class="crumb" aria-label="Where this page sits">
	{#each trail as step, i (step.label)}
		{#if i > 0}<span class="sep" aria-hidden="true">/</span>{/if}
		{#if step.href}<a href={step.href}>{step.label}</a>{:else}<span aria-current="page"
				>{step.label}</span
			>{/if}
	{/each}
</nav>

<style>
	.crumb {
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.sep {
		margin-inline: var(--s-1);
	}

	a {
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}
</style>
