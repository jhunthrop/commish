package app.trycommish.core.sheet

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunManifestAnswer
import app.trycommish.core.board.BoardOrder
import app.trycommish.core.board.RunBoardReader
import app.trycommish.core.board.RunReads
import app.trycommish.core.board.placed

/**
 * Our board as an empty sheet starts from it (web/src/lib/server/sheet-board.ts sheetBoard, the iOS
 * SheetStart): the run's board for the sheet's format, its ranked players in our order with each on a
 * season-long list after the last available player at his position, then its kickers and defenses in the
 * drafts' order, each a row with no tier, tag or note.
 */
object SheetStart {
    /** format-ids.ts DEFAULT_TEAMS. */
    private const val DEFAULT_TEAMS = 12

    /** The rows our board starts a sheet with, or null when the run has no board for the format. */
    suspend fun rows(
        reads: RunReads,
        format: BoardFormat,
    ): List<SheetEntry>? {
        val manifest = RunBoardReader.resolve(reads.manifest(null), null)
        val run = decodeEnvelope<RunManifestAnswer>(manifest.body).manifest.formats.firstOrNull { sheetFormat(it) == format } ?: return null
        val read = RunBoardReader.read(reads, run.id, null)
        val statuses = read.designations?.players.orEmpty()
        val ranked =
            BoardOrder.withStatuses(read.board.rows.map { it.placed() }, statuses).map {
                entry(it.id, it.row.name, it.position, it.row.team, it.row.headshot)
            }
        val drafted =
            BoardOrder.withStatuses(read.board.market.map { it.placed() }, statuses).map {
                entry(it.id, it.row.name, it.position, it.row.team, it.row.headshot)
            }
        return (ranked + drafted).take(SheetLimits.ROWS)
    }

    /** The sheet's format a run format reaches (format-ids.ts apiFormatOf): the league size the sheet keeps
     * one board for, its id without the team count, hyphens read as underscores ("ppr-12" is "ppr"). */
    fun sheetFormat(format: RunFormat): BoardFormat? {
        val suffix = "-$DEFAULT_TEAMS"
        if (format.teams != DEFAULT_TEAMS || !format.id.endsWith(suffix)) return null
        val name = format.id.removeSuffix(suffix).replace('-', '_')
        return BoardFormat.entries.firstOrNull { it.value == name && it != BoardFormat.unknown_default_open_api }
    }

    /** A board row as a sheet row: his face where it is an https address the API takes, a defense's none
     * (its club's chip is drawn, B245). */
    private fun entry(
        id: String,
        name: String,
        position: String,
        team: String,
        headshot: String?,
    ): SheetEntry {
        val face = headshot?.takeIf { position != DEFENSE && it.startsWith("https://") && it.length <= SheetLimits.HEADSHOT }
        return SheetEntry(id, name, position, team.ifEmpty { null }, face, null, emptyList(), null)
    }
}
