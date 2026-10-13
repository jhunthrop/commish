<script lang="ts">
	interface Props {
		/** What switching it on shows, in words: "Players below replacement". */
		label: string;
		checked?: boolean;
	}

	let { label, checked = $bindable(false) }: Props = $props();
</script>

<label class="toggle">
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

	input {
		accent-color: var(--ink);
		width: 16px;
		height: 16px;
		margin: 0;
	}
</style>
