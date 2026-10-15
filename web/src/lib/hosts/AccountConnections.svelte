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
	import ESPNConnect from './ESPNConnect.svelte';
	import FFPCSignIn from './FFPCSignIn.svelte';
	import YahooConnect from './YahooConnect.svelte';
	import { plural } from '#lib/format/number.ts';
	import { leagueApi } from '#lib/league/api.ts';
	import { agoWords } from '#lib/league/model.ts';
	import { hostWords } from '#lib/league/names.ts';
	import {
		ApiError,
		disconnect as disconnectHost,
		espnOpen,
		ffpcOpen,
		goToYahoo,
		hostsApi,
		yahooOpen,
		type ConnectedHost,
		type HostConnected,
		type HostConnection
	} from './api.ts';
	import { ESPN_CONSENT, statusWords } from './connection-words.ts';
	import { yahooOutcome } from './yahoo.ts';

	/** The hosts the account reads as the member (FFPC, Yahoo, ESPN), each with its state, a one-tap
	 * disconnect that deletes what we keep at once, and, when a host has dropped the connection, the
	 * way back in right here. Yahoo or ESPN not yet connected is one verb each. It reads its own list. */
	let connections = $state<HostConnection[] | null>(null);
	let open = $state<Record<ConnectedHost, boolean>>({ ffpc: false, yahoo: false, espn: false });
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
				open = { ffpc: ffpcOpen(hosts), yahoo: yahooOpen(hosts), espn: espnOpen(hosts) };
			})
			.catch(() => (failed = true));
		leagueApi
			.attached()
			.then(
				(list) =>
					(followed = {
						ffpc: list.filter((l) => l.host === 'ffpc').length,
						yahoo: list.filter((l) => l.host === 'yahoo').length,
						espn: list.filter((l) => l.host === 'espn').length
					})
			)
			.catch(() => (followed = null));
	}

	onMount(load);

	/** What disconnecting deleted, said once it went through. */
	const GONE: Readonly<Record<ConnectedHost, string>> = {
		ffpc: 'FFPC disconnected. Your password and session are deleted. Your FFPC league keeps its last read.',
		yahoo:
			'Yahoo disconnected. What Yahoo gave us to read with is deleted. Your Yahoo league keeps its last read.',
		espn: 'ESPN disconnected. Your ESPN session is deleted. Your ESPN league keeps its last read.'
	};

	/** A read's age: "1 minute ago" within a day, its date after. */
	const DAY_SECONDS = 86_400;
	function readWhen(at: string): string {
		const age = Math.max(0, (Date.now() - Date.parse(at)) / 1000);
		return age < DAY_SECONDS ? agoWords(age) : `on ${dayLabel(at)}`;
	}

	/** "Signed in. Reads your 2 FFPC leagues, last read 1 minute ago." "Signed out by FFPC. Last
	 * read on Oct 12." "Connected, not yet checked against a private league." */
	function line(c: HostConnection): string {
		const when = c.last_read_at ? readWhen(c.last_read_at) : null;
		const count = followed?.[c.host] ?? 0;
		const status = statusWords(c);
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
			await disconnectHost(gone.host);
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
	const espnAgain = $derived(open.espn && connectionOf('espn')?.status === 'signed_out');
	/** ESPN's connect form, opened from its row. */
	let espnForm = $state(false);
	/** Said once ESPN connected with a session kept not yet proven, in the API's words. */
	let espnNote = $state<string | null>(null);

	/** ESPN connected here: the form closes, the note shows, and the list reads again. */
	function espnConnected(answer: HostConnected): void {
		espnForm = false;
		espnNote = answer.note ?? null;
		load();
	}

	/** Open Yahoo's own sign-in from its row. */
	async function connectYahoo(): Promise<void> {
		busy = true;
		problem = null;
		try {
			await goToYahoo();
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
			busy = false;
		}
	}

	/** Yahoo is open and not connected: its row connects it. */
	const yahooNew = $derived(open.yahoo && connections !== null && !connectionOf('yahoo'));
	/** ESPN is open and not connected: one verb connects it. */
	const espnNew = $derived(open.espn && connections !== null && !connectionOf('espn'));
	const anyOpen = $derived(open.ffpc || open.yahoo || open.espn);
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
				{#if espnAgain}
					<div class="again">
						<ESPNConnect label="Connect ESPN again" onconnected={espnConnected} />
					</div>
				{:else if connectionOf('espn')}
					{#if espnNote}<p class="done" role="status">{espnNote}</p>{/if}
					<p class="note">{ESPN_CONSENT}</p>
				{/if}
			{:else if anyOpen && !yahooNew && !espnNew}
				<EmptyState level={3} title="No connected accounts">
					{#snippet actions()}{@render follow()}{/snippet}
				</EmptyState>
			{/if}
			{#if yahooNew || espnNew}
				<ActionRows label="Hosts to connect">
					{#if yahooNew}
						<ActionRow lead="Yahoo" text="Not connected. Connect to follow your Yahoo leagues.">
							{#snippet action()}
								<Quiet size="sm" disabled={busy} onclick={() => void connectYahoo()}>Connect</Quiet>
							{/snippet}
						</ActionRow>
					{/if}
					{#if espnNew}
						<ActionRow
							lead="ESPN"
							text="Not connected. Connect to follow your ESPN leagues, public or private."
						>
							{#snippet action()}
								<Quiet size="sm" onclick={() => (espnForm = !espnForm)}>Connect</Quiet>
							{/snippet}
						</ActionRow>
					{/if}
				</ActionRows>
				{#if espnNew && espnForm}
					<div class="again"><ESPNConnect onconnected={espnConnected} /></div>
				{/if}
			{/if}
			{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
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
