package app.trycommish.core.board

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.RunAdpAnswer
import app.trycommish.api.models.RunAdpSource
import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunClubsAnswer
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunDesignationsAnswer
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunManifest
import app.trycommish.api.models.RunManifestAnswer
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable

/** A run file as the phone keeps it: the API's answer whole and the ETag it gave, sent back on the
 * next read. */
@Serializable
data class KeptBody(
    val body: String,
    val tag: String?,
)

/** Everything the Board draws as read from the run's routes and kept on the phone, each file with its
 * ETag: the manifest (the run's stamp and its formats), the format's board, the ADP's sources, the
 * injury capture and the clubs' byes. One cache entry per format. */
@Serializable
data class RunBoardBodies(
    /** The board's format, as the manifest names it ("ppr-12"). */
    val format: String,
    val manifest: KeptBody,
    val board: KeptBody,
    val adp: KeptBody,
    val designations: KeptBody,
    val clubs: KeptBody,
)

/** Why a read of the run cannot be drawn. */
sealed class RunReadFailure(
    message: String,
) : Exception(message) {
    /** The manifest names no format. */
    class NoFormat : RunReadFailure("The run names no format.")

    /** A 304 for a file the phone keeps no copy of. */
    class UnchangedWithoutCopy : RunReadFailure("The API said a file stands that this phone never kept.")

    /** The board is another run's than the manifest, again after reading both afresh. */
    class RunTurned : RunReadFailure("The run turned over while it was read.")
}

/** The bodies decoded: what the Board's model draws from. */
class RunBoardRead private constructor(
    val bodies: RunBoardBodies,
    val manifest: RunManifest,
    val manifestRunId: String,
    val board: RunBoardAnswer,
    val sources: List<RunAdpSource>,
    val designations: RunDesignations?,
    val clubs: List<RunClub>,
) {
    /** The board's format as the manifest carries it; the reader keeps no board whose format it lacks. */
    val format: RunFormat = manifest.formats.firstOrNull { it.id == board.format } ?: manifest.formats.first()

    companion object {
        /** Decodes kept bodies; throws where one does not read or the manifest names no format. */
        fun of(bodies: RunBoardBodies): RunBoardRead {
            val manifest = decodeEnvelope<RunManifestAnswer>(bodies.manifest.body)
            if (manifest.manifest.formats.isEmpty()) throw RunReadFailure.NoFormat()
            return RunBoardRead(
                bodies = bodies,
                manifest = manifest.manifest,
                manifestRunId = manifest.runId,
                board = decodeEnvelope(bodies.board.body),
                sources = decodeEnvelope<RunAdpAnswer>(bodies.adp.body).adp.sources,
                designations = decodeEnvelope<RunDesignationsAnswer>(bodies.designations.body).designations,
                clubs = decodeEnvelope<RunClubsAnswer>(bodies.clubs.body).clubs,
            )
        }
    }
}

/**
 * The Board's read of the run's routes (the iOS RunBoardReader): the manifest first (its formats and
 * its run), then the format's board, the ADP, the capture and the clubs together, each naming the ETag
 * kept for it, so an unchanged file costs a 304 and keeps the copy. A board of another run than the
 * manifest (the pointer moved between the reads) is read again afresh, once.
 */
object RunBoardReader {
    /** `format` as the manifest names it, null for the run's default (the first it lists). */
    suspend fun read(
        reads: RunReads,
        format: String?,
        kept: RunBoardBodies?,
    ): RunBoardRead {
        val read = once(reads, format, kept)
        if (read.board.runId == read.manifestRunId) return read
        val again = once(reads, format, null)
        if (again.board.runId != again.manifestRunId) throw RunReadFailure.RunTurned()
        return again
    }

    private suspend fun once(
        reads: RunReads,
        format: String?,
        kept: RunBoardBodies?,
    ): RunBoardRead =
        coroutineScope {
            val manifest = resolve(reads.manifest(kept?.manifest?.tag), kept?.manifest)
            val formats = decodeEnvelope<RunManifestAnswer>(manifest.body).manifest.formats.map { it.id }
            val chosen = format?.takeIf { it in formats } ?: formats.firstOrNull() ?: throw RunReadFailure.NoFormat()
            val keptBoard = kept?.board?.takeIf { kept.format == chosen }
            val board = async { resolve(reads.board(chosen, keptBoard?.tag), keptBoard) }
            val adp = async { resolve(reads.adp(kept?.adp?.tag), kept?.adp) }
            val designations = async { resolve(reads.designations(kept?.designations?.tag), kept?.designations) }
            val clubs = async { resolve(reads.clubs(kept?.clubs?.tag), kept?.clubs) }
            RunBoardRead.of(RunBoardBodies(chosen, manifest, board.await(), adp.await(), designations.await(), clubs.await()))
        }

    /** A fresh answer with its ETag, or the kept copy a 304 says stands. */
    fun resolve(
        read: RunRead,
        kept: KeptBody?,
    ): KeptBody =
        when (read) {
            is RunRead.Fresh -> KeptBody(read.body, read.tag)
            is RunRead.Unchanged -> kept?.let { KeptBody(it.body, read.tag ?: it.tag) } ?: throw RunReadFailure.UnchangedWithoutCopy()
        }
}
