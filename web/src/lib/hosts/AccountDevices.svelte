<script lang="ts">
	import { onMount } from 'svelte';
	import { dayLabel } from '#lib/format/date.ts';
	import ActionRow from '#lib/ui/ActionRow.svelte';
	import ActionRows from '#lib/ui/ActionRows.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { ApiError, hostsApi, type Device, type PairCode } from './api.ts';

	/** Paired devices: each with when it was paired and last sent anything, and Unpair. A pairing
	 * code (six words, ten minutes, one use) is shown on a tap, never kept by the page. */
	let devices = $state<Device[] | null>(null);
	let code = $state<PairCode | null>(null);
	let busy = $state<string | null>(null);
	let problem = $state<string | null>(null);

	onMount(() => {
		hostsApi
			.devices()
			.then((list) => (devices = list))
			.catch(() => (devices = []));
	});

	async function act(key: string, step: () => Promise<void>): Promise<void> {
		busy = key;
		problem = null;
		try {
			await step();
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
		} finally {
			busy = null;
		}
	}

	function line(d: Device): string {
		const used = d.last_used_at ? `last sent ${dayLabel(d.last_used_at)}` : 'not used yet';
		return `Paired ${dayLabel(d.created_at)}, ${used}`;
	}
</script>

<!-- Shown once the account has a paired device: no client pairs today (the extension is paused,
	the phone app not built), so a code would lead nowhere. -->
{#if devices && devices.length > 0}
	<section aria-label="Paired devices">
		<PanelHead title="Paired devices" aside={String(devices.length)} level={2} />
		{#if devices}
			{#if devices.length > 0}
				<ActionRows label="Paired devices">
					{#each devices as d (d.id)}
						<ActionRow lead={d.name} text={line(d)}>
							{#snippet action()}
								<Quiet
									size="sm"
									disabled={busy !== null}
									onclick={() =>
										void act(d.id, async () => {
											await hostsApi.revokeDevice(d.id);
											devices = (devices ?? []).filter((x) => x.id !== d.id);
										})}>{busy === d.id ? 'Unpairing' : 'Unpair'}</Quiet
								>
							{/snippet}
						</ActionRow>
					{/each}
				</ActionRows>
			{/if}
			{#if code}
				<p class="code" aria-live="polite"><b>{code.code}</b></p>
				<p class="note">
					Type these six words where the device asks. They work once, for ten minutes.
				</p>
			{:else}
				<Quiet
					size="sm"
					disabled={busy !== null}
					onclick={() =>
						void act('code', async () => {
							code = await hostsApi.pairCode();
						})}>Pair a device</Quiet
				>
			{/if}
			{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
		{/if}
	</section>
{/if}

<style>
	.note {
		margin: var(--s-2) 0 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.code {
		margin: var(--s-2) 0 0;
		font-size: var(--t-lg);
		letter-spacing: 0.02em;
	}
</style>
