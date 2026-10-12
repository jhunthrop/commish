<script lang="ts">
	import ActionBase from './ActionBase.svelte';
	import type { ActionProps } from './actions.ts';

	/** The outlined action, for everything that is not the one verb. */
	let props: ActionProps = $props();
</script>

<ActionBase variant="quiet" {...props} />
