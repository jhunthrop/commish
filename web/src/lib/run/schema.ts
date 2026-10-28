/**
 * The nightly run format: every artifact one run writes under `runs/<runId>/`, as the web build
 * reads it (spec §2.1 and §4). The research lane writes these files and the web build validates
 * every one against these schemas before a page renders, so a malformed run fails the build and the
 * previous deploy stays live.
 *
 *   manifest.json            the run: its id, its time, its season, its formats, and the sources
 *                            block naming each feed's vendor and window (provenance, never shown)
 *   boards/<format>.json     one board per format, every player it ranks
 *   players/<id>.json        one page per player: every format's numbers, the capsule, and his
 *                            season so far (season.ts)
 *   adp.json                 every ADP source, named, with its value per player
 *   record.json              our projections against the season so far, against ADP
 *   index.json               the search index: id, slug, name, team, position
 *   clubs.json               the 32 clubs with their names and bye weeks
 *   schedule.json            every club's slate and the strength of it, with its basis
 *   designations.json        each ranked player the newest hourly injury capture lists, written
 *                            beside the run every publish hour (optional: a run without it renders
 *                            no status)
 *
 * Types are inferred from the schemas, so client code imports them as types only and never ships zod.
 */
import { z } from 'zod';
import type { components } from '#lib/api/types.ts';
import { POSITIONS } from '#lib/types/player.ts';
import { MARKET_POSITIONS } from './market.ts';
import { club, formatId } from './primitives.ts';
import { seasonSchema, priorSeasonSchema } from './season.ts';

const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}(-[a-z0-9-]+)?$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A player id becomes a file name and a URL segment, so it is word characters and hyphens only. */
export const PLAYER_ID = /^[\w-]+$/;

export const runIdSchema = z.string().regex(RUN_ID, 'A run id reads like 2026-10-12T05.');
const slug = z.string().regex(SLUG, 'A slug is lower case words joined by hyphens.');
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
	basis: z.array(phrase).min(1),
	/** In season, once the board ranks the rest of the season: the first week it ranks. Absent preseason. */
	rosFromWeek: z.number().int().min(1).optional(),
	/** In season, set while a game of rosFromWeek had kicked off at the run (Lane 86): its clubs count
	 * from their next week, and the words say the board counts that week's games left. Absent
	 * preseason and on a run older than the field. */
	rosFromWeekPartial: z.boolean().optional(),
	/** In season, the last week whose games are in the season figures. */
	rosThroughWeek: z.number().int().min(0).optional(),
	/** In season, when the run refreshed the rest-of-season board. */
	refreshedAt: isoTime.optional(),
	/** The ADP source (adp.json) whose draft order the board's kickers and defenses take. Absent on a
	 * run older than the rows. */
	marketOrder: z.string().min(1).optional()
});

/** A reach's partial week: its number and the days of its counted games in kickoff order on the
 * Eastern clock, none when a counted club's game is not on the schedule ("part of week 6"). */
export const reachPartialSchema = z.object({
	week: z.number().int().min(1),
	days: z.array(phrase)
});

/** The run's season reach (Lane 205): what every basis's "through week" says, counted over the run's
 * own pages by the web's reader (run/reach.ts runReach) at the nightly's schema gate and written into
 * the manifest once, so the build and the API read it rather than count it again. */
export const reachSchema = z.object({
	/** The format every season block is scored in: "ppr-12". */
	format: formatId,
	/** That format as a chip prints it: "PPR". */
	scoring: phrase,
	/** "through week 5", "through week 5 and week 6's Thursday game"; empty before week 1's games. */
	through: z.string(),
	/** The last week whose games are all in, 0 before week 1's. */
	complete: z.number().int().min(0),
	/** The week after it with some counted games in, null with none. */
	partial: reachPartialSchema.nullable()
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
	sources: z.array(sourceSchema).min(1),
	/** The season reach the nightly wrote (Lane 205); absent on the manifest its schema gate reads and
	 * on every run from before, where the reader counts it (server/run.ts runSeasonReach). */
	reach: reachSchema.optional()
});

export const boardRowSchema = z.object({
	id: playerId,
	slug,
	name: phrase,
	position,
	positionRank: z.number().int().min(1),
	team: club,
	headshot: z.url(),
	/** Ranked by our projection. Absent on a run older than the kickers' and defenses' rows. */
	orderBasis: z.literal('projection').optional(),
	/** Our rank on this board, by points over replacement. */
	ourRank: z.number().int().min(1),
	/** The round of this format's draft his points over replacement rank in. */
	vorRound: z.number().int().min(1),
	/** The blended ADP of this format's named sources, or null when no source has him. */
	adp: points.positive().nullable(),
	/** Drafters' ADP less our rank, the board's Gap, written by the run to a tenth (Lane 66n): plus
	 * when drafters take him later than we rank him; null without an ADP. Absent on a run older than
	 * the column, which then prints no gap: the web never works it out. */
	gap: points.nullable().optional(),
	projected: points,
	vor: points,
	expectedGames: points.nonnegative(),
	/** Null in season: the rest-of-season board gives no range. */
	floor: points.nullable(),
	median: points.nullable(),
	ceiling: points.nullable(),
	/** Tier within his position, 1 is the top. */
	tier: z.number().int().min(1),
	/** His tier's drop to the next tier at his position (Lane 66q): the tier's last player's projected
	 * points less the next tier's first, written by the run to a tenth; null in his position's last
	 * tier. Absent on a run older than the column, which then prints no drop: the web never works it
	 * out. */
	tierDrop: points.nullable().optional(),
	/** In season, where the preseason board ranked him, and its points for the full season; null
	 * for a player with a line this season whom the preseason board did not rank. */
	preseasonRank: z.number().int().min(1).nullable().optional(),
	preseasonPoints: points.nullable().optional(),
	/** In season, the preseason pace a game the rest-of-season model starts his figure from, in this
	 * format's scoring (Lane 100): null for a player the preseason board did not rank, absent on a run
	 * older than the field. */
	preseasonPerGame: points.nullable().optional(),
	/** In season, the share of his rate a game that pace carries, a whole percent (Lane 139, C08): null
	 * with the pace, absent on a run older than the field. */
	preseasonShare: z.number().int().min(0).max(100).nullable().optional(),
	/** In season, the steps from his Avg to our rate the card names (Lane 139 fix round 1): his season
	 * blended with his usage a game (null before a game or without the pace), and the model's rate a
	 * game he plays, before the games he may miss. Absent on a run older than the fields. */
	blendedPerGame: points.nullable().optional(),
	ratePerGame: points.nullable().optional(),
	/** In season, the week his rest of season starts from: his club's first game still to play at the
	 * run (Lane 86), null with none left. Absent preseason and on a run older than the field, where the
	 * format's rosFromWeek stands. */
	restFromWeek: z.number().int().min(1).nullable().optional(),
	/** In season, his points for one more game of his club (Lane 96, the published board's game
	 * points): null preseason, absent on a run older than the field. */
	gamePoints: points.nullable().optional()
});

/** A kicker or a defense on a board (the 2026-09-05 ruling): after the ranked rows, in the drafters'
 * order, with no projected points and no tier. His position rank is his place in that order. */
export const marketRowSchema = z.object({
	id: playerId,
	slug,
	name: phrase,
	position: z.enum(MARKET_POSITIONS),
	positionRank: z.number().int().min(1),
	team: club,
	/** Null for a defense (its face is its club's mark) and a kicker the provider has no face for. */
	headshot: z.url().nullable(),
	orderBasis: z.literal('market'),
	/** His place on the whole board, after every ranked row. */
	ourRank: z.number().int().min(1),
	/** This format's ADP: a kicker or a defense its drafts do not take is not on the board (the
	 * September ruling). */
	adp: points.positive(),
	/** A kicker or a defense has no rank of ours to set the drafts against. */
	gap: z.null().optional(),
	vorRound: z.null(),
	projected: z.null(),
	vor: z.null(),
	expectedGames: z.null(),
	floor: z.null(),
	median: z.null(),
	ceiling: z.null(),
	tier: z.null(),
	tierDrop: z.null().optional()
});

export const boardSchema = z.object({
	format: formatId,
	rows: z.array(z.union([marketRowSchema, boardRowSchema])).min(1)
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
		pulls: z.array(pullFigureSchema),
		/** When the writer wrote it, which the page stamps the read with; absent on a run from before
		 * the nightly wrote it. */
		writtenAt: isoTime.optional()
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
	headshot: true,
	orderBasis: true
});

/** The week-ahead read (Lane 72): the week it is for; its text, null when his status changed since it
 * was written (the read is withheld and the caption says when the new one is due); its caption
 * ("Written Fri 9:00 pm Central, for week 6"); the status it was written against; the writer's call,
 * null when withheld; when it was written and the newest stamp of the facts it was written from. Lane
 * 66v: the published projection it quotes, in PPR as the card prints it (null when it had none), and the
 * words the page shows once the card's live read prints another; both absent on a run from before. */
export const weekReadSchema = z.object({
	week: z.number().int().min(1),
	body: phrase.nullable(),
	caption: phrase,
	status: z.string().nullable(),
	call: z.enum(['start', 'sit', 'hold', 'none']).nullable(),
	writtenAt: isoTime,
	factsAt: isoTime.nullable(),
	projection: z.number().nullable().optional(),
	movedCaption: phrase.optional()
});

export type WeekRead = z.infer<typeof weekReadSchema>;

/** While the coming week's reads are not written (Lane 256, the roll-over writes every board player's
 * in one pass), the week and the night they are written ("Tuesday"), on a page that serves no read. */
export const readsDueSchema = z.object({
	week: z.number().int().min(1),
	night: z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
});

export type ReadsDue = z.infer<typeof readsDueSchema>;

export const playerSchema = z.object({
	id: playerId,
	slug,
	name: phrase,
	position,
	team: club,
	headshot: z.url(),
	/** Keyed by format id, every format the run carries that ranks him. */
	formats: z.record(formatId, playerFormatSchema),
	capsule: capsuleSchema.nullable(),
	/** The week-ahead read (Lane 72): absent on a run from before the nightly wrote it, null for a
	 * player the writer did not write for the week ahead. */
	weekRead: weekReadSchema.nullable().optional(),
	/** The night the coming week's reads are written (Lane 256): null once they are or while a read is
	 * served; absent on a run from before. */
	weekReadsDue: readsDueSchema.nullable().optional(),
	/** His season so far: the season line and every week's game log, scored in one format. */
	season: seasonSchema,
	/** His earlier seasons, newest first, in the season block's format (Lane 66h); absent on a run
	 * from before the nightly wrote them. */
	priorSeasons: z.array(priorSeasonSchema).optional(),
	/** The club his newest game line was for and its week, when it is not `team` (Lane 120): the
	 * provider's list read after that game moved him. Null when it is his club; absent on a run from
	 * before the nightly wrote it. `specialTeams` (Lane 144): that week he was on the field for special
	 * teams alone, the writer's one fact (page_club.py `special_teams_week`); absent otherwise and on a run
	 * from before it. */
	lastGameClub: z
		.object({
			club,
			week: z.number().int().min(1),
			specialTeams: z.literal(true).optional()
		})
		.nullable()
		.optional()
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
	placesOff: z.number().nonnegative().nullable(),
	/** The week's top players at each position (a 12-team league's starters) this order also put
	 * there, of how many (Lane 66j). */
	starters: z.number().int().nonnegative(),
	startersOf: z.number().int().nonnegative()
});

export const recordLineSchema = z.object({
	position: z.union([position, z.literal('All')]),
	ours: scoreSchema,
	/** ADP on the same players; null on the weekly record (Lane 114), where ADP is no yardstick. */
	adp: scoreSchema.nullable(),
	/** The week's published projection on the same players where the freeze kept it (from
	 * publishedFromWeek), null before it did. */
	published: scoreSchema.nullable(),
	/** The season to date only: ours over the weeks that graded the published projection, printed
	 * beside it so the two compare like with like (review 66j N1); null on a week's line. */
	oursOnPublished: scoreSchema.nullable(),
	/** ESPN's own weekly projection on the same players where the freeze kept it (the weekly record,
	 * Lane 114), null before it did and on every line before Lane 114. */
	espn: scoreSchema.nullable().default(null),
	/** The season to date only: ours over the weeks that graded ESPN's projection, beside it. */
	oursOnEspn: scoreSchema.nullable().default(null)
});

/** One graded player of a week as the record counts a league's own starters from (Lane 93). */
const place = z.number().int().min(1);
export const placedPlayerSchema = z.object({
	position,
	ours: place.nullable(),
	adp: place.nullable(),
	published: place.nullable(),
	/** ESPN's place (the weekly record, Lane 114), null where it has no stance and before Lane 114. */
	espn: place.nullable().default(null),
	finish: place
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
		/** When our board was frozen for the week, before its first kickoff. For an upcoming week, its
		 * first kickoff, the day it freezes by (the page prints only the day), or null when no date is
		 * set yet. Null for a missed week. */
		frozenAt: isoTime.nullable(),
		/** The run whose board was frozen, by its run id. Null unless the week froze. */
		frozenBy: runIdSchema.nullable(),
		/** When the week was graded. Null unless the status is graded. */
		gradedAt: isoTime.nullable(),
		/** The order the week's freeze graded (review 66j M7); null for a week with no freeze. */
		order: z.enum(['preseason', 'rest_of_season']).nullable(),
		/** Frozen players with a stat line for the week. */
		population: z.number().int().nonnegative(),
		lines: z.array(recordLineSchema),
		/** Why a missed week was not frozen, one sentence the page prints: "Our nightly run failed that
		 * week." Present only for a missed week. */
		note: phrase.optional(),
		/** When the graded order was last refreshed before the week was set (Lane 93): the preseason
		 * board's stamp, or the rest-of-season order's refresh. Absent on a run before Lane 93. */
		orderAsOf: isoTime.optional(),
		/** A frozen week waiting on its stats: the earliest instant the weekly pass grades it. */
		gradesFrom: isoTime.optional(),
		/** A graded week's players, for counting the starters a league's own lineup calls right (Lane
		 * 93): each order's place among the week's graded players (null where it has no stance on him)
		 * and his place in the finish, in the finish's order. Absent before Lane 93. */
		players: z.array(placedPlayerSchema).optional(),
		/** When ESPN's projection for the week was read after our weekly rankings were set, or not read
		 * before its first kickoff: one sentence the weekly record prints as written under the week's
		 * row (Lane 146, Amendment 6). Absent on a week with nothing to say and on every run before
		 * Lane 146. */
		espnNote: phrase.optional()
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
		if (froze !== (week.order !== null)) fail('a week names its order exactly when it froze.');
		if (!froze && (week.population !== 0 || week.lines.length > 0))
			fail('only a frozen week has players and lines.');
	});

/** The record's own fields both records share: the words its measures print in, and its weeks. */
const recordWords = {
	/** The statistics the record grades with, in words a drafter says with no gloss (Lane 66j): the
	 * rank agreement as "order matched", the typical miss as "places off", the starters called right.
	 * The page prints them as its column heads. */
	statistic: z.object({ agreement: phrase, placesOff: phrase, starters: phrase }),
	/** The agreement's scale, said once: "1.00 is a perfect match of the week's finishing order, 0.00 is none." */
	scale: phrase,
	/** What the starters figure counts, from the positions graded, said once; null before a week is graded. */
	startersBasis: phrase.nullable(),
	/** How the record is kept, as one sentence the page prints under the weeks. */
	method: phrase,
	/** The sentence the page prints when a yardstick called the graded weeks better than our order on
	 * any figure, null when ours leads or ties on every one. */
	honest: phrase.nullable()
};

/** The weekly record (Lane 114): our weekly rankings against the weekly experts, from the first week
 * the order the site ships was set, in the record's own shape (lines carry ADP null). */
export const weeklyRecordSchema = z.object({
	/** The first week of weekly rankings: the first set with the shipped order, else the next to set. */
	fromWeek: z.number().int().min(1),
	...recordWords,
	/** Every week from fromWeek to the end of the regular season, whatever its status. */
	weeks: z.array(recordWeekSchema),
	toDate: z.array(recordLineSchema)
});

/** One line of the draft record: a position (or All), ours and ADP on the same finishers. */
export const draftLineSchema = z.object({
	position: z.union([position, z.literal('All')]),
	ours: scoreSchema,
	adp: scoreSchema
});

/** The draft record (Lane 114): our draft board against ADP on the season's points so far. */
export const draftRecordSchema = z.object({
	/** When the board drafted from was set, before the season's first kickoff. */
	setAt: isoTime,
	/** The board's own stamp, when it was projected. */
	boardAsOf: isoTime,
	/** The last complete week counted, null before the first. */
	throughWeek: z.number().int().min(1).nullable(),
	/** What "top named" counts, said once; null before a week is counted. */
	namedBasis: phrase.nullable(),
	/** The sentence the page prints when ADP called the season so far better on any figure. */
	honest: phrase.nullable(),
	/** All first, then each position graded. */
	lines: z.array(draftLineSchema),
	/** Order matched, All positions, on the season's points through each counted week. */
	progress: z.array(
		z.object({
			week: z.number().int().min(1),
			ours: z.number().min(-1).max(1).nullable(),
			adp: z.number().min(-1).max(1).nullable()
		})
	)
});

export const recordSchema = z.object({
	season: z.number().int(),
	/** The format every frozen board ranks in. */
	format: formatId,
	/** The statistics the record grades with, in words a drafter says with no gloss (Lane 66j): the
	 * rank agreement as "order matched", the typical miss as "places off", the starters called right.
	 * The page prints them as its column heads. */
	statistic: z.object({ agreement: phrase, placesOff: phrase, starters: phrase }),
	/** The agreement's scale, said once: "1.00 is a perfect match of the week's finishing order, 0.00 is none." */
	scale: phrase,
	/** What the starters figure counts, from the positions graded, said once; null before a week is graded. */
	startersBasis: phrase.nullable(),
	/** How the record is kept, as one sentence the page prints under the weeks. */
	method: phrase,
	/** The first week whose freeze keeps the published projection, read from the register; null
	 * while none does. */
	publishedFromWeek: z.number().int().min(1).nullable(),
	/** The sentence the page prints when ADP or the published projection called the graded weeks
	 * better than our order on any figure, null when ours leads or ties on every one. */
	honest: phrase.nullable(),
	/** Every week of the season in order, whatever its status. */
	weeks: z.array(recordWeekSchema),
	/** Every graded week pooled, one line for all players and one per position. */
	toDate: z.array(recordLineSchema),
	/** The two records (Lane 114), each named by what it grades; absent on a run before Lane 114. */
	weekly: weeklyRecordSchema.optional(),
	draft: draftRecordSchema.optional()
});

/** His season so far in two numbers, as his file's season block has them (players/<id>.json, scored
 * in the same format): the games he has played and his points a game, null before his first game.
 * The league page prints them beside each player's projection. */
export const indexSeasonSchema = z
	.object({
		games: z.number().int().nonnegative(),
		pointsPerGame: z.number().nullable()
	})
	.refine(
		(season) => (season.games === 0) === (season.pointsPerGame === null),
		'Points a game are null exactly when he has no game.'
	);

export const indexEntrySchema = z.object({
	id: playerId,
	slug,
	name: phrase,
	team: club,
	position,
	/** His face, so a search hit leads with it like every other list. */
	headshot: z.url(),
	/** A player with a page, ranked by our projection. Absent on a run older than the kickers' and
	 * defenses' entries. */
	orderBasis: z.literal('projection').optional(),
	season: indexSeasonSchema
});

/** A kicker or a defense the boards carry in draft order: in the index, so every board row and every
 * status is one it names, but with no page and no season figures. */
export const marketEntrySchema = z.object({
	id: playerId,
	slug,
	name: phrase,
	team: club,
	position: z.enum(MARKET_POSITIONS),
	headshot: z.url().nullable(),
	orderBasis: z.literal('market')
});

export const indexSchema = z.array(z.union([marketEntrySchema, indexEntrySchema])).min(1);

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
	home: z.boolean(),
	/** When the game kicks off. A time the league has not set yet is the start of its day on the
	 * Eastern clock. The season's first kickoff is the earliest of them. */
	kickoff: isoTime,
	/** Its state at the run's instant (Lane 80), the API's one rule: final once either side's result
	 * or line is in, kicked off from its kickoff until then, upcoming before. Absent on a run from
	 * before the nightly wrote it. */
	state: z.enum(['upcoming', 'kicked_off', 'final']).optional()
});

/** A slate's games left at the run's instant (Lane 80): their strength to a tenth, its rank
 * among the clubs with a game left (1 the hardest), and how it is measured. */
export const restSlateSchema = z.object({
	strength: points,
	rank: z.number().int().min(1).max(32),
	method: phrase
});

export const slateSchema = z.object({
	abbr: club,
	games: z.array(gameSchema).min(1),
	/** The strength of this slate in the method's unit. */
	strength: points,
	/** 1 is the hardest slate of the 32. */
	rank: z.number().int().min(1).max(32),
	/** How strength is measured, as the page prints it beside the number: a noun phrase with its own
	 * article, "the average of each club's opponents' expected wins for the season, ...". */
	method: phrase,
	/** When the inputs were read, from their own stamps. */
	window: windowSchema,
	/** The rest of the season (Lane 80), null with no game left; absent on a run from before. */
	rest: restSlateSchema.nullable().optional()
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

/** The API's designation statuses (DesignationStatus), the words designations.json keys by. */
export const DESIGNATION_STATUSES = [
	'questionable',
	'doubtful',
	'out',
	'injured_reserve',
	'suspended',
	'pup',
	'nfi'
] as const satisfies readonly components['schemas']['DesignationStatus'][];

/** Every status the API can send is listed: a status added to the contract fails the check here. */
type Unlisted = Exclude<
	components['schemas']['DesignationStatus'],
	(typeof DESIGNATION_STATUSES)[number]
>;
export const EVERY_STATUS_LISTED: Unlisted extends never ? true : never = true;

/** One ranked player's designation on the capture. A season-long one (injured reserve, PUP, NFI,
 * suspended, or out for the season) puts him below every available player at his position; a week's
 * out, doubtful or questionable moves nothing. */
export const playerStatusSchema = z
	.object({
		status: z.enum(DESIGNATION_STATUSES),
		seasonLong: z.boolean(),
		/** The first capture of his unbroken run under a season-long status; null for a week's
		 * designation and for a run older than the captures read, whose start we do not know. */
		since: isoTime.nullable(),
		/** The day he is due back from a season-long list (Lane 153), absent without one and from an
		 * older file: on a questionable status he is designated to return this week, ranked as playing;
		 * on a season-long one, after this week's games. */
		returning: z.iso.date().optional()
	})
	.refine(
		(status) => status.seasonLong || status.since === null,
		'Only a season-long status has a since.'
	)
	.refine(
		(status) =>
			status.returning === undefined || status.seasonLong || status.status === 'questionable',
		'A return day this week is on a questionable status.'
	);

export const designationsSchema = z.object({
	/** The capture's stamp: when the provider's list last changed (an unchanged list is not stored). */
	readAt: isoTime,
	/** The capture job's last successful check of the list, null when the store records none: a page
	 * says "read" at it, and "as the list stood" at readAt without it. */
	checkedAt: isoTime.nullable(),
	/** The capture's feed in our store. Provenance, never printed on a screen. */
	source: phrase,
	/** By player id, every ranked player the capture lists. A player it does not list is not keyed. */
	players: z.record(playerId, playerStatusSchema)
});

export type Format = z.infer<typeof formatSchema>;
/** The pages the nightly's schema gate held back (Lane 136): the reader refused each one, and the run
 * published because few enough did. A held page is never read from its own document: it is an earlier
 * run's copy beside the run (`held/<id>.json`), stamped with that run, or, with no copy, the board's
 * figures alone. Absent on a run that held none, and on every run from before. */
export const heldPageSchema = z.object({
	id: playerId,
	/** What the reader said of his page tonight, for the run's report; never printed on a screen. */
	refusal: phrase,
	/** The run his copy is from and when that run was written; null when no earlier run had a page of
	 * his the reader takes. */
	copy: z.object({ runId: runIdSchema, runAt: isoTime }).nullable()
});

export const heldSchema = z.object({ pages: z.array(heldPageSchema).min(1) });

export type HeldPage = z.infer<typeof heldPageSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type RunReach = z.infer<typeof reachSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Window = z.infer<typeof windowSchema>;
export type BoardRow = z.infer<typeof boardRowSchema>;
export type MarketRow = z.infer<typeof marketRowSchema>;
/** A board as the pages read it: the ranked rows, and the kickers and defenses in draft order apart. */
export interface Board {
	format: string;
	rows: BoardRow[];
	market: MarketRow[];
}
/** A kicker's or a defense's row as a page prints it: his status when the capture lists him, and his
 * face (a defense's is its club's mark, site/market.ts). */
export type MarketRowView = MarketRow & { status?: PlayerStatus; face: string | null };
export type PullFigure = z.infer<typeof pullFigureSchema>;
export type Capsule = z.infer<typeof capsuleSchema>;
export type PlayerFormat = z.infer<typeof playerFormatSchema>;
export type Player = z.infer<typeof playerSchema>;
export type AdpSource = z.infer<typeof adpSourceSchema>;
export type Adp = z.infer<typeof adpSchema>;
export type Score = z.infer<typeof scoreSchema>;
export type RecordLine = z.infer<typeof recordLineSchema>;
export type RecordWeek = z.infer<typeof recordWeekSchema>;
export type PlacedPlayer = z.infer<typeof placedPlayerSchema>;
export type RecordWeekStatus = z.infer<typeof recordWeekStatus>;
export type RunRecord = z.infer<typeof recordSchema>;
export type WeeklyRecord = z.infer<typeof weeklyRecordSchema>;
export type DraftRecord = z.infer<typeof draftRecordSchema>;
export type DraftLine = z.infer<typeof draftLineSchema>;
export type IndexEntry = z.infer<typeof indexEntrySchema>;
export type MarketEntry = z.infer<typeof marketEntrySchema>;
export type IndexSeason = z.infer<typeof indexSeasonSchema>;
/** A board row with his games and points a game this season, from index.json. */
export type SeasonedRow = BoardRow & { season: IndexSeason };
/** A board row as a page prints it: his season figures only once the season is underway, his status
 * when the run's injury capture lists him. */
export type BoardRowView = BoardRow & { season?: IndexSeason; status?: PlayerStatus };
export type Club = z.infer<typeof clubSchema>;
export type Game = z.infer<typeof gameSchema>;
export type Slate = z.infer<typeof slateSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type PlayerStatus = z.infer<typeof playerStatusSchema>;
export type Designations = z.infer<typeof designationsSchema>;

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
	schedule: 'schedule.json',
	designations: 'designations.json',
	held: 'held.json',
	/** A held page's copy from an earlier run (Lane 136). */
	heldCopy: (id: string) => {
		if (!PLAYER_ID.test(id)) throw new Error(`"${id}" is not a player id.`);
		return `held/${id}.json`;
	}
} as const;

/** The object a run's writer moves to point the site at its newest valid run. */
export const LATEST_POINTER = 'latest.json';
export const latestPointerSchema = z.object({ runId: runIdSchema });
