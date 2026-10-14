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
	import { plural } from '#lib/format/number.ts';
	import { leagueApi } from '#lib/league/api.ts';
	import { agoWords } from '#lib/league/model.ts';
	import { ApiError, ffpcOpen, hostsApi, type HostConnection } from './api.ts';

	/** The hosts the account reads as the member (FFPC), each with its state, a one-tap disconnect
	 * that deletes the kept password and session at once, and, when FFPC has signed the member out,
	 * the sign-in form right here. It reads its own list. */
	let connections = $state<HostConnection[] | null>(null);
	let open = $state(false);
	let failed = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	/** Set once Disconnect went through: one line stands where the row was. */
	let disconnected = $state(false);
	/** How many FFPC leagues the account follows, null until read or when it cannot be. */
	let ffpcLeagues = $state<number | null>(null);

	function load(): void {
		hostsApi
			.connections()
			.then((hosts) => {
				connections = hosts.connections;
				open = ffpcOpen(hosts);
				disconnected = false;
			})
			.catch(() => (failed = true));
		leagueApi
			.attached()
			.then((list) => (ffpcLeagues = list.filter((l) => l.host === 'ffpc').length))
			.catch(() => (ffpcLeagues = null));
	}

	onMount(load);

	const STATUS: Readonly<Record<HostConnection['status'], string>> = {
		connected: 'Signed in',
		signed_out: 'Signed out by FFPC'
	};

	/** A read's age: "1 minute ago" within a day, its date after. */
	const DAY_SECONDS = 86_400;
	function readWhen(at: string): string {
		const age = Math.max(0, (Date.now() - Date.parse(at)) / 1000);
		return age < DAY_SECONDS ? agoWords(age) : `on ${dayLabel(at)}`;
	}

	/** "Signed in. Reads your 2 FFPC leagues, last read 1 minute ago." "Signed out by FFPC. Last
	 * read on Oct 12." */
	function line(c: HostConnection): string {
		const when = c.last_read_at ? readWhen(c.last_read_at) : null;
		const reads =
			c.status === 'connected' && ffpcLeagues !== null && ffpcLeagues > 0
				? `Reads your ${plural(ffpcLeagues, 'FFPC league')}`
				: null;
		if (reads) return `${STATUS[c.status]}. ${reads}${when ? `, last read ${when}` : ''}.`;
		return `${STATUS[c.status]}.${when ? ` Last read ${when}.` : ''}`;
	}

	async function disconnect(gone: HostConnection): Promise<void> {
		busy = true;
		problem = null;
		try {
			await hostsApi.disconnectFFPC();
			connections = (connections ?? []).filter((c) => c !== gone);
			disconnected = true;
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
		} finally {
			busy = false;
		}
	}

	/** FFPC signed the member out here, so the form shows, and it carries the consent itself. */
	const signingIn = $derived(open && (connections ?? []).some((c) => c.status === 'signed_out'));
</script>

{#if failed || disconnected || (connections !== null && (connections.length > 0 || open))}
	<section aria-label="Connected accounts">
		<PanelHead title="Connected accounts" level={2} />
		{#if failed}
			<p class="note">Your connected accounts can't be read right now.</p>
		{:else if disconnected}
			<p class="done" role="status">
				FFPC disconnected. Your password and session are deleted. Your FFPC league keeps its last
				read.
			</p>
			<!-- The way back in stays, as the empty state has it. -->
			{#if open}<div class="again">{@render follow()}</div>{/if}
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
			{#if signingIn}
				<div class="again"><FFPCSignIn onconnected={load} /></div>
			{:else}
				<p class="note">
					We sign in to FFPC as you to read your league. We never make a move or a bid. Disconnect
					deletes your FFPC password and session at once.
				</p>
			{/if}
			{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
		{:else if connections && open}
			<EmptyState level={3} title="No connected accounts">
				{#snippet actions()}{@render follow()}{/snippet}
			</EmptyState>
		{/if}
	</section>
{/if}

{#snippet follow()}
	<Quiet href={links.leagueNew('ffpc')}>Follow an FFPC league</Quiet>
{/snippet}

<style>
	.note,
	.done {
		margin: var(--s-2) 0 0;
		max-width: 60ch;
	}

	.note {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.again {
		margin-top: var(--s-3);
	}
</style>
