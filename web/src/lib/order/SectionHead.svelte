<script lang="ts">
	/** A section's head across a box score's row (Lane 66w): "Kicked off", "Bye in week 7". The week's
	 * box score and the Players page's week rankings draw their sections with it, so the byes read the
	 * same on every chip (Lane 163, D06). */
	interface Props {
		/** How many columns the head spans. */
		span: number;
		head: string;
	}

	let { span, head }: Props = $props();
</script>

<tr class="sec"><th colspan={span} scope="colgroup">{head}</th></tr>

<style>
	.sec {
		height: var(--row-h);
	}

	.sec th {
		height: 26px;
		padding: 0 var(--s-2);
		text-align: left;
		background: var(--bg);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-2);
		border-bottom: 1px solid var(--line);
	}

	/* A phone's box score lays its rows out as grids (Lane 209); the section head stays one band. */
	@media (max-width: 760px) {
		.sec,
		.sec th {
			display: block;
			height: auto;
		}

		.sec th {
			line-height: 26px;
		}
	}
</style>
