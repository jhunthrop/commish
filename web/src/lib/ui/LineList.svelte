<script lang="ts">
	/** A short list said in sentences, each led by its name in bold: "Week 1 · frozen Sep 8, graded
	 * after the games". A number at the end, when the line has one, sits right in the number face. */
	interface Line {
		/** Leads the line: "Week 1". It keys the line too, unless key is given. */
		lead: string;
		/** Keys the line when two leads can read the same: a sheet's id. */
		key?: string;
		/** The rest of the sentence. */
		text: string;
		/** A number at the line's end, already formatted, with its basis said in the text. */
		figure?: string;
		/** Where the lead goes, when the line names something with its own page. */
		href?: string;
		/** Runs before the link is followed: a sheet opens on the account before its page loads. */
		onclick?: (event: MouseEvent) => void;
		/** Struck through and quiet: a player on your sheet the draft has taken. */
		struck?: boolean;
	}

	interface Props {
		lines: readonly Line[];
		/** Names the list for assistive tech. */
		label: string;
	}

	let { lines, label }: Props = $props();
</script>

<ul aria-label={label}>
	{#each lines as line (line.key ?? line.lead)}
		<li class:struck={line.struck}>
			{#if line.href}
				<a href={line.href} onclick={line.onclick}><b>{line.lead}</b></a>
			{:else}
				<b>{line.lead}</b>
			{/if}
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
		flex-wrap: wrap;
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

	a {
		flex: none;
		text-decoration: none;
	}

	a:hover b {
		text-decoration: underline;
	}

	.text {
		color: var(--ink-2);
	}

	.struck b,
	.struck .text {
		color: var(--ink-3);
		text-decoration: line-through;
	}

	/* On the phone every line sets its text under its lead, whatever the lengths, so a list reads
	   one way down the page. */
	@media (max-width: 760px) {
		li {
			row-gap: var(--s-1);
		}

		.text {
			flex-basis: 100%;
		}
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
