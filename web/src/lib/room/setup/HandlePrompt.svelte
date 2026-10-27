<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { LOBBY } from '../lobby-words.ts';

	interface Props {
		/** The API's word on the last try, when it refused the handle. */
		problem: string | null;
		busy: boolean;
		onsave: (handle: string) => void;
	}

	let { problem, busy, onsave }: Props = $props();

	let handle = $state('');
</script>

<Panel edge="accent">
	<form
		class="handle"
		onsubmit={(e) => {
			e.preventDefault();
			onsave(handle.trim());
		}}
	>
		<p class="ask">{LOBBY.handleAsk}</p>
		<div class="row">
			<Field
				hideLabel
				bind:value={handle}
				maxlength={20}
				label={LOBBY.handleLabel}
				placeholder={LOBBY.handlePlaceholder}
			/>
			<Verb type="submit" disabled={busy || handle.trim().length < 3}>{LOBBY.saveAndJoin}</Verb>
		</div>
		{#if problem}<p class="problem">{problem}</p>{/if}
	</form>
</Panel>

<style>
	.handle {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.ask {
		margin: 0;
		font-weight: 600;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
	}

	.problem {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--loss-ink);
	}
</style>
