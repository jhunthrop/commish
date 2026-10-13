<script lang="ts">
	interface Props {
		/** What a screen reader says after something moved. Unseen on the page. */
		words: string;
	}

	let { words }: Props = $props();
</script>

<span class="live" role="status" aria-live="polite">{words}</span>

<style>
	.live {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
