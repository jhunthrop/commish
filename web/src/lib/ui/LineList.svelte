<script lang="ts">
	/** A short list said in sentences, each led by its name in bold: "Week 1 · frozen Sep 8, graded
	 * after the games". A number at the end, when the line has one, sits right in the number face. */
	interface Line {
		/** Keys the line and leads it: "Week 1". */
		lead: string;
		/** The rest of the sentence. */
		text: string;
		/** A number at the line's end, already formatted, with its basis said in the text. */
		figure?: string;
	}

	interface Props {
		lines: readonly Line[];
		/** Names the list for assistive tech. */
		label: string;
	}

	let { lines, label }: Props = $props();
</script>

<ul aria-label={label}>
	{#each lines as line (line.lead)}
		<li>
			<b>{line.lead}</b>
			<span class="text">{line.text}</span>
			{#if line.figure}<span class="figure">{line.figure}</span>{/if}
		</li>
	{/each}
</ul>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--line);
	}

	li {
		display: flex;
		align-items: baseline;
		gap: var(--s-3);
		min-height: var(--row-h);
		padding: var(--s-3) 0;
		border-bottom: 1px solid var(--line);
		font-size: var(--t-md);
	}

	b {
		flex: none;
		font-weight: 600;
	}

	.text {
		color: var(--ink-2);
	}

	.figure {
		margin-left: auto;
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-xl);
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
</style>
