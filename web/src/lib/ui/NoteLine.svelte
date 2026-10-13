<script lang="ts">
	interface Props {
		/** Your words about him. */
		note: string;
		/** One line, cut with an ellipsis, until the row opens. */
		open?: boolean;
	}

	let { note, open = false }: Props = $props();
</script>

<span class="note" class:open>{note}</span>

<style>
	.note {
		display: block;
		min-width: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.open {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
