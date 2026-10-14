<script lang="ts">
	import type { Snippet } from 'svelte';
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Field from '#lib/ui/Field.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { ApiError, ESPN_CONSENT, hostsApi, type HostLeague } from './api.ts';
	import { signInWithDisney } from './espn-oneid.ts';

	/** Connect ESPN: one verb opens Disney's own sign-in on this page, and the session it hands back is
	 * kept encrypted. The two values can be pasted from ESPN's site instead, the way in when Disney's
	 * sign-in does not hand them over. */
	interface Props {
		/** A line above the verb: why a connection is asked for again. */
		reason?: string;
		/** The verb's words: "Connect ESPN", "Connect ESPN again". */
		label?: string;
		/** The verb sits in the page's action bar: true where connecting is the page's one verb (the
		 * attach page), false where it sits among other rows (the account page). */
		bar?: boolean;
		onconnected: (leagues: HostLeague[]) => void;
	}

	let { reason, label = 'Connect ESPN', bar = false, onconnected }: Props = $props();

	let pasting = $state(false);
	let swid = $state('');
	let s2 = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);

	function failure(error: unknown): string {
		const fields = error instanceof ApiError ? Object.values(error.fields) : [];
		return (
			fields[0] ??
			(error instanceof ApiError ? error.message : 'That did not go through. Try again.')
		);
	}

	async function keep(session: { swid: string; s2: string }): Promise<void> {
		const answer = await hostsApi.connectESPN(session.swid, session.s2);
		onconnected(answer.leagues);
	}

	/** Disney's sign-in in its own window. Closing it makes the verb ready again at once; a sign-in
	 * that hands back no session, or a window that cannot open, says so and opens the paste form. */
	async function viaDisney(): Promise<void> {
		// The window opens first, inside the tap, before anything is awaited.
		const signingIn = signInWithDisney();
		busy = true;
		problem = null;
		try {
			const outcome = await signingIn;
			switch (outcome.kind) {
				case 'session':
					await keep(outcome.session);
					break;
				case 'no-session':
					problem =
						'ESPN signed you in but did not hand us your session. Paste the two values below instead.';
					pasting = true;
					break;
				case 'failed':
					problem = "ESPN's sign-in did not open here. Paste the two values below instead.";
					pasting = true;
					break;
				case 'closed':
					break;
			}
		} catch (error) {
			problem = failure(error);
		} finally {
			busy = false;
		}
	}

	async function viaPaste(): Promise<void> {
		if (busy || swid.trim() === '' || s2.trim() === '') return;
		busy = true;
		problem = null;
		const typed = s2.trim();
		s2 = '';
		try {
			await keep({ swid: swid.trim(), s2: typed });
		} catch (error) {
			problem = failure(error);
		} finally {
			busy = false;
		}
	}
</script>

<div class="connect">
	{#if reason}<p class="reason">{reason}</p>{/if}
	<p class="note">{ESPN_CONSENT}</p>
	{#if !pasting}
		{@render act(disneyVerb)}
		<div>
			<Quiet size="sm" onclick={() => (pasting = true)}>Paste the two values instead</Quiet>
		</div>
	{:else}
		<ol class="steps">
			<li>Sign in on espn.com in this browser.</li>
			<li>Open the browser's developer tools, then Application, then Cookies, then espn.com.</li>
			<li>Copy the value of SWID and the value of espn_s2 into the two boxes here.</li>
		</ol>
		<Field label="SWID" bind:value={swid} maxlength={40} placeholder={'{XXXXXXXX-XXXX-...}'} />
		<Field label="espn_s2" bind:value={s2} maxlength={600} onenter={() => void viaPaste()} />
		{@render act(pasteVerb)}
	{/if}
</div>

{#snippet act(verb: Snippet)}
	{#if bar}
		<ActionBar alert={problem ? alert : undefined}>{@render verb()}</ActionBar>
	{:else}
		<div class="act">{@render verb()}</div>
		{#if problem}{@render alert()}{/if}
	{/if}
{/snippet}

{#snippet disneyVerb()}
	<Verb disabled={busy} onclick={() => void viaDisney()}>{busy ? 'Signing in on ESPN' : label}</Verb
	>
{/snippet}

{#snippet pasteVerb()}
	<Verb disabled={busy || swid.trim() === '' || s2.trim() === ''} onclick={() => void viaPaste()}
		>{busy ? 'Checking with ESPN' : label}</Verb
	>
{/snippet}

{#snippet alert()}
	<ProblemLine>{problem}</ProblemLine>
{/snippet}

<style>
	.connect {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.reason,
	.note,
	.steps {
		margin: 0;
		max-width: 60ch;
	}

	.note,
	.steps {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.steps {
		padding-left: var(--s-4);
	}

	.act {
		display: flex;
		margin-top: var(--s-1);
	}
</style>
