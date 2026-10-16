<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A labelled choice on an in-season screen (the trades a player holds, the team a trade is
	 * with): its words, then the native select, which gives way first on a narrow line. */
	interface Props {
		label: string;
		value: string | number;
		onchange: (value: string) => void;
		/** The options. */
		children: Snippet;
	}

	let { label, value, onchange, children }: Props = $props();
</script>

<label class="pick">
	<span>{label}</span>
	<select {value} onchange={(event) => onchange(event.currentTarget.value)}>
		{@render children()}
	</select>
</label>

<style>
	.pick {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
		white-space: nowrap;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	select {
		height: 36px;
		max-width: 100%;
		min-width: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		padding: 0 var(--s-2);
		font: inherit;
	}
</style>
