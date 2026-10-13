<script lang="ts">
	interface Props {
		/** What is counted, printed before the number and named on the buttons: "RB". */
		label: string;
		value: number;
		min: number;
		max: number;
		onchange: (value: number) => void;
	}

	let { label, value, min, max, onchange }: Props = $props();
</script>

<span class="stepper">
	{label}<b>{value}</b>
	<button
		type="button"
		aria-label="Fewer {label}"
		disabled={value <= min}
		onclick={() => onchange(value - 1)}>−</button
	>
	<button
		type="button"
		aria-label="More {label}"
		disabled={value >= max}
		onclick={() => onchange(value + 1)}>+</button
	>
</span>

<style>
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 6px 0 10px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		font-size: var(--t-sm);
	}

	b {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-size: var(--t-lg);
		font-weight: 700;
		min-width: 1ch;
		text-align: center;
	}

	button {
		width: 24px;
		height: 24px;
		border: 0;
		border-radius: 4px;
		background: var(--surface-2);
		color: var(--ink);
		cursor: pointer;
		font-size: var(--t-sm);
		line-height: 1;
	}

	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* A thumb needs a 44px target: the buttons grow to it on a phone and the stepper with them. */
	@media (max-width: 760px) {
		.stepper {
			height: auto;
			min-height: var(--touch);
			padding: 0 0 0 var(--s-2);
			gap: var(--s-1);
		}

		button {
			width: var(--touch);
			height: var(--touch);
			font-size: var(--t-md);
		}
	}
</style>
