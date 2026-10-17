<script lang="ts">
	interface Props {
		/** What switching it on shows, in words: "Players below replacement". */
		label: string;
		checked?: boolean;
		/** A pill beside a filter bar's chips, its box first (the board's Lane 66n row of switches). */
		chip?: boolean;
	}

	let { label, checked = $bindable(false), chip = false }: Props = $props();
</script>

<label class="toggle" class:chip>
	<span>{label}</span>
	<input type="checkbox" bind:checked />
</label>

<style>
	.toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-2);
		padding: 6px 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
		cursor: pointer;
	}

	.chip {
		flex-direction: row-reverse;
		justify-content: flex-end;
		height: 32px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		white-space: nowrap;
	}

	input {
		accent-color: var(--ink);
		width: 16px;
		height: 16px;
		margin: 0;
	}
</style>
