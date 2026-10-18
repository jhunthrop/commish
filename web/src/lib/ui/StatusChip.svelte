<script lang="ts">
	import type { StatusView } from '#lib/run/status-view.ts';

	/** A player's status in a word, the one chip every screen draws (Lane 63, Lane 66n): the week's
	 * designation ("Questionable"), or a season-long list's with its start ("IR since Sep 28"), rose
	 * when it keeps him out. Its styles are base.css's (.status-chip), so a prerendered page paints it
	 * styled before any script or chunk arrives (review 66n finding 1). StatusPill draws it beside the
	 * position pill; the front door's week draws it alone. */
	interface Props {
		status: StatusView;
	}

	let { status }: Props = $props();
</script>

<span class="status-chip" class:sits={status.sits}>{status.mark}</span>
