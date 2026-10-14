<script lang="ts">
	/** A figure the drafter types: points per stat on a scoring form. Takes a number within its
	 * bounds or keeps the last good one, so the form never holds a figure the API refuses. */
	interface Props {
		label: string;
		value: number;
		step?: number;
		min?: number;
		max?: number;
		onchange: (value: number) => void;
	}

	let { label, value, step = 0.5, min = -100, max = 100, onchange }: Props = $props();

	function commit(input: HTMLInputElement): void {
		const raw = input.value.trim();
		const n = Number(raw);
		if (raw === '' || !Number.isFinite(n) || n < min || n > max) {
			input.value = String(value);
			return;
		}
		if (n !== value) onchange(n);
	}
</script>

<label class="num">
	<span class="name">{label}</span>
	<input
		type="number"
		inputmode="decimal"
		{step}
		{min}
		{max}
		{value}
		onchange={(event) => commit(event.currentTarget)}
	/>
</label>

<style>
	.num {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-2);
		min-width: 0;
	}

	.name {
		font-size: var(--t-sm);
		color: var(--ink-2);
		min-width: 0;
	}

	input {
		width: 84px;
		flex: none;
		height: 34px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--bg);
		color: var(--ink);
		font: inherit;
		font-size: var(--t-sm);
		font-variant-numeric: tabular-nums;
		text-align: right;
		padding: 0 var(--s-2);
	}

	input:focus {
		border-color: var(--focus);
	}
</style>
