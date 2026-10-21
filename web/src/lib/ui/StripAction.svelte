<script lang="ts">
	import ActionBase from './ActionBase.svelte';
	import { stripVariant, type ActionProps } from './actions.ts';

	interface Props extends ActionProps {
		/** The strip's lead card (its first, the best): the one solid verb. Every other card
		 * draws the same words quiet, at the same size, so the cards line up. */
		lead: boolean;
	}

	let { lead, ...props }: Props = $props();
</script>

<ActionBase variant={stripVariant(lead)} {...props} />
