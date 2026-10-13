<script lang="ts">
	import { plural } from '#lib/format/number.ts';
	import ToneChip from './ToneChip.svelte';

	interface Props {
		/** Drafters' ADP against our rank, in picks. Positive is later, a gain for you. Null is no ADP. */
		gap: number | null;
	}

	let { gap }: Props = $props();

	const tone = $derived(gap === null || gap === 0 ? 'even' : gap > 0 ? 'gain' : 'loss');
	const text = $derived.by(() => {
		if (gap === null) return 'No ADP yet';
		if (gap === 0) return 'Same spot';
		return `${plural(Math.abs(gap), 'pick')} ${gap > 0 ? 'later' : 'earlier'}`;
	});
</script>

<ToneChip {tone} size="md">{text}</ToneChip>
