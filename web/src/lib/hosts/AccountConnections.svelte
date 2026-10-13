<script lang="ts">
	import { onMount } from 'svelte';
	import { dayLabel } from '#lib/format/date.ts';
	import { links } from '#lib/site/links.ts';
	import ActionRow from '#lib/ui/ActionRow.svelte';
	import ActionRows from '#lib/ui/ActionRows.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import FFPCSignIn from './FFPCSignIn.svelte';
	import { ApiError, ffpcOpen, hostsApi, type HostConnection } from './api.ts';

	/** The hosts the account reads as the member (FFPC), each with its state, a one-tap disconnect
	 * that deletes the kept sign-in and session at once, and, when FFPC has signed the member out,
	 * the sign-in form right here. It reads its own list. */
	let connections = $state<HostConnection[] | null>(null);
	let open = $state(false);
	let failed = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);

	function load(): void {
		hostsApi
			.connections()
			.then((hosts) => {
				connections = hosts.connections;
				open = ffpcOpen(hosts);
			})
			.catch(() => (failed = true));
	}

	onMount(load);

	const STATUS: Readonly<Record<HostConnection['status'], string>> = {
		connected: 'Signed in',
		signed_out: 'FFPC signed you out. Sign in again below'
	};

	function line(c: HostConnection): string {
		const read = c.last_read_at ? `, last read ${dayLabel(c.last_read_at)}` : '';
		return `${STATUS[c.status]}${read}`;
	}

	async function disconnect(gone: HostConnection): Promise<void> {
		busy = true;
		problem = null;
		try {
			await hostsApi.disconnectFFPC();
			connections = (connections ?? []).filter((c) => c !== gone);
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
		} finally {
			busy = false;
		}
	}

	const signedOut = $derived((connections ?? []).some((c) => c.status === 'signed_out'));
</script>

{#if failed || (connections !== null && (connections.length > 0 || open))}
	<section aria-label="Connected accounts">
		<PanelHead title="Connected accounts" level={2} />
		{#if failed}
			<p class="note">Your connected accounts can't be read right now.</p>
		{:else if connections && connections.length > 0}
			<ActionRows label="Connected accounts">
				{#each connections as c (c.host)}
					<ActionRow lead="FFPC" text={line(c)}>
						{#snippet action()}
							<Quiet size="sm" disabled={busy} onclick={() => void disconnect(c)}
								>{busy ? 'Disconnecting' : 'Disconnect'}</Quiet
							>
						{/snippet}
					</ActionRow>
				{/each}
			</ActionRows>
			{#if signedOut && open}
				<div class="again"><FFPCSignIn onconnected={load} /></div>
			{/if}
			<p class="note">
				We sign in to FFPC as you to read your league. We never make a move or a bid. Disconnecting
				deletes your FFPC sign-in from Commish at once.
			</p>
			{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
		{:else if connections && open}
			<EmptyState level={3} title="No connected accounts">
				{#snippet actions()}<Quiet href={links.leagueNew()}>Follow an FFPC league</Quiet>{/snippet}
			</EmptyState>
		{/if}
	</section>
{/if}

<style>
	.note {
		margin: var(--s-2) 0 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
		max-width: 60ch;
	}

	.again {
		margin-top: var(--s-3);
	}
</style>
