<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { isSignedOut } from '#lib/api/status.ts';
	import { links } from '#lib/site/links.ts';
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Field from '#lib/ui/Field.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { railLeague } from '#lib/ui/rail-league.svelte.ts';
	import { ApiError, leagueApi, type AttachPreview, type AttachedLeague } from './api.ts';
	import { HOSTS_LINE, hostWords } from './model.ts';

	/** Attach a league: paste its link, say which team is yours (a tap on it, or a Sleeper username),
	 * one verb. The league is read as soon as the link is pasted, so the teams are there to tap. */

	/** How long the page waits after typing stops before it reads the link. */
	const READ_AFTER_MS = 400;

	type View = 'loading' | 'signed-out' | 'form' | 'unreachable';

	let view = $state<View>('loading');
	let link = $state('');
	let preview = $state<AttachPreview | null>(null);
	let reading = $state(false);
	let by = $state<'team' | 'username'>('team');
	let rosterId = $state<number | null>(null);
	let username = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let attached = $state<AttachedLeague[]>([]);
	let timer: ReturnType<typeof setTimeout> | null = null;
	/** The link a preview was asked for, so a late answer for an older link is dropped. */
	let asked = '';

	onMount(() => {
		leagueApi
			.attached()
			.then((list) => {
				attached = list;
				railLeague.note(list[0]?.id ?? null);
				view = 'form';
				const pasted = page.url.searchParams.get('link');
				if (pasted) typed(pasted);
			})
			.catch((error: unknown) => (view = isSignedOut(error) ? 'signed-out' : 'unreachable'));
		return () => {
			if (timer !== null) clearTimeout(timer);
		};
	});

	function failure(error: unknown): string {
		const fields = error instanceof ApiError ? Object.values(error.fields) : [];
		return (
			fields[0] ??
			(error instanceof ApiError ? error.message : 'That did not go through. Try again.')
		);
	}

	function typed(value: string): void {
		link = value;
		preview = null;
		rosterId = null;
		problem = null;
		if (timer !== null) clearTimeout(timer);
		if (value.trim() === '') return;
		timer = setTimeout(() => void read(value.trim()), READ_AFTER_MS);
	}

	async function read(value: string): Promise<void> {
		asked = value;
		reading = true;
		try {
			const answer = await leagueApi.preview(value);
			if (asked !== value) return;
			preview = answer;
			if (!answer.seat_by_username) by = 'team';
		} catch (error) {
			if (asked === value) problem = failure(error);
		} finally {
			if (asked === value) reading = false;
		}
	}

	const ready = $derived(
		preview !== null &&
			(by === 'team' ? rosterId !== null : username.trim() !== '') &&
			!busy &&
			!reading
	);

	async function follow(): Promise<void> {
		if (!ready || preview === null) return;
		busy = true;
		problem = null;
		try {
			const me = by === 'team' ? { roster_id: rosterId } : { username: username.trim() };
			const made = await leagueApi.attach({ host: preview.host, link: link.trim(), me });
			railLeague.note(made.id);
			await goto(resolve('/league/[id]', { id: made.id }));
		} catch (error) {
			problem = failure(error);
			busy = false;
		}
	}

	const attachedLines = $derived(
		attached.map((a) => ({
			key: a.id,
			lead: a.name || `Your ${hostWords(a.host)} league`,
			text: a.team_name ? `as ${a.team_name}, on ${hostWords(a.host)}` : `on ${hostWords(a.host)}`,
			href: links.league(a.id)
		}))
	);
</script>

<svelte:head>
	<title>Follow your league · Commish</title>
</svelte:head>

<Shell title="League" active="league">
	<main class="new">
		{#if view === 'loading'}
			<div class="reserve"></div>
		{:else if view === 'signed-out'}
			<EmptyState
				title="Sign in to follow your league"
				line="A league lives on your account. Following one is free."
			>
				{#snippet actions()}<Verb href={leagueApi.signInUrl(links.leagueNew())}>Sign in</Verb
					>{/snippet}
			</EmptyState>
		{:else if view === 'unreachable'}
			<EmptyState title="This page can't reach Commish right now" line="Reload in a moment." />
		{:else}
			<DisplayTitle size="page">Follow your league</DisplayTitle>
			<p class="lede">
				Paste your league's link. We keep your roster, this week's matchup and every player nobody
				in your league holds up to date, on our board. Free.
			</p>
			<p class="hosts">{HOSTS_LINE}</p>
			<div class="form">
				<Field
					label="Your league's link"
					value={link}
					oninput={typed}
					placeholder="sleeper.com/leagues/1234567890"
					maxlength={300}
					onenter={() => void follow()}
				/>
				{#if reading}
					<p class="lede" role="status">Reading your league.</p>
				{:else if preview}
					<div class="seat">
						<PanelHead
							title={preview.name || `Your ${hostWords(preview.host)} league`}
							aside={`${String(preview.teams.length)} teams on ${hostWords(preview.host)}`}
							level={2}
						/>
						{#if preview.seat_by_username}
							<ChipGroup label="Find your team by">
								<Chip pressed={by === 'team'} onclick={() => (by = 'team')}>From the list</Chip>
								<Chip pressed={by === 'username'} onclick={() => (by = 'username')}
									>My Sleeper username</Chip
								>
							</ChipGroup>
						{/if}
						{#if by === 'team'}
							<ChipGroup label="Your team" variant="loose">
								{#each preview.teams as team (team.roster_id)}
									<Chip
										pressed={rosterId === team.roster_id}
										onclick={() => (rosterId = team.roster_id)}
										label={team.owner ? `${team.name}, ${team.owner}` : team.name}>{team.name}</Chip
									>
								{/each}
							</ChipGroup>
						{:else}
							<Field
								label="Sleeper username"
								bind:value={username}
								maxlength={40}
								onenter={() => void follow()}
							/>
						{/if}
					</div>
				{/if}
			</div>
			<ActionBar alert={problem ? alert : undefined}>
				<Verb disabled={!ready} onclick={() => void follow()}>Follow my league</Verb>
			</ActionBar>
			{#if attached.length > 0}
				<section aria-label="Leagues you follow">
					<PanelHead title="Leagues you follow" level={2} />
					<LineList label="Leagues you follow" lines={attachedLines} />
				</section>
			{/if}
		{/if}
	</main>
</Shell>

{#snippet alert()}
	<p class="problem" role="alert">{problem}</p>
{/snippet}

<style>
	.new {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding: var(--s-5);
		max-width: 760px;
	}

	.lede,
	.hosts {
		margin: 0;
		color: var(--ink-2);
		max-width: 60ch;
	}

	.hosts {
		font-size: var(--t-sm);
	}

	.form,
	.seat {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.problem {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}

	.reserve {
		min-height: 60vh;
	}

	@media (max-width: 760px) {
		.new {
			padding: var(--s-4);
		}
	}
</style>
