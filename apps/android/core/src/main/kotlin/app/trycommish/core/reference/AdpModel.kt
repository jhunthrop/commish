package app.trycommish.core.reference

import app.trycommish.api.models.DesignationStatus
import app.trycommish.api.models.RunAdpSource
import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunManifest
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.BoardBasis
import app.trycommish.core.board.BoardCells
import app.trycommish.core.board.BoardChip
import app.trycommish.core.board.BoardOrder
import app.trycommish.core.board.BoardRow
import app.trycommish.core.board.BoardWords
import app.trycommish.core.board.PageVerb
import app.trycommish.core.board.RunReadFailure
import app.trycommish.core.board.RunWords
import app.trycommish.core.board.placed
import app.trycommish.core.instantOrNull
import app.trycommish.core.start.RowStatuses
import app.trycommish.design.Words
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.time.Instant
import java.time.ZoneId

/** One row of ADP (AdpView.svelte's Row at 390 in the drafters' order): his ADP leading, the board row's
 * face, name, pill, club and bye, then his points, his value and the Gap. */
data class AdpRow(
    /** The board row the run gives him, his figures as the Board draws them. */
    val row: BoardRow,
    /** His ADP, "12.4". */
    val adp: String,
    /** Our rank, the list's word for a player on one ("IR"), the empty figure for a kicker or a defense;
     * kept for the parity test (the phone row draws no Rk, Lane 199 review H1). */
    val rank: String,
) {
    val id: String get() = row.id
}

/** The run's files ADP is drawn from. */
class AdpFiles(
    val manifest: RunManifest,
    val format: RunFormat,
    val board: RunBoardAnswer,
    val sources: List<RunAdpSource>,
    val designations: RunDesignations?,
    val clubs: List<RunClub>,
)

/**
 * ADP for one format as the web's ADP page says it at 390 (server/pages/adp.ts, AdpView.svelte) from the
 * run (GET /run/manifest, /run/boards/{format}, /run/adp, /run/designations, /run/clubs): every player the
 * board carries an ADP for, in the order drafters take them (our rank breaking a tie), beside where our
 * board has him; a player the drafts have and the board does not is not drawn, nor one the board has with
 * no ADP. The format chips, the basis once, the verb to a mock.
 */
data class AdpModel(
    /** "2026 ADP". */
    val heading: String,
    /** "Updated Oct 21". */
    val stamp: String,
    /** The format as the manifest names it ("ppr-12"). */
    val format: String,
    val formats: List<BoardChip<String>>,
    /** The Gap is drawn: the board compares drafters with our rank and a row carries the figure. */
    val gap: Boolean,
    val rows: List<AdpRow>,
    /** "ADP from PPR drafts, Sep 9, earliest first.", our board, the Gap where drawn, the capture. */
    val basis: List<String>,
    val verb: PageVerb,
) {
    /** The heads, ADP's phone row (Lane 199 review H1): ADP, Player, Projected, Over repl and the Gap. */
    val heads: List<String>
        get() =
            listOf(Words.Board.adp, Words.Box.player, Words.Figure.projected, Words.Board.overReplShort) +
                listOfNotNull(Words.Board.gap.takeIf { gap })

    companion object {
        private class Ordered(
            val adp: Double,
            val ourRank: Int,
            val row: BoardRow,
            val rank: String,
        )

        fun of(
            files: AdpFiles,
            now: Instant,
            zone: ZoneId,
        ): AdpModel {
            val manifest = files.manifest
            val format = files.format
            val board = files.board
            val statuses = files.designations?.players.orEmpty()
            val cells = BoardCells(statuses, BoardCells.byes(files.clubs), format.rosFromWeek, zone)
            val ranked =
                BoardOrder.withStatuses(board.rows.map { it.placed() }, statuses).mapNotNull { placed ->
                    val row = placed.row
                    row.adp?.let { Ordered(it.toDouble(), row.ourRank, cells.ranked(row), rank(row, statuses)) }
                }
            val market =
                BoardOrder.withStatuses(board.market.map { it.placed() }, statuses).map { placed ->
                    val row = placed.row
                    Ordered(row.adp.toDouble(), row.ourRank, cells.market(row, placed = true), Words.Box.none)
                }
            // The drafters' order (adp.ts): earliest first, our rank breaking a tie, then as listed (a stable sort).
            val rows =
                (ranked + market)
                    .sortedWith(compareBy({ it.adp }, { it.ourRank }))
                    .map { AdpRow(it.row, Format.fixed(it.adp), it.rank) }
            // format/gap.ts carriesGap over the rows drawn, as the run writes them.
            val carriesGap = board.rows.any { it.adp != null && it.gap != null } || board.market.any { it.gap != null }
            val gap = format.rosFromWeek == null && carriesGap
            val capture =
                files.designations?.let {
                    BoardWords.capture(instantOrNull(it.readAt) ?: now, instantOrNull(it.checkedAt), now, zone)
                }
            return AdpModel(
                heading = "${manifest.season} ${Words.AdpPage.heading}",
                stamp = RunWords.stamp(manifest),
                format = format.id,
                formats = manifest.formats.map { BoardChip(it.label, it.id, it.id == format.id) },
                gap = gap,
                rows = rows,
                basis = basis(format, manifest.season, files.sources, gap) + listOfNotNull(capture),
                verb = PageVerb.Mock,
            )
        }

        /** held-places.ts rankShown: our rank, or the list's word. */
        fun rank(
            row: RunBoardRow,
            statuses: Map<String, RunPlayerStatus>,
        ): String {
            val status =
                statuses[row.id]
                    ?.takeIf { it.seasonLong }
                    ?.status
                    ?.takeUnless { it == DesignationStatus.unknown_default_open_api }
                    ?: return row.ourRank.toString()
            return RowStatuses.rankWord(status)
        }

        /** board-basis.ts boardBasis in the drafters' order, the phone's parts. */
        fun basis(
            format: RunFormat,
            season: Int,
            sources: List<RunAdpSource>,
            gap: Boolean,
        ): List<String> {
            val drafts = RunWords.adpDrafts(sources, format.id).joinToString(" and ")
            return listOf("ADP from $drafts, earliest first.", BoardBasis.ourBoard(format, season)) +
                listOfNotNull(Words.BoardBasis.gap.takeIf { gap })
        }

        /** The run's files for `format` as the manifest names it, null for the run's default; each kept under
         * its own key. */
        fun build(
            format: String?,
            zone: ZoneId,
        ): ScreenBuild<AdpModel> =
            { reads ->
                coroutineScope {
                    val manifest = reads.manifest()
                    val formats = manifest.value.manifest.formats
                    val chosen =
                        formats.firstOrNull { it.id == format } ?: formats.firstOrNull() ?: throw RunReadFailure.NoFormat()
                    val board = async { reads.board(chosen.id, manifest.value) }
                    val sources = async { reads.sources() }
                    val capture = async { reads.designations() }
                    val clubs = async { reads.clubs() }
                    val files =
                        AdpFiles(
                            manifest.value.manifest,
                            chosen,
                            board.await().value,
                            sources.await().value,
                            capture.await()?.value,
                            clubs.await().value,
                        )
                    Built(
                        of(files, reads.clock.now(), zone),
                        files.manifest,
                        listOf(manifest.at, board.await().at, sources.await().at, clubs.await().at) + listOfNotNull(capture.await()?.at),
                    )
                }
            }

        /** ADP in `format` as the manifest names it, null for the run's default. */
        fun viewModel(
            format: String?,
            reads: ReferenceReads,
            zone: ZoneId,
            sessionEnd: SessionEnd,
        ): RunScreenViewModel<AdpModel> = RunScreenViewModel(reads, zone, sessionEnd, null, build(format, zone))
    }
}

/** The format the member last chose: the one asked for while its read is in flight, else the one shown. */
fun RunScreenViewModel<AdpModel>.chosenFormat(): String? =
    (ask.value as? ScreenAsk.Adp)?.format ?: (state.value as? RunScreenState.Loaded)?.model?.format

/** A format chip: ADP in that format, built on the newest choice so a tap during a read wins; a format whose
 * board the run lacks leaves the screen shown, saying so. Null where nothing is asked. */
fun RunScreenViewModel<AdpModel>.choose(format: String): Job? {
    val model = (state.value as? RunScreenState.Loaded)?.model ?: return null
    if (format == chosenFormat()) return null
    val label = model.formats.firstOrNull { it.value == format }?.label ?: format
    return rebuild(AdpModel.build(format, zone), ScreenAsk.Adp(format), RunWords.absent(label))
}
