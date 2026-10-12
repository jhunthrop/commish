<script lang="ts">
	import ActionBase from './ActionBase.svelte';
	import type { ActionProps } from './actions.ts';

	/** The one solid orange action per viewport, named with what it does: Start a mock draft. */
	let props: ActionProps = $props();
</script>

<ActionBase variant="verb" {...props} />
