<script lang="ts">
	interface Term {
		term: string;
		means: string;
	}

	interface Props {
		/** Each colour or column the view uses, and what it stands for. */
		terms: readonly Term[];
	}

	let { terms }: Props = $props();
</script>

<dl>
	{#each terms as { term, means } (term)}
		<dt>{term}</dt>
		<dd>{means}</dd>
	{/each}
</dl>

<style>
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px var(--s-3);
		margin: 0;
		font-size: var(--t-sm);
	}

	dt {
		color: var(--ink-3);
	}

	dd {
		margin: 0;
		color: var(--ink);
	}
</style>
