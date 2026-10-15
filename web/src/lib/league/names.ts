/** A league's names in words: its host as a mechanism, its own name, and its scoring. Apart from
 * model.ts so the shell's league switch, on every page, carries only these. */
import type { components } from '#lib/api/types.ts';

type Schemas = components['schemas'];
type LeagueHost = Schemas['LeagueHost'];
type ScoringPreset = Schemas['ScoringPreset'];

const HOST_WORDS: Readonly<Record<LeagueHost, string>> = {
	sleeper: 'Sleeper',
	mfl: 'MyFantasyLeague',
	ffpc: 'FFPC',
	yahoo: 'Yahoo',
	espn: 'ESPN'
};

/** The host as a sentence names it. */
export function hostWords(host: LeagueHost): string {
	return HOST_WORDS[host];
}

/** A followed league's own name, or its host's when the read has none yet. */
export function followedName(league: { name: string; host: LeagueHost }): string {
	return league.name !== '' ? league.name : `Your ${hostWords(league.host)} league`;
}

/** A league's scoring in a sentence, from its rules as the host states them (the nearest preset). */
export const SCORING_WORDS: Readonly<Record<ScoringPreset, string>> = {
	ppr: 'PPR',
	half_ppr: 'half PPR',
	standard: 'standard',
	te_premium: 'TE premium'
};
