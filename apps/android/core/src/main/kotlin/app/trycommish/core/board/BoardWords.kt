package app.trycommish.core.board

import app.trycommish.api.models.RunAdpSource
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunManifest
import app.trycommish.api.models.RunWindow
import app.trycommish.core.AppWords
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.shell.SiteLinks
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import kotlin.math.abs

/** The season pages' verbs (web/src/lib/site/season-words.ts PageVerb), each by what it does, its words
 * generated (PAGE_VERBS), and the site's page it opens until the app has a screen for it (verb-links.ts). */
enum class PageVerb(
    val id: String,
    val title: String,
    val page: String,
) {
    Follow("follow", Words.PageVerb.follow, SiteLinks.LEAGUE_START),
    OpenLeague("open_league", Words.PageVerb.open_league, SiteLinks.LEAGUE_START),
    Mock("mock", Words.PageVerb.mock, SiteLinks.MOCK_SETUP),
    Sheet("sheet", Words.PageVerb.sheet, SiteLinks.SHEET),
}

/** What a board covers, as its words need it (season-words.ts BoardCover with its label and view). */
data class BoardCover(
    val season: Int,
    /** The format's chip, "PPR". */
    val label: String,
    /** The view's position, null for All. */
    val position: String?,
    /** The board ranks the rest of the season (the run's rosFromWeek). */
    val restOfSeason: Boolean,
)

/** The capture a board's statuses come from (designation.ts CaptureStamp): when its list last changed, and
 * the capture job's last check of it, null when none is recorded. */
data class CaptureStamp(
    val asOf: Instant,
    val checkedAt: Instant?,
) {
    /** When it was last known to stand: its check, else its list's change. */
    private val last: Instant get() = checkedAt ?: asOf

    companion object {
        /** designation.ts newerCapture (Lane 280, B257): the stamp a board's status column is as of, the
         * newer of the run's capture and the live order's, the run's on a tie, either alone without the other.
         * Held to board-run.json's liveStamps. */
        fun newer(
            run: CaptureStamp?,
            live: CaptureStamp?,
        ): CaptureStamp? =
            when {
                live == null || run == null -> live ?: run
                live.last > run.last -> live
                else -> run
            }
    }
}

/** The board's words as the web's season pages say them (season-words.ts boardWords, held to
 * shared/fixtures/parity/board.json): the bar's word, the document's title, the heading and the one
 * verb. In season the board is the rest of the season where the run ranks it, and the verb follows the
 * league: none once a league is followed, following one until then; before the draft, the mock. */
data class BoardWords(
    val bar: String,
    val title: String,
    val heading: String,
    val verb: PageVerb?,
) {
    companion object {
        /** `inSeason` is the bar's season; `following` whether the member follows a league. */
        fun of(
            inSeason: Boolean,
            cover: BoardCover,
            following: Boolean,
        ): BoardWords {
            val ranksRest = inSeason && cover.restOfSeason
            val noun = if (ranksRest) AppWords.restOfSeason else AppWords.board
            val lower = if (ranksRest) noun.lowercase() else noun
            val named = { prefix: String -> "$prefix $lower" }
            return BoardWords(
                bar = cover.position?.let(named) ?: noun,
                title = named(cover.position?.let { "$it ${cover.label}" } ?: cover.label),
                heading = if (ranksRest) "Rest of ${cover.season}" else "${cover.season} ${AppWords.board}",
                verb =
                    when {
                        !inSeason -> PageVerb.Mock
                        following -> null
                        else -> PageVerb.Follow
                    },
            )
        }

        /** designation.ts captureShort: "Status read Oct 16.", "as of" its last change with no check, the
         * hour on the member's own day ("Status read today 9:15 am CT."), and past a day and a half how old
         * it is. */
        fun capture(
            asOf: Instant,
            checkedAt: Instant?,
            now: Instant,
            zone: ZoneId,
        ): String {
            val last = checkedAt ?: asOf
            // On the member's own day the hour tells this hour's capture from last night's (Lane 280).
            val day = { at: Instant ->
                if (Format.sameDay(at, now, zone)) {
                    "${Words.Capture.today} ${Format.timeOfDay(at, zone)} ${Format.zoneShort(at, zone)}"
                } else {
                    Format.shortDay(at, zone)
                }
            }
            val said = checkedAt?.let { "${Words.Capture.read} ${day(it)}" } ?: "${Words.Capture.asOf} ${day(asOf)}"
            val old = if (Duration.between(last, now) > CAPTURE_BEHIND) ", ${Words.Capture.old}" else ""
            return "${Words.Capture.status} $said$old."
        }

        /** The capture's words for a stamp (capture above). */
        fun capture(
            stamp: CaptureStamp,
            now: Instant,
            zone: ZoneId,
        ): String = capture(stamp.asOf, stamp.checkedAt, now, zone)

        /** designation.ts CAPTURE_BEHIND_MS: past it the capture says how old it is. */
        private val CAPTURE_BEHIND: Duration = Duration.ofHours(36)
    }
}

/** The run's words beside its board, each on the clock the site prints a run's dates on (format/date.ts,
 * US Eastern, the NFL's), held to shared/fixtures/parity/board-run.json. */
object RunWords {
    /** format/date.ts ZONE. */
    val eastern: ZoneId = ZoneId.of("America/New_York")

    private fun day(text: String): String = instantOrNull(text)?.let { Format.shortDay(it, eastern) } ?: text

    /** run/stamp.ts runStampText: "Updated Oct 21", "Stand-in, updated Sep 1" before the first real run. */
    fun stamp(manifest: RunManifest): String =
        "${if (manifest.standIn) Words.RunStamp.standIn else Words.RunStamp.updated} ${day(manifest.runAt)}"

    /** site/absent.ts absentWords' title: "Half PPR is not on our board yet", a format the run lacks. */
    fun absent(label: String): String = "$label is not on our board yet"

    /** site/offline-words.ts offlineLead: the reason a saved board shows, said with its run's day. */
    fun offline(manifest: RunManifest): String = "${AppWords.offlineBoard} ${day(manifest.runAt)}."

    /** run/rest-from.ts restFromWords: "from week 7", "from week 7's games left" while a game of it had
     * kicked off at the run. */
    fun restFrom(
        week: Int,
        partial: Boolean,
    ): String = (if (partial) Words.Figure.restFromPartial else Words.Figure.restFrom).replace("{week}", week.toString())

    /** run/rest-words.ts restCaption: "PPR points for the rest of the 2026 season from week 7, refreshed
     * October 21"; null on a board of the full season. */
    fun restCaption(
        format: RunFormat,
        season: Int,
    ): String? {
        val rest = restOfSeason(format, season) ?: return null
        val refreshed = instantOrNull(format.refreshedAt) ?: return null
        return "${format.label} points for $rest, refreshed ${Format.monthDay(refreshed, eastern)}"
    }

    /** "the rest of the 2026 season from week 7", null before the run ranks the rest. */
    fun restOfSeason(
        format: RunFormat,
        season: Int,
    ): String? = format.rosFromWeek?.let { "the rest of the $season season ${restFrom(it, format.rosFromWeekPartial == true)}" }

    /** run/adp-drafts.ts adpDrafts: the drafts behind a format's ADP with their window, "PPR drafts, Sep 9". */
    fun adpDrafts(
        sources: List<RunAdpSource>,
        format: String,
    ): List<String> = sources.filter { format in it.formats }.map { "${it.drafts}, ${window(it.window)}" }

    /** format/date.ts windowLabel: "Sep 9", "Sep 5 to Sep 9". */
    fun window(window: RunWindow): String {
        val from = day(window.from)
        val to = day(window.to)
        return if (from == to) from else "$from to $to"
    }
}

/** A board row's figures as the phone prints them (web/src/lib/format/number.ts and gap.ts). */
object BoardFigures {
    /** format/number.ts MINUS: a negative figure's sign. */
    private const val MINUS = "−"

    /** His projected points, "262.1"; the empty figure for none. */
    fun projected(value: Double?): String = value?.let { Format.fixed(it) } ?: Words.Box.none

    /** number.ts signed: "+113.9", "−12.5", "+0.0" for a figure that rounds to nothing. */
    fun signed(value: Double): String {
        val magnitude = Format.fixed(abs(value))
        return if (value < 0 && magnitude.toDouble() != 0.0) "$MINUS$magnitude" else "+$magnitude"
    }

    /** gap.ts gapText: "+1.8", "−4.5", "0.0", the empty figure for none. */
    fun gap(value: Double?): String =
        when {
            value == null -> Words.Box.none
            value == 0.0 -> Format.fixed(0.0)
            else -> signed(value)
        }
}

/** The board's basis on a phone as the web says it (run/board-basis.ts boardBasis, site/market.ts
 * marketBasis), held to shared/fixtures/parity/board-run.json: our board's sentence (the rest of the
 * season's from its week, once the run ranks it), the tiers' position on a position's view, the drafts
 * behind the ADP before the season, and the Gap's definition where its column shows; a kicker's or a
 * defense's view says the drafts' order instead. */
object BoardBasis {
    /** board-basis.ts ourBoard. */
    fun ourBoard(
        format: RunFormat,
        season: Int,
    ): String {
        val league = "for ${format.teams} teams"
        val rest = RunWords.restOfSeason(format, season)
        val refreshed = instantOrNull(format.refreshedAt)
        if (rest == null || refreshed == null) return "Our ${format.label} board, by points over replacement $league."
        return "Our ${format.label} board, $rest, by points over replacement $league, refreshed " +
            "${Format.monthDay(refreshed, RunWords.eastern)}."
    }

    /** market.ts marketBasis: the drafts the order is taken from, where the run names them. */
    fun draftOrder(
        format: RunFormat,
        sources: List<RunAdpSource>,
    ): String {
        val source = sources.firstOrNull { it.id == format.marketOrder }
        val from = source?.let { " from ${it.drafts}, ${RunWords.window(it.window)}" }.orEmpty()
        return "Kickers and defenses the drafters take rank in their draft order$from, with no projected points and no tiers."
    }

    /** The phone's parts of a ranked view's basis. */
    fun ranked(
        format: RunFormat,
        season: Int,
        position: BoardPosition?,
        sources: List<RunAdpSource>,
        gap: Boolean,
    ): List<String> {
        val drafts = RunWords.adpDrafts(sources, format.id).joinToString(" and ")
        return listOf(ourBoard(format, season)) +
            listOfNotNull(
                position?.let { "Tiers are drawn within ${it.label}." },
                "ADP from $drafts.".takeIf { format.rosFromWeek == null },
                Words.BoardBasis.gap.takeIf { gap },
            )
    }
}
