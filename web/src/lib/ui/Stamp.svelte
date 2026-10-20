<script lang="ts">
	interface Props {
		/** What the page's numbers are as of: "Updated Oct 12". */
		text: string;
	}

	let { text }: Props = $props();
</script>

<span class="stamp">{text}</span>

<style>
	.stamp {
		font-size: var(--t-xs);
		font-weight: 500;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--ink-3);
		white-space: nowrap;
	}
</style>
