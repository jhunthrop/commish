<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import TextInput from '#lib/ui/TextInput.svelte';
	import Verb from '#lib/ui/Verb.svelte';

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
		<label for="handle">The name the room shows the other drafters</label>
		<div class="row">
			<TextInput
				id="handle"
				bind:value={handle}
				maxlength={20}
				label="Handle"
				placeholder="3 to 20 letters, digits or _"
			/>
			<Verb type="submit" disabled={busy || handle.trim().length < 3}>Save and join</Verb>
		</div>
		{#if problem}<p>{problem}</p>{/if}
	</form>
</Panel>

<style>
	.handle {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	label {
		font-weight: 600;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
	}

	p {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--loss-ink);
	}
</style>
