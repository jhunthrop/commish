<script lang="ts">
	import type { KeyBinding } from '#lib/types/room.ts';
	import Panel from './Panel.svelte';

	interface Props {
		bindings: readonly KeyBinding[];
	}

	let { bindings }: Props = $props();
</script>

<!-- A keyboard legend has no use on a phone, so it leaves the layout there. -->
<div class="wrap">
	<Panel padding="sm">
		<dl>
			{#each bindings as { keys, does } (keys)}
				<dt><kbd>{keys}</kbd></dt>
				<dd>{does}</dd>
			{/each}
		</dl>
	</Panel>
</div>

<style>
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px var(--s-3);
		align-items: center;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	dd {
		margin: 0;
	}

	kbd {
		font-family: var(--font-ui);
		font-size: 11px;
		border: 1px solid var(--line-strong);
		border-radius: 4px;
		padding: 1px 7px;
		color: var(--ink);
	}

	@media (max-width: 760px) {
		.wrap {
			display: none;
		}
	}
</style>
