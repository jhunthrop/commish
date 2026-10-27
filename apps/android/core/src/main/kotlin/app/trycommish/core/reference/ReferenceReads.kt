package app.trycommish.core.reference

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.RunAdpSource
import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunIndexEntry
import app.trycommish.api.models.RunManifest
import app.trycommish.api.models.RunManifestAnswer
import app.trycommish.api.models.RunSchedule
import app.trycommish.core.Cache
import app.trycommish.core.Clock
import app.trycommish.core.board.RunReadFailure
import app.trycommish.core.board.RunReads
import app.trycommish.core.liveorder.OrderReader
import app.trycommish.core.player.PageSource
import app.trycommish.core.player.PlayerLookup
import app.trycommish.core.player.PlayerPageReads
import app.trycommish.core.player.Read
import app.trycommish.core.player.ReadStamp
import app.trycommish.core.player.RunFiles
import app.trycommish.core.player.quietly

/** The screen again at the order's clock, read through the order's reader for the players it draws:
 * null where the read fails or does not place every row it draws, so the run's model stands. */
typealias AtClock<Model> = suspend (OrderReader) -> Model?

/** A screen built from the run's files: the screen's model, the manifest it is of (its stamp and the
 * offline words), every read it took, and in season the screen again at the order's clock (Lane 226);
 * null for a screen with no figures on a clock (before the season, the schedule, ADP). */
class Built<Model>(
    val model: Model,
    val manifest: RunManifest,
    val reads: List<ReadStamp>,
    val atClock: AtClock<Model>? = null,
)

/**
 * The run's files the reference screens read (ADP, compare, the clubs, a club, the schedule; the iOS
 * RunReads), each kept on the phone with the ETag the API gave it under its own key ([RunFiles]), so the
 * screens, the sheet and the player page share one copy of each whoever reads it first.
 */
class ReferenceReads(
    private val run: RunReads,
    private val pages: PlayerPageReads,
    cache: Cache,
    val clock: Clock,
) {
    private val files = RunFiles(cache, clock)
    val lookup: PlayerLookup = PlayerLookup(files, run, pages)

    suspend fun manifest(): Read<RunManifestAnswer> = lookup.manifest()

    /** A format's board as the manifest names it ("ppr-12"); a board of another run than the manifest (the
     * pointer moved between the reads) is read again afresh, once. */
    suspend fun board(
        format: String,
        manifest: RunManifestAnswer,
    ): Read<RunBoardAnswer> {
        val route = "/run/boards/$format"
        val read = files.read(route, { decodeEnvelope<RunBoardAnswer>(it) }) { tag -> run.board(format, tag) }
        if (read.at.saved != null || read.value.runId == manifest.runId) return read
        val again = files.read(route, { decodeEnvelope<RunBoardAnswer>(it) }) { run.board(format, null) }
        if (again.value.runId != manifest.runId) throw RunReadFailure.RunTurned()
        return again
    }

    suspend fun sources(): Read<List<RunAdpSource>> = lookup.sources()

    /** The capture beside the run; null where it cannot be read, so the screen stands without statuses. */
    suspend fun designations(): Read<RunDesignations?>? = quietly { lookup.designations() }

    suspend fun clubs(): Read<List<RunClub>> = lookup.clubs()

    suspend fun schedule(): Read<RunSchedule> = lookup.schedule()

    suspend fun index(): Read<List<RunIndexEntry>> = lookup.entry("").first

    /** The run's complete week (server/run.ts seasonReach's complete): the season block's through week on
     * the run's first own page, which every page of the run shares; null where no page answers. */
    suspend fun complete(
        index: List<RunIndexEntry>,
        manifest: RunManifestAnswer,
    ): Pair<Int?, List<ReadStamp>> {
        index.take(COMPLETE_TRIES).forEach { entry ->
            val (source, reads) = lookup.source(entry, manifest)
            if (source is PageSource.Page) return source.player.season.through to reads
        }
        return null to emptyList()
    }

    companion object {
        /** How many index entries are tried for an own page (a held page has another run's season). */
        const val COMPLETE_TRIES = 8
    }
}
