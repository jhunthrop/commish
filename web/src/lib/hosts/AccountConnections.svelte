<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { links } from '#lib/site/links.ts';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import ESPNConnect from './ESPNConnect.svelte';
	import FFPCSignIn from './FFPCSignIn.svelte';
	import MFLConnect from './MFLConnect.svelte';
	import YahooConnect from './YahooConnect.svelte';
	import {
		ApiError,
		disconnect as disconnectHost,
		goToYahoo,
		hostsApi,
		type ConnectedHost,
		type HostConnected,
		type HostConnections
	} from './api.ts';
	import { ESPN_CONSENT, MFL_CONSENT } from './connection-words.ts';
	import {
		PLATFORM_WORDS,
		platformRows,
		type Platform,
		type PlatformRow
	} from './platform-rows.ts';
	import { yahooOutcome } from './yahoo.ts';

	/** The Account room's Platforms table (Lane 66k): every platform a league runs on, one row each,
	 * with its connection and the consent it was made under, whether its lineup is set from here and
	 * why not, its last read, and its one verb. Disconnect deletes what we keep at once; a platform
	 * that dropped the connection has its way back in as the solid verb; one not connected opens its
	 * connect form under the table. Every state is GET /hosts; it reads its own answer. */
	let hosts = $state<HostConnections | null>(null);
	let failed = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	/** Set once a Disconnect went through: one line says what went. */
	let disconnected = $state<ConnectedHost | null>(null);
	/** The connect or connect-again form opened from a row. */
	let form = $state<ConnectedHost | null>(null);
	/** Said once ESPN connected with a session kept not yet proven, in the API's words. */
	let espnNote = $state<string | null>(null);
	/** Yahoo's return to this page, said once. */
	const returned = yahooOutcome(page.url.searchParams);

	function load(): void {
		hostsApi
			.connections()
			.then((answer) => {
				hosts = answer;
				failed = false;
			})
			.catch(() => (failed = true));
	}

	onMount(load);

	const rows = $derived(hosts ? platformRows(hosts, new Date()) : []);

	/** What disconnecting deleted, said once it went through. */
	const GONE: Readonly<Record<ConnectedHost, string>> = {
		ffpc: 'FFPC disconnected. Your password and session are deleted. Your FFPC league keeps its last read.',
		yahoo:
			'Yahoo disconnected. What Yahoo gave us to read with is deleted. Your Yahoo league keeps its last read.',
		espn: 'ESPN disconnected. Your ESPN session is deleted. Your ESPN league keeps its last read.',
		mfl: 'MyFantasyLeague disconnected. Your MyFantasyLeague session is deleted, and lineups are no longer set there from here.'
	};

	/** What we keep for a connected platform, said once under the table. */
	const KEEPS: Readonly<Partial<Record<ConnectedHost, string>>> = {
		ffpc: 'FFPC: we sign in as you to read your league and never make a move or a bid. Disconnect deletes your FFPC password and session at once.',
		espn: `ESPN: ${ESPN_CONSENT}`,
		mfl: `MyFantasyLeague: ${MFL_CONSENT}`
	};

	async function act(step: () => Promise<void>): Promise<void> {
		busy = true;
		problem = null;
		try {
			await step();
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
		} finally {
			busy = false;
		}
	}

	function connected(answer?: HostConnected): void {
		form = null;
		espnNote = answer?.note ?? null;
		load();
	}

	function hostOf(key: Platform): ConnectedHost | null {
		return key === 'sleeper' ? null : key;
	}

	/** A row's verb: disconnect at once, open Yahoo's own sign-in, or open the row's form. */
	function run(row: PlatformRow): void {
		const host = hostOf(row.key);
		if (host === null || row.verb === null) return;
		if (row.verb.kind === 'disconnect') {
			void act(async () => {
				await disconnectHost(host);
				disconnected = host;
				load();
			});
			return;
		}
		if (host === 'yahoo' && row.verb.kind === 'connect') {
			void act(() => goToYahoo());
			return;
		}
		form = form === host ? null : host;
	}

	const keeps = $derived(
		(hosts?.connections ?? []).flatMap((c) => {
			const words = KEEPS[c.host];
			return c.status === 'connected' && words ? [words] : [];
		})
	);
</script>

<section class="platforms" aria-label={PLATFORM_WORDS.title}>
	<div class="sec-h">
		<h2>{PLATFORM_WORDS.title}</h2>
		<span>{PLATFORM_WORDS.aside}</span>
	</div>
	{#if returned}
		<p class={returned.connected ? 'done' : 'note'} role="status">{returned.words}</p>
	{/if}
	{#if disconnected}<p class="done" role="status">{GONE[disconnected]}</p>{/if}
	{#if espnNote}<p class="done" role="status">{espnNote}</p>{/if}
	{#if failed}
		<p class="note">{PLATFORM_WORDS.unread}</p>
	{:else if hosts}
		<table class="set">
			<colgroup>
				<col class="c-name" />
				<col />
				<col class="c-wr" />
				<col class="c-read" />
				<col class="c-act" />
			</colgroup>
			<thead>
				<tr>
					<th scope="col">{PLATFORM_WORDS.platform}</th>
					<th scope="col">{PLATFORM_WORDS.connection}</th>
					<th scope="col">{PLATFORM_WORDS.lineups}</th>
					<th scope="col">{PLATFORM_WORDS.lastRead}</th>
					<th scope="col"><span class="sr">Verb</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.key)}
					<tr class:bad={row.dot === 'bad'}>
						<th scope="row" class="name">{row.name}</th>
						<td class="wide">
							<span class="st"
								><b><span class="dot {row.dot}" aria-hidden="true"></span>{row.state}</b><span
									>{row.line}</span
								></span
							>
						</td>
						<td class="wide">
							{#if row.writes}
								<span class="wcell"
									><span class="wr" class:on={row.writes.on}
										>{row.writes.on ? PLATFORM_WORDS.on : PLATFORM_WORDS.off}</span
									><span>{row.writes.words}</span></span
								>
							{:else}<span class="none">{PLATFORM_WORDS.never}</span>{/if}
						</td>
						<td class="read"><span class="ph-only">Last read&nbsp;</span>{row.read}</td>
						<td class="act">
							{#if row.verb?.kind === 'follow'}
								<Quiet size="sm" href={links.leagueNew()}>{row.verb.words}</Quiet>
							{:else if row.verb?.kind === 'again'}
								<Verb size="sm" onclick={() => run(row)}>{row.verb.words}</Verb>
							{:else if row.verb?.kind === 'connect' && row.key === 'ffpc'}
								<Quiet size="sm" href={links.leagueNew('ffpc')}>{row.verb.words}</Quiet>
							{:else if row.verb}
								<Quiet size="sm" disabled={busy} onclick={() => run(row)}>{row.verb.words}</Quiet>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if form === 'espn'}
			<div class="form">
				<ESPNConnect
					label={rows.find((r) => r.key === 'espn')?.verb?.kind === 'again'
						? 'Connect ESPN again'
						: 'Connect ESPN'}
					onconnected={connected}
				/>
			</div>
		{:else if form === 'mfl'}
			<div class="form">
				<MFLConnect
					label={rows.find((r) => r.key === 'mfl')?.verb?.kind === 'again'
						? 'Connect MyFantasyLeague again'
						: 'Connect MyFantasyLeague'}
					onconnected={() => connected()}
				/>
			</div>
		{:else if form === 'ffpc'}
			<div class="form"><FFPCSignIn onconnected={load} /></div>
		{:else if form === 'yahoo'}
			<div class="form"><YahooConnect label="Connect Yahoo again" /></div>
		{/if}
		{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
		{#if keeps.length > 0}
			<div class="keeps">
				{#each keeps as said (said)}<p>{said}</p>{/each}
			</div>
		{/if}
	{/if}
</section>

<style>
	.note,
	.done {
		margin: 0 0 var(--s-2);
		max-width: 70ch;
		font-size: var(--t-sm);
	}

	.note {
		color: var(--ink-2);
	}

	.form {
		margin-top: var(--s-3);
	}

	.keeps {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: var(--s-2);
	}

	.keeps p {
		margin: 0;
		font-size: var(--t-xs);
		color: var(--ink-3);
		max-width: 110ch;
	}

	.c-name {
		width: 170px;
	}

	.c-wr {
		width: 260px;
	}

	.c-read {
		width: 120px;
	}

	.c-act {
		width: 190px;
	}

	.name {
		font-weight: 600;
		text-align: left;
	}

	.wcell {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
	}

	.wcell > span:last-child {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.wr {
		display: inline-flex;
		align-items: center;
		height: 22px;
		padding: 0 8px;
		border-radius: var(--r-sm);
		border: 1px solid var(--line-strong);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-2);
	}

	.wr.on {
		border-color: transparent;
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 6px;
		border-radius: 50%;
		vertical-align: 1px;
		background: var(--gain-ink);
	}

	.dot.bad {
		background: var(--loss-ink);
	}

	.dot.off {
		background: transparent;
		border: 1.5px solid var(--ink-3);
	}

	tr.bad td,
	tr.bad th {
		background: color-mix(in srgb, var(--loss-bg) 45%, transparent);
	}

	tr.bad th {
		box-shadow: inset 3px 0 0 var(--loss-ink);
	}

	/* A row folded into a card is tinted whole. */
	@media (max-width: 900px) {
		tr.bad {
			background: color-mix(in srgb, var(--loss-bg) 45%, transparent);
			box-shadow: inset 3px 0 0 var(--loss-ink);
		}

		tr.bad td,
		tr.bad th {
			background: none;
			box-shadow: none;
		}
	}
</style>
