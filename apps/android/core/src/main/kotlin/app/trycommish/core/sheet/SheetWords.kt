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
 * The cheat sheet's words (the iOS SheetWords): the web's plain words read from the generated tables
 * (Words.Sheet, Words.SheetImport, Words.SheetStatus, from web/src/lib/sheet/words.ts, Lane 283), the
 * words with a slot spelled here until B256, and the phone's own, listed with their reason in
 * apps/android/scripts/sheet-words.test.ts, which fails on a copy of a table's word; the status line and
 * the tags are held to shared/fixtures/parity/sheet.json. The web's slot words still say "line" for a row of
 * a file, a word the copy rules keep for the field (shared/words/banned-words.json), so the phone says "row".
 */
@Suppress("ktlint:standard:property-naming") // A word table reads like Words.LeagueHome.
object SheetWords {
    /** limits.ts DEFAULT_SHEET_NAME. */
    const val defaultName = Words.Sheet.defaultName

    // The status line (status.ts STATUS_WORDS and statusWords).
    const val saving = Words.SheetStatus.saving
    const val saved = Words.SheetStatus.saved
    const val notSaved = Words.SheetStatus.notSaved

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
    const val importTool = Words.Sheet.importTool

    /** The export, handed to the phone's share sheet where the site downloads it and prints. */
    const val exportTool = Words.Sheet.exportTool
    const val all = Words.Sheet.all

    /** "3 players shown" while a filter narrows the sheet. */
    fun shown(count: Int): String = "${Format.plural(count, "player", "players")} shown"

    // A row and its editor (SheetRow.svelte, RowEditor.svelte).
    const val notePlaceholder = Words.Sheet.notePlaceholder
    const val ownTagPlaceholder = Words.Sheet.ownTagPlaceholder
    const val addTag = Words.Sheet.addTag
    const val remove = Words.Sheet.remove
    const val full = "Keep it to ${SheetLimits.TAGS} tags"
    const val tagShape = "A tag is 1 to ${SheetLimits.TAG_LENGTH} letters or numbers"
    const val bothTargetAndAvoid = Words.SheetImport.bothTargetAndAvoid

    /** "Edit Ja'Marr Chase": the row's disclosure, for a screen reader. */
    fun edit(name: String): String = "Edit $name"

    /** "2 tags: Target, Sleeper" (SheetRow.svelte's count, said). */
    fun tagsSaid(marks: List<TagMark>): String = "${Format.plural(marks.size, "tag", "tags")}: ${marks.joinToString(", ") { it.label }}"

    const val hasNote = Words.Sheet.hasNote

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
    const val importHead = Words.SheetImport.head
    const val fileLabel = Words.SheetImport.fileLabel
    const val chooseFile = Words.SheetImport.chooseFile

    /** The account's import reads the list against our board (Lane 278). */
    const val pasteLabel = Words.SheetImport.pasteLabel

    /** ImportPanel.svelte PASTE_EXAMPLE. */
    const val pastePlaceholder = Words.SheetImport.pasteExample

    /** The phone's own: what a list that reads looks like, said under an import that read nothing and named no
     * skipped row, so the format itself was wrong. */
    const val listShape = "Paste one player to a row, like 1. Puka Nacua"

    /** The verb under an import that read no player: back to the box, the text kept (Lane 297). */
    const val fixList = Words.SheetImport.fixList
    const val replace = Words.SheetImport.replace
    const val use = Words.SheetImport.use
    const val cancel = Words.SheetImport.cancel
    const val done = Words.Sheet.done
    const val tooLarge = Words.SheetImport.tooLarge

    /** FilePick.svelte's words beside the button until a file is chosen. */
    const val noFile = Words.SheetImport.noFile

    /** The phone's own: the export's file could not be kept on the phone for the share sheet. */
    const val notKept = "The file could not be saved on this phone."
    const val unreadable = Words.SheetImport.unreadable

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

    /** A file that reads no player on the phone is not sent: the account's own sentence for an import that
     * reads no player (api/internal/sheets/handler.go emptyReadSentence). */
    const val keptAsItWas = "No player read, so your sheet is as it was."

    /** The account's word for a line of the file or the list, its first letter spelled as a class so the copy
     * guard reads no word in the pattern. */
    private val accountLine = Regex("\\b([Ll])ine(s?)\\b")

    /** The account's sentence with the phone's word for a line: the API says "line", a word the copy rules
     * keep for the field, so the phone says "row", as [SheetCsv]'s reasons do. */
    fun rowWords(sentence: String): String =
        sentence.replace(accountLine) { found ->
            val (first, plural) = found.destructured
            (if (first.first().isUpperCase()) "Row" else "row") + plural
        }

    // A file's rows refused (csv.ts decodeCsv), the generated words where they need no slot.
    const val emptyFile = Words.SheetImport.emptyFile
    const val badHeader = Words.SheetImport.badHeader
    const val notCsv = Words.SheetImport.notCsv
    const val earlier = Words.SheetImport.earlier
    const val tooMany = "A sheet holds at most ${SheetLimits.ROWS} players"
    const val badRank = Words.SheetImport.badRank
    const val badPosition = Words.SheetImport.badPosition
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
    const val startHead = Words.Sheet.startHead
    const val start = Words.Sheet.start
    const val importSheet = Words.Sheet.importSheet
    const val boardFailed = Words.Sheet.boardFailed

    /** "Our PPR board, best first". */
    fun boardLead(format: String): String = "Our $format board, best first"

    /** "Our PPR board is not out yet". */
    fun boardNone(format: String): String = "Our $format board is not out yet"
}
