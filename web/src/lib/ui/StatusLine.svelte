<script lang="ts">
	/** A screen's honest state in one line above its rows, when a figure it shows is not in yet: what is
	 * missing first and strong, then what the rows do until it is (Lane 66w's empty state). */
	interface Props {
		lead: string;
		rest: string;
	}

	let { lead, rest }: Props = $props();
</script>

<p class="status" role="status"><b>{lead}</b> {rest}</p>

<style>
	.status {
		margin: 0;
		padding: var(--s-3) var(--s-4);
		border: 1px solid var(--line);
		border-left: 4px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-2);
	}

	b {
		font-weight: 700;
		color: var(--ink);
	}
</style>
