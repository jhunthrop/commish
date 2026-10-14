<script lang="ts">
	interface Props {
		/** What the member agrees to, in full: the words they tick. */
		words: string;
		checked?: boolean;
	}

	let { words, checked = $bindable(false) }: Props = $props();
</script>

<!-- The box leads the words at the fields' size, so it is read first and found first, inside a
     bordered block that marks what is agreed to. -->
<label class="consent">
	<input type="checkbox" bind:checked />
	<span>{words}</span>
</label>

<style>
	.consent {
		display: flex;
		align-items: flex-start;
		gap: var(--s-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		padding: var(--s-3);
		font-size: var(--t-md);
		line-height: 1.45;
		color: var(--ink);
		cursor: pointer;
	}

	input {
		flex: none;
		width: 20px;
		height: 20px;
		margin: 1px 0 0;
		accent-color: var(--accent);
	}

	input:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
</style>
