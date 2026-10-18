<script lang="ts">
	interface Props {
		/** The number, already formatted: "273.7", "+93.7", "Pick 18". */
		value: string;
		/** sm trails a list line, md heads a fact, lg is a section's number, xl is the page's one big number. */
		size?: 'sm' | 'md' | 'lg' | 'xl';
		/** What the number is, in the same view: its basis. Every number above sm carries one. */
		caption?: string;
		align?: 'start' | 'end';
		/** Where it aligns on the phone, when the layout above it stacks: a hero's number moves to the start. */
		phoneAlign?: 'start' | 'end';
		/** A line under the caption, quieter: when the number was read ("Read Sep 7"). */
		note?: string;
	}

	let { value, size = 'md', caption, align = 'start', phoneAlign = align, note }: Props = $props();
</script>

<span
	class="figure {size}"
	class:end={align === 'end'}
	class:phone-start={phoneAlign === 'start'}
	class:phone-end={phoneAlign === 'end'}
>
	<b>{value}</b>
	{#if caption}<span class="caption">{caption}</span>{/if}
	{#if note}<span class="note">{note}</span>{/if}
</span>

<style>
	.figure {
		display: inline-flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.end {
		align-items: flex-end;
		text-align: right;
	}

	b {
		font-family: var(--font-num);
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		line-height: 0.9;
		white-space: nowrap;
	}

	.sm b {
		font-weight: 700;
		font-size: 20px;
	}

	.md b {
		font-weight: 700;
		font-size: var(--t-xl);
	}

	.lg b {
		font-size: var(--t-2xl);
	}

	.xl b {
		font-size: var(--t-3xl);
		line-height: 0.82;
	}

	.caption {
		font-size: var(--t-sm);
		color: var(--ink-2);
		max-width: 28ch;
	}

	.note {
		margin-top: -4px;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	@media (max-width: 760px) {
		.phone-start {
			align-items: flex-start;
			text-align: left;
		}

		.phone-end {
			align-items: flex-end;
			text-align: right;
		}

		.xl b {
			font-size: 72px;
		}

		.lg b {
			font-size: 34px;
		}
	}
</style>
