package app.trycommish.core.sheet

import app.trycommish.api.models.BoardFormat
import app.trycommish.core.AppWords
import app.trycommish.core.Format
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The cheat sheet's words (the iOS SheetWords): the web's, written inline in web/src/lib/sheet
 * (SheetPage.svelte, RowEditor.svelte, ImportPanel.svelte, EmptySheet.svelte, status.ts), copied here
 * because the web keeps no word table for them, held to the web's sources by
 * apps/android/scripts/sheet-words.test.ts; the status line and the tags are held to
 * shared/fixtures/parity/sheet.json. The phone's own words, where the web has no such state, are listed
 * there with their reason. The web says "line" for a row of a file, a word the copy rules keep for the
 * field (shared/words/banned-words.json), so the phone says "row".
 */
@Suppress("ktlint:standard:property-naming") // A word table reads like Words.LeagueHome.
object SheetWords {
    /** limits.ts DEFAULT_SHEET_NAME. */
    const val defaultName = "My sheet"

    // The status line (status.ts STATUS_WORDS and statusWords).
    const val saving = "Saving to your account"
    const val saved = "Saved to your account"
    const val notSaved = "Not saved to your account"

    /** date.ts dayLabel's clock: the NFL's. */
    private val eastern: ZoneId = ZoneId.of("America/New_York")
    private val clock = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

    /** The status beside the name, or null for an empty sheet with nothing to say (statusWords): "Saved to
     * your account at 7:41 PM" for a change today on the phone's clock, "Saved to your account Oct 13" for
     * one before. */
    fun status(
        save: SheetSave,
        changedAt: Instant?,
        answeredAt: Instant,
        players: Int,
        zone: ZoneId,
    ): String? =
        when {
            save is SheetSave.Failed -> save.reason
            players == 0 -> null
            save == SheetSave.Saving -> saving
            else -> savedWords(changedAt, answeredAt, zone)
        }

    private fun savedWords(
        changedAt: Instant?,
        answeredAt: Instant,
        zone: ZoneId,
    ): String =
        when {
            changedAt == null -> saved
            Format.sameDay(changedAt, answeredAt, zone) -> "$saved at ${clock.format(changedAt.atZone(zone))}"
            else -> "$saved ${Format.shortDay(changedAt, eastern)}"
        }

    /** The head's line: "PPR · 8 players · Saved to your account Oct 13". */
    fun headLine(
        format: String,
        players: Int,
        status: String?,
    ): String = listOfNotNull(format, Format.plural(players, "player", "players"), status).joinToString(" · ")

    /** The board format's chip (format.ts FORMAT_LABELS, generated); null for one this build does not know. */
    fun formatLabel(format: BoardFormat): String? =
        when (format) {
            BoardFormat.ppr -> Words.FormatLabel.ppr
            BoardFormat.half_ppr -> Words.FormatLabel.half_ppr
            BoardFormat.standard -> Words.FormatLabel.standard
            BoardFormat.te_premium -> Words.FormatLabel.te_premium
            BoardFormat.superflex -> Words.FormatLabel.superflex
            BoardFormat.two_flex -> Words.FormatLabel.two_flex
            BoardFormat.dynasty -> Words.FormatLabel.dynasty
            BoardFormat.best_ball -> Words.FormatLabel.best_ball
            BoardFormat.unknown_default_open_api -> null
        }

    // The tools and the filters (SheetPage.svelte).
    const val importTool = "Import"

    /** The export, handed to the phone's share sheet where the site downloads it and prints. */
    const val exportTool = "Export CSV"
    const val all = "All"

    /** "3 players shown" while a filter narrows the sheet. */
    fun shown(count: Int): String = "${Format.plural(count, "player", "players")} shown"

    // A row and its editor (SheetRow.svelte, RowEditor.svelte).
    const val notePlaceholder = "Your note"
    const val ownTagPlaceholder = "Your own tag"
    const val addTag = "Add tag"
    const val remove = "Take off my sheet"
    const val full = "Keep it to ${SheetLimits.TAGS} tags"
    const val tagShape = "A tag is 1 to ${SheetLimits.TAG_LENGTH} letters or numbers"
    const val bothTargetAndAvoid = "Target and Avoid are both set, pick one"

    /** "Edit Ja'Marr Chase": the row's disclosure, for a screen reader. */
    fun edit(name: String): String = "Edit $name"

    /** "2 tags: Target, Sleeper" (SheetRow.svelte's count, said). */
    fun tagsSaid(marks: List<TagMark>): String = "${Format.plural(marks.size, "tag", "tags")}: ${marks.joinToString(", ") { it.label }}"

    const val hasNote = "Has a note"

    // A row not saved (the phone's own: the web keeps an edit in the browser, the phone does not).

    /** "Saving" under a row whose edit is on its way. */
    const val rowSaving = "Saving"

    /** The line under a row whose edit did not land: the web's words, then the reason. */
    fun rowUnsaved(reason: String): String = "$notSaved. $reason"

    /** The reason when the request never reached the account. */
    const val offline = "No connection."

    /** The reason when the account answered with nothing readable. */
    const val unknown = "Try again in a minute."
    const val tryAgain = AppWords.tryAgain

    // Import (ImportPanel.svelte).
    const val importHead = "Import"
    const val fileLabel = "A CSV file"
    const val chooseFile = "Choose a CSV"

    /** The phone's paste box takes the sheet's CSV: a list of names is read against our board in the browser,
     * which the API's import does not do (B264). */
    const val pasteLabel = "Or paste a CSV"
    const val pastePlaceholder = "rank,player_id,name,position,team,tier,tags,note"
    const val replace = "Replace my sheet"
    const val use = "Use this sheet"
    const val cancel = "Cancel"
    const val done = "Done"
    const val tooLarge = "That file is over 1 MB"

    /** FilePick.svelte's words beside the button until a file is chosen. */
    const val noFile = "No file chosen"

    /** The phone's own: the export's file could not be kept on the phone for the share sheet. */
    const val notKept = "The file could not be saved on this phone."
    const val unreadable = "That file does not read as CSV"

    /** How many skipped rows the result names before it counts the rest (SKIPS_SHOWN). */
    const val SKIPS_SHOWN = 12

    /** "212 players read". */
    fun read(count: Int): String = "${Format.plural(count, "player", "players")} read"

    /** "3 rows skipped". */
    fun skipped(count: Int): String = "${Format.plural(count, "row", "rows")} skipped"

    /** "Row 4: The position is not QB, RB, WR, TE, K or DST", the file's row as the API numbers it. */
    fun skip(
        row: Int,
        reason: String,
    ): String = "Row $row: $reason"

    /** "And 9 more". */
    fun more(count: Int): String = "And $count more"

    /** The phone's own: a file that reads no player on the phone is not sent. */
    const val keptAsItWas = "No player read, so your sheet is as it was."

    /** The phone's own: the account's import read no player and replaced the rows anyway (B265), so the
     * sheet is read again and shown as the account now holds it. */
    const val readNone = "No player read. Your sheet is shown as your account now holds it."

    // A file's rows refused (csv.ts decodeCsv), "row" where the web says "line".
    const val emptyFile = "The file is empty"
    const val badHeader = "The first row must name rank, player_id, name and position"
    const val notCsv = "This row is not valid CSV"
    const val earlier = "This player is already on an earlier row"
    const val tooMany = "A sheet holds at most ${SheetLimits.ROWS} players"
    const val badRank = "The rank is not a whole number from 1"
    const val badPosition = "The position is not QB, RB, WR, TE, K or DST"
    const val badTier = "The tier is not a whole number from 1 to ${SheetLimits.TIER}"

    /** "The note runs 0 to 500 characters". */
    fun length(
        label: String,
        min: Int,
        max: Int,
    ): String = "The $label runs $min to $max characters"

    // A conflict the account's copy won (merge.ts mergeRow).

    /** "Your note on Ja'Marr Chase was replaced by the one saved on another device". */
    fun noteReplaced(name: String): String = "Your note on $name was replaced by the one saved on another device"

    /** "Your tags on Ja'Marr Chase were replaced by the ones saved on another device". */
    fun tagsReplaced(name: String): String = "Your tags on $name were replaced by the ones saved on another device"

    // The empty sheet (EmptySheet.svelte, SheetPage.svelte).
    const val startHead = "Start your sheet"
    const val start = "Start from our board"
    const val importSheet = "Import a sheet"
    const val boardFailed = "Our board did not load. Try again in a moment"

    /** "Our PPR board, best first". */
    fun boardLead(format: String): String = "Our $format board, best first"

    /** "Our PPR board is not out yet". */
    fun boardNone(format: String): String = "Our $format board is not out yet"
}
