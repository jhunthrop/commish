<script lang="ts">
	import Field from '#lib/ui/Field.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';

	/** Save the setup under a name, so a rerun is one tap. Signed out, it says sign-in comes first. */
	interface Props {
		signedOut: boolean;
		busy: boolean;
		/** The setup can be saved (its roster makes a legal draft). */
		ready: boolean;
		/** Saves under the name; true when it saved. */
		onsave: (name: string) => Promise<boolean>;
	}

	let { signedOut, busy, ready, onsave }: Props = $props();

	let naming = $state(false);
	let name = $state('');

	async function save(): Promise<void> {
		const trimmed = name.trim();
		if (trimmed === '') return;
		if (await onsave(trimmed)) {
			naming = false;
			name = '';
		}
	}
</script>

<div class="save">
	{#if signedOut}
		<span class="later">Sign in to save this setup as a league</span>
	{:else if naming}
		<Field
			hideLabel
			bind:value={name}
			maxlength={60}
			placeholder="Tuesday night, 12 PPR"
			label="League name"
			onenter={save}
		/>
		<Quiet disabled={busy || name.trim() === ''} onclick={save}>Save</Quiet>
	{:else}
		<Quiet disabled={!ready} onclick={() => (naming = true)}>Save as a league</Quiet>
	{/if}
</div>

<style>
	.save {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		align-items: center;
		margin-top: var(--s-3);
	}

	.later {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}
</style>
