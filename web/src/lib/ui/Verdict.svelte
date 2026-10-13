<script lang="ts">
	import type { Snippet } from 'svelte';
	import Panel from './Panel.svelte';

	/** Our call between options, handed over as a decision: one sentence with its evidence, then the
	 * verb that acts on it and a quiet way to take the other. Edged in the accent, as our call is. */
	interface Props {
		/** The call in a sentence: "We'd take Nacua: 1 place higher on our PPR board, 11.0 more points over replacement." */
		sentence: string;
		/** The moment's verb, and a quiet alternative. */
		actions: Snippet;
	}

	let { sentence, actions }: Props = $props();
</script>

<Panel as="section" label="Our call" edge="accent">
	<div class="verdict">
		<p>{sentence}</p>
		<div class="actions">{@render actions()}</div>
	</div>
</Panel>

<style>
	.verdict {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-4);
	}

	p {
		margin: 0;
		max-width: 60ch;
		font-size: var(--t-lg);
		font-weight: 600;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-3);
	}
</style>
