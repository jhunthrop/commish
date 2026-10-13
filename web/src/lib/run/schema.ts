/**
 * The nightly run format: every artifact one run writes under `runs/<runId>/`, as the web build
 * reads it (spec §2.1 and §4). The research lane writes these files and the web build validates
 * every one against these schemas before a page renders, so a malformed run fails the build and the
 * previous deploy stays live.
 *
 *   manifest.json            the run: its id, its time, its season, its formats
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

export const runIdSchema = z.string().regex(RUN_ID, 'A run id reads like 2026-10-12T05.');
const formatId = z.string().regex(FORMAT_ID, 'A format id reads like ppr-12.');
const slug = z.string().regex(SLUG, 'A slug is lower case words joined by hyphens.');
const club = z.string().regex(CLUB, 'A club is its two or three letter code.');
const position = z.enum(POSITIONS);
const points = z.number();
const isoTime = z.iso.datetime({ offset: true });
const phrase = z.string().min(1);

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
	players: z.number().int().min(1)
});

export const boardRowSchema = z.object({
	id: z.string().min(1),
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
	id: z.string().min(1),
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
	/** Who publishes it, as the page names it. */
	name: phrase,
	/** The scoring and league size its drafts use: "PPR, 12 teams". */
	drafts: phrase,
	/** The formats whose boards blend this source. */
	formats: z.array(formatId).min(1),
	/** When the run read it, or null when the source does not date its numbers. */
	readAt: isoTime.nullable()
});

export const adpSchema = z.object({
	sources: z.array(adpSourceSchema).min(1),
	/** Each player's ADP per source id. A missing key is a source that does not have him. */
	players: z.record(z.string(), z.record(z.string(), points.positive()))
});

/** How well one order matched the finish: rank agreement and the typical miss in places. */
export const scoreSchema = z.object({
	/** Players this order had an opinion about, among those graded. */
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

export const recordWeekSchema = z.object({
	week: z.number().int().min(1),
	/** When our board was frozen for the week, before its first kickoff. */
	frozenAt: isoTime,
	/** When the week was graded, or null while it waits on its games. */
	gradedAt: isoTime.nullable(),
	/** Frozen players with a stat line for the week. */
	population: z.number().int().nonnegative(),
	lines: z.array(recordLineSchema)
});

export const recordSchema = z.object({
	season: z.number().int(),
	/** The format every frozen board ranks in. */
	format: formatId,
	/** The code that froze each week's board, and when it last changed, or null if it never has. */
	implementation: z.object({ current: phrase, since: isoTime.nullable() }),
	weeks: z.array(recordWeekSchema),
	/** Every graded week pooled, one line for all players and one per position. */
	toDate: z.array(recordLineSchema)
});

export const indexEntrySchema = z.object({
	id: z.string().min(1),
	slug,
	name: phrase,
	team: club,
	position
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
	/** The strength of this slate in the basis's unit. */
	strength: points,
	/** 1 is the hardest slate of the 32. */
	rank: z.number().int().min(1).max(32)
});

export const scheduleSchema = z.object({
	season: z.number().int(),
	/** What strength measures, as the page prints it under the number. */
	basis: phrase,
	/** The number each opponent contributes to the strength, keyed by club. */
	opponentValues: z.record(club, points),
	/** What one opponent value is, as a column head prints it. */
	opponentBasis: phrase,
	slates: z.array(slateSchema).length(32)
});

export type Format = z.infer<typeof formatSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
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
	player: (id: string) => `players/${id}.json`,
	adp: 'adp.json',
	record: 'record.json',
	index: 'index.json',
	clubs: 'clubs.json',
	schedule: 'schedule.json'
} as const;

/** The object a run's writer moves to point the site at its newest valid run. */
export const LATEST_POINTER = 'latest.json';
export const latestPointerSchema = z.object({ runId: runIdSchema });
