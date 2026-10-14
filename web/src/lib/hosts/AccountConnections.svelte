<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { dayLabel } from '#lib/format/date.ts';
	import { links } from '#lib/site/links.ts';
	import ActionRow from '#lib/ui/ActionRow.svelte';
	import ActionRows from '#lib/ui/ActionRows.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import FFPCSignIn from './FFPCSignIn.svelte';
	import YahooConnect from './YahooConnect.svelte';
	import { plural } from '#lib/format/number.ts';
	import { leagueApi } from '#lib/league/api.ts';
	import { agoWords } from '#lib/league/model.ts';
	import { hostWords } from '#lib/league/names.ts';
	import {
		ApiError,
		ffpcOpen,
		hostsApi,
		yahooOpen,
		type ConnectedHost,
		type HostConnection
	} from './api.ts';
	import { yahooOutcome } from './yahoo.ts';

	/** The hosts the account reads as the member (FFPC, Yahoo), each with its state, a one-tap
	 * disconnect that deletes what we keep at once, and, when a host has dropped the connection, the
	 * way back in right here. Yahoo not yet connected is one verb. It reads its own list. */
	let connections = $state<HostConnection[] | null>(null);
	let open = $state<{ ffpc: boolean; yahoo: boolean }>({ ffpc: false, yahoo: false });
	let failed = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	/** Set once a Disconnect went through: one line says what went. */
	let disconnected = $state<ConnectedHost | null>(null);
	/** How many leagues the account follows on each host, null until read or when it cannot be. */
	let followed = $state<Partial<Record<ConnectedHost, number>> | null>(null);
	/** Yahoo's return to this page, said once. */
	const returned = yahooOutcome(page.url.searchParams);

	function load(): void {
		hostsApi
			.connections()
			.then((hosts) => {
				connections = hosts.connections;
				open = { ffpc: ffpcOpen(hosts), yahoo: yahooOpen(hosts) };
			})
			.catch(() => (failed = true));
		leagueApi
			.attached()
			.then(
				(list) =>
					(followed = {
						ffpc: list.filter((l) => l.host === 'ffpc').length,
						yahoo: list.filter((l) => l.host === 'yahoo').length
					})
			)
			.catch(() => (followed = null));
	}

	onMount(load);

	const STATUS: Readonly<Record<ConnectedHost, Record<HostConnection['status'], string>>> = {
		ffpc: { connected: 'Signed in', signed_out: 'Signed out by FFPC' },
		yahoo: { connected: 'Connected', signed_out: 'Yahoo asks you to connect again' }
	};

	/** What disconnecting deleted, said once it went through. */
	const GONE: Readonly<Record<ConnectedHost, string>> = {
		ffpc: 'FFPC disconnected. Your password and session are deleted. Your FFPC league keeps its last read.',
		yahoo:
			'Yahoo disconnected. What Yahoo gave us to read with is deleted. Your Yahoo league keeps its last read.'
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
		const count = followed?.[c.host] ?? 0;
		const status = STATUS[c.host][c.status];
		const reads =
			c.status === 'connected' && count > 0
				? `Reads your ${plural(count, `${hostWords(c.host)} league`)}`
				: null;
		if (reads) return `${status}. ${reads}${when ? `, last read ${when}` : ''}.`;
		return `${status}.${when ? ` Last read ${when}.` : ''}`;
	}

	async function disconnect(gone: HostConnection): Promise<void> {
		busy = true;
		problem = null;
		try {
			await (gone.host === 'ffpc' ? hostsApi.disconnectFFPC() : hostsApi.disconnectYahoo());
			connections = (connections ?? []).filter((c) => c !== gone);
			disconnected = gone.host;
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
		} finally {
			busy = false;
		}
	}

	function connectionOf(host: ConnectedHost): HostConnection | undefined {
		return (connections ?? []).find((c) => c.host === host);
	}

	/** A host dropped the connection here, so the way back in shows. */
	const ffpcAgain = $derived(open.ffpc && connectionOf('ffpc')?.status === 'signed_out');
	const yahooAgain = $derived(open.yahoo && connectionOf('yahoo')?.status === 'signed_out');
	/** Yahoo is open and not connected: one verb connects it. */
	const yahooNew = $derived(open.yahoo && connections !== null && !connectionOf('yahoo'));
	const anyOpen = $derived(open.ffpc || open.yahoo);
	/** The section shows once there is something to say or a host to connect. */
	const shown = $derived(
		failed ||
			disconnected !== null ||
			returned !== null ||
			(connections !== null && (connections.length > 0 || anyOpen))
	);
</script>

{#if shown}
	<section aria-label="Connected accounts">
		<PanelHead title="Connected accounts" level={2} />
		{#if returned}
			<p class={returned.connected ? 'done' : 'note'} role="status">{returned.words}</p>
			{#if returned.connected}
				<div class="again">
					<Quiet href={links.leagueNew('yahoo')}>Follow a Yahoo league</Quiet>
				</div>
			{/if}
		{/if}
		{#if failed}
			<p class="note">Your connected accounts can't be read right now.</p>
		{:else}
			{#if disconnected}
				<p class="done" role="status">{GONE[disconnected]}</p>
			{/if}
			{#if connections && connections.length > 0}
				<ActionRows label="Connected accounts">
					{#each connections as c (c.host)}
						<ActionRow lead={hostWords(c.host)} text={line(c)}>
							{#snippet action()}
								<Quiet size="sm" disabled={busy} onclick={() => void disconnect(c)}
									>{busy ? 'Disconnecting' : 'Disconnect'}</Quiet
								>
							{/snippet}
						</ActionRow>
					{/each}
				</ActionRows>
				{#if ffpcAgain}
					<div class="again"><FFPCSignIn onconnected={load} /></div>
				{:else if connectionOf('ffpc')}
					<p class="note">
						We sign in to FFPC as you to read your league. We never make a move or a bid. Disconnect
						deletes your FFPC password and session at once.
					</p>
				{/if}
				{#if yahooAgain}
					<div class="again"><YahooConnect label="Connect Yahoo again" /></div>
				{/if}
				{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
			{:else if anyOpen && !yahooNew}
				<EmptyState level={3} title="No connected accounts">
					{#snippet actions()}{@render follow()}{/snippet}
				</EmptyState>
			{/if}
			{#if yahooNew}
				<div class="again"><YahooConnect /></div>
			{/if}
			{#if disconnected === 'ffpc' && open.ffpc}<div class="again">{@render follow()}</div>{/if}
		{/if}
	</section>
{/if}

{#snippet follow()}
	{#if open.ffpc}<Quiet href={links.leagueNew('ffpc')}>Follow an FFPC league</Quiet>{/if}
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
