<script lang="ts">
	import { plural } from '#lib/format/number.ts';

	interface Props {
		/** Drafters' ADP against our rank, in picks. Positive is later, a gain for you. Null is no ADP. */
		gap: number | null;
	}

	let { gap }: Props = $props();

	const kind = $derived(gap === null || gap === 0 ? 'even' : gap > 0 ? 'later' : 'earlier');
	const text = $derived.by(() => {
		if (gap === null) return 'No ADP yet';
		if (gap === 0) return 'Same spot';
		return `${plural(Math.abs(gap), 'pick')} ${kind}`;
	});
</script>

<span class="gap {kind}">{text}</span>

<style>
	.gap {
		display: inline-flex;
		align-items: center;
		height: 22px;
		padding: 0 8px;
		border-radius: var(--r-sm);
		font-size: var(--t-sm);
		font-weight: 600;
		white-space: nowrap;
	}

	.later {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.earlier {
		background: var(--loss-bg);
		color: var(--loss-ink);
	}

	.even {
		background: var(--surface-2);
		color: var(--ink-2);
	}

	@media (max-width: 760px) {
		.gap {
			font-size: var(--t-xs);
			padding: 0 6px;
		}
	}
</style>
