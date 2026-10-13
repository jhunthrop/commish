/**
 * The nightly run format: every artifact one run writes under `runs/<runId>/`, as the web build
 * reads it (spec §2.1 and §4). The research lane writes these files and the web build validates
 * every one against these schemas before a page renders, so a malformed run fails the build and the
 * previous deploy stays live.
 *
 *   manifest.json            the run: its id, its time, its season, its formats, and the sources
 *                            block naming each feed's vendor and window (provenance, never shown)
 *   boards/<format>.json     one board per format, every player it ranks
 *   players/<id>.json        one page per player: every format's numbers and the capsule
 *   adp.json                 every ADP source, named, with its value per player
 *   record.json              our projections against the season so far, against ADP
 *   index.json               the search index: id, slug, name, team, position
 *   clubs.json               the 32 clubs with their names and bye weeks
 *   schedule.json            every club's slate and the strength of it, with its basis
 *
 * Types are inferred from the schemas, so client code imports them as types only and never ships zod.
 */
import { z } from 'zod';
import { POSITIONS } from '#lib/types/player.ts';

const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}(-[a-z0-9-]+)?$/;
const FORMAT_ID = /^[a-z0-9]+(-[a-z0-9]+)*-[0-9]{1,2}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CLUB = /^[A-Z]{2,3}$/;
/** A player id becomes a file name and a URL segment, so it is word characters and hyphens only. */
export const PLAYER_ID = /^[\w-]+$/;

export const runIdSchema = z.string().regex(RUN_ID, 'A run id reads like 2026-10-12T05.');
const formatId = z.string().regex(FORMAT_ID, 'A format id reads like ppr-12.');
const slug = z.string().regex(SLUG, 'A slug is lower case words joined by hyphens.');
const club = z.string().regex(CLUB, 'A club is its two or three letter code.');
const position = z.enum(POSITIONS);
const points = z.number();
const isoTime = z.iso.datetime({ offset: true });
const phrase = z.string().min(1);
const playerId = z.string().regex(PLAYER_ID, 'A player id is word characters and hyphens.');

/** The first and last moments a feed's numbers were captured, read from the data's own stamps. */
export const windowSchema = z
	.object({ from: isoTime, to: isoTime })
	.refine((window) => window.from <= window.to, 'A window ends after it starts.');

/** Where one artifact's numbers came from. Provenance for us, never printed on a screen. */
export const sourceSchema = z.object({
	/** The artifact it feeds: "adp", "schedule". */
	artifact: phrase,
	/** Who publishes the numbers. */
	vendor: phrase,
	/** The feed's id in our store. */
	feed: phrase,
	window: windowSchema
});

export const formatSchema = z.object({
	id: formatId,
	/** As a chip prints it: "PPR", "Half PPR". */
	label: phrase,
	/** What the points are in, as a cell label prints it: "PPR pts". */
	unit: phrase,
	teams: z.number().int().min(2),
	/** The basis of every number on this format's board, phrase by phrase, as the board's lead prints them. */
	basis: z.array(phrase).min(1)
});

export const manifestSchema = z.object({
	runId: runIdSchema,
	/** When the run finished, the date every nightly page prints in its top bar. */
	runAt: isoTime,
	season: z.number().int(),
	/** The code that produced the run, so the record can state when it switched. */
	implementation: phrase,
	/** True for the stand-in built from the approved mocks' data, replaced by the first real run. */
	standIn: z.boolean(),
	/** Every format the run carries, the default first. */
	formats: z.array(formatSchema).min(1),
	/** Every player with a page, matching index.json. */
	players: z.number().int().min(1),
	/** Each feed's vendor and window. Provenance, never printed on a screen. */
	sources: z.array(sourceSchema).min(1)
});

export const boardRowSchema = z.object({
	id: playerId,
	slug,
	name: phrase,
	position,
	positionRank: z.number().int().min(1),
	team: club,
	headshot: z.url(),
	/** Our rank on this board, by points over replacement. */
	ourRank: z.number().int().min(1),
	/** The round of this format's draft his points over replacement rank in. */
	vorRound: z.number().int().min(1),
	/** The blended ADP of this format's named sources, or null when no source has him. */
	adp: points.positive().nullable(),
	projected: points,
	vor: points,
	expectedGames: points.nonnegative(),
	floor: points,
	median: points,
	ceiling: points,
	/** Tier within his position, 1 is the top. */
	tier: z.number().int().min(1)
});

export const boardSchema = z.object({
	format: formatId,
	rows: z.array(boardRowSchema).min(1)
});

export const pullFigureSchema = z.object({
	/** A number exactly as the capsule writes it. */
	figure: phrase,
	/** What it counts, in a few words. */
	caption: phrase
});

export const capsuleSchema = z
	.object({
		/** Paragraphs separated by a blank line. */
		body: phrase,
		pulls: z.array(pullFigureSchema)
	})
	.superRefine((capsule, ctx) => {
		for (const pull of capsule.pulls) {
			if (!capsule.body.includes(pull.figure)) {
				ctx.addIssue({
					code: 'custom',
					message: `The pull figure "${pull.figure}" is not in the capsule's prose.`
				});
			}
		}
	});

/** One format's numbers for one player: his board row without the identity. */
export const playerFormatSchema = boardRowSchema.omit({
	id: true,
	slug: true,
	name: true,
	position: true,
	team: true,
	headshot: true
});

export const playerSchema = z.object({
	id: playerId,
	slug,
	name: phrase,
	position,
	team: club,
	headshot: z.url(),
	/** Keyed by format id, every format the run carries that ranks him. */
	formats: z.record(formatId, playerFormatSchema),
	capsule: capsuleSchema.nullable()
});

export const adpSourceSchema = z.object({
	id: z.string().min(1),
	/** The drafts behind the numbers, in a drafter's words: "PPR drafts". The vendor is provenance
	 * in the manifest, never on a screen. */
	drafts: phrase,
	/** The formats whose boards blend this source. */
	formats: z.array(formatId).min(1),
	/** The first and last capture the ADP averages, from the captures' own stamps. */
	window: windowSchema
});

export const adpSchema = z.object({
	sources: z.array(adpSourceSchema).min(1),
	/** Each player's ADP per source id. A missing key is a source that does not have him. */
	players: z.record(z.string(), z.record(z.string(), points.positive()))
});

/** How well one order matched the finish: rank agreement and the typical miss in places. */
export const scoreSchema = z.object({
	/** n: players this order had an opinion about, among those graded. */
	graded: z.number().int().nonnegative(),
	/** Spearman rank correlation with the finish, or null when the sample cannot support one. */
	agreement: z.number().min(-1).max(1).nullable(),
	/** Mean distance in places between this order and the finish, or null with no sample. */
	placesOff: z.number().nonnegative().nullable()
});

export const recordLineSchema = z.object({
	position: z.union([position, z.literal('All')]),
	ours: scoreSchema,
	adp: scoreSchema
});

/** Where a week of the season stands in the record. Every week of the season is listed, so a week
 * the run failed to freeze shows as a hole rather than going missing.
 *   graded    frozen before its first kickoff and graded against the games
 *   frozen    frozen before its first kickoff, waiting on the week's stat lines
 *   missed    its first kickoff passed with no board frozen, the reason in the note
 *   upcoming  its first kickoff is still ahead */
export const RECORD_WEEK_STATUSES = ['graded', 'frozen', 'missed', 'upcoming'] as const;
export const recordWeekStatus = z.enum(RECORD_WEEK_STATUSES);

export const recordWeekSchema = z
	.object({
		week: z.number().int().min(1),
		status: recordWeekStatus,
		/** When our board was frozen for the week, before its first kickoff. For an upcoming week, the
		 * day it is set to freeze, or null when no date is set yet. Null for a missed week. */
		frozenAt: isoTime.nullable(),
		/** The run whose board was frozen, by its run id. Null unless the week froze. */
		frozenBy: runIdSchema.nullable(),
		/** When the week was graded. Null unless the status is graded. */
		gradedAt: isoTime.nullable(),
		/** Frozen players with a stat line for the week. */
		population: z.number().int().nonnegative(),
		lines: z.array(recordLineSchema),
		/** Why a missed week was not frozen, one sentence the page prints: "Our nightly run failed that
		 * week." Present only for a missed week. */
		note: phrase.optional()
	})
	.superRefine((week, ctx) => {
		const froze = week.status === 'graded' || week.status === 'frozen';
		const fail = (message: string): void => {
			ctx.addIssue({
				code: 'custom',
				message: `Week ${String(week.week)} is ${week.status}: ${message}`
			});
		};
		if (froze && (week.frozenAt === null || week.frozenBy === null))
			fail('a frozen week names when it froze and the run that froze it.');
		if (!froze && week.frozenBy !== null) fail('only a frozen week names the run that froze it.');
		if (week.status === 'missed' && week.frozenAt !== null) fail('a missed week never froze.');
		if ((week.status === 'graded') !== (week.gradedAt !== null))
			fail('a week carries a grading time exactly when it is graded.');
		if ((week.status === 'missed') !== (week.note !== undefined))
			fail('a week carries a note exactly when it was missed.');
		if (!froze && (week.population !== 0 || week.lines.length > 0))
			fail('only a frozen week has players and lines.');
	});

export const recordSchema = z.object({
	season: z.number().int(),
	/** The format every frozen board ranks in. */
	format: formatId,
	/** The statistics the record grades with, in words a drafter says with no gloss: the rank
	 * agreement as "agreement with the finish", the typical miss as "places off, typical player".
	 * The page prints them as the big number's caption and the column heads. */
	statistic: z.object({ agreement: phrase, placesOff: phrase }),
	/** How the record is kept, as one sentence the page prints under the weeks. */
	method: phrase,
	/** Every week of the season in order, whatever its status. */
	weeks: z.array(recordWeekSchema),
	/** Every graded week pooled, one line for all players and one per position. */
	toDate: z.array(recordLineSchema)
});

export const indexEntrySchema = z.object({
	id: playerId,
	slug,
	name: phrase,
	team: club,
	position,
	/** His face, so a search hit leads with it like every other list. */
	headshot: z.url()
});

export const indexSchema = z.array(indexEntrySchema).min(1);

export const clubSchema = z.object({
	abbr: club,
	city: phrase,
	nickname: phrase,
	/** The week the club does not play, or null before the schedule is out. */
	bye: z.number().int().min(1).nullable()
});

export const clubsSchema = z.array(clubSchema).length(32);

export const gameSchema = z.object({
	week: z.number().int().min(1),
	opponent: club,
	home: z.boolean()
});

export const slateSchema = z.object({
	abbr: club,
	games: z.array(gameSchema).min(1),
	/** The strength of this slate in the method's unit. */
	strength: points,
	/** 1 is the hardest slate of the 32. */
	rank: z.number().int().min(1).max(32),
	/** How strength is measured, as the page prints it beside the number. */
	method: phrase,
	/** When the inputs were read, from their own stamps. */
	window: windowSchema
});

export const scheduleSchema = z
	.object({
		season: z.number().int(),
		/** The number each opponent contributes to the strength, keyed by club. */
		opponentValues: z.record(club, points),
		/** What one opponent value is, as a column head prints it. */
		opponentBasis: phrase,
		/** A slate's strength as a short caption under its number: "opponents' average win total". */
		unit: phrase,
		slates: z.array(slateSchema).length(32)
	})
	.superRefine((schedule, ctx) => {
		for (const slate of schedule.slates) {
			for (const game of slate.games) {
				if (schedule.opponentValues[game.opponent] === undefined) {
					ctx.addIssue({
						code: 'custom',
						message: `${slate.abbr} plays ${game.opponent}, who has no value.`
					});
				}
			}
		}
	});

export type Format = z.infer<typeof formatSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Window = z.infer<typeof windowSchema>;
export type BoardRow = z.infer<typeof boardRowSchema>;
export type Board = z.infer<typeof boardSchema>;
export type PullFigure = z.infer<typeof pullFigureSchema>;
export type Capsule = z.infer<typeof capsuleSchema>;
export type PlayerFormat = z.infer<typeof playerFormatSchema>;
export type Player = z.infer<typeof playerSchema>;
export type AdpSource = z.infer<typeof adpSourceSchema>;
export type Adp = z.infer<typeof adpSchema>;
export type Score = z.infer<typeof scoreSchema>;
export type RecordLine = z.infer<typeof recordLineSchema>;
export type RecordWeek = z.infer<typeof recordWeekSchema>;
export type RecordWeekStatus = z.infer<typeof recordWeekStatus>;
export type RunRecord = z.infer<typeof recordSchema>;
export type IndexEntry = z.infer<typeof indexEntrySchema>;
export type Club = z.infer<typeof clubSchema>;
export type Game = z.infer<typeof gameSchema>;
export type Slate = z.infer<typeof slateSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;

/** Where each artifact sits inside a run's folder. */
export const RUN_PATHS = {
	manifest: 'manifest.json',
	board: (format: string) => `boards/${format}.json`,
	player: (id: string) => {
		if (!PLAYER_ID.test(id)) throw new Error(`"${id}" is not a player id.`);
		return `players/${id}.json`;
	},
	adp: 'adp.json',
	record: 'record.json',
	index: 'index.json',
	clubs: 'clubs.json',
	schedule: 'schedule.json'
} as const;

/** The object a run's writer moves to point the site at its newest valid run. */
export const LATEST_POINTER = 'latest.json';
export const latestPointerSchema = z.object({ runId: runIdSchema });
