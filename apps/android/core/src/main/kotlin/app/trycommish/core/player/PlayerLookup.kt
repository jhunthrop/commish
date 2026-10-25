package app.trycommish.core.player

import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.PlayerWeek
import app.trycommish.api.models.RunAdpAnswer
import app.trycommish.api.models.RunAdpSource
import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunClubsAnswer
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunDesignationsAnswer
import app.trycommish.api.models.RunHeldAnswer
import app.trycommish.api.models.RunHeldPage
import app.trycommish.api.models.RunIndexAnswer
import app.trycommish.api.models.RunIndexEntry
import app.trycommish.api.models.RunManifestAnswer
import app.trycommish.api.models.RunPlayerAnswer
import app.trycommish.api.models.RunSchedule
import app.trycommish.api.models.RunScheduleAnswer
import app.trycommish.core.board.RunReadFailure
import app.trycommish.core.board.RunReads
import app.trycommish.core.shell.FollowedLeague
import kotlinx.coroutines.CancellationException

/**
 * A player's page in the run, found as the web's reader finds it (server/run.ts playerRead): the run's
 * index names him by his slug; his own page; for a page the nightly held, an earlier run's copy, or with
 * none his figures from the leading format's board; null for a player the run gives no page. Every file
 * through [RunFiles], each naming its kept ETag.
 */
class PlayerLookup(
    private val files: RunFiles,
    private val run: RunReads,
    private val pages: PlayerPageReads,
) {
    /** The run's index, and his entry by his page's slug. */
    suspend fun entry(slug: String): Pair<Read<List<RunIndexEntry>>, RunIndexEntry?> {
        val index = files.read("/run/index", { decodeEnvelope<RunIndexAnswer>(it).pages }, pages::index)
        return index to index.value.firstOrNull { it.slug == slug }
    }

    /** His page as the run serves it, and the reads it took. */
    suspend fun source(
        entry: RunIndexEntry,
        manifest: RunManifestAnswer,
    ): Pair<PageSource?, List<ReadStamp>> {
        val id = entry.id
        val route = "/run/players/$id"
        return try {
            var page = files.read(route, { decodeEnvelope<RunPlayerAnswer>(it) }) { tag -> pages.page(id, tag) }
            // A page of another run than the manifest (the pointer moved between the reads) is read again
            // afresh, once, as the Board's reader reads its board (RunBoardReader.read).
            if (page.at.saved == null && page.value.runId != manifest.runId) {
                page = files.read(route, { decodeEnvelope<RunPlayerAnswer>(it) }) { pages.page(id, null) }
                if (page.value.runId != manifest.runId) throw RunReadFailure.RunTurned()
            }
            PageSource.Page(page.value.player) to listOf(page.at)
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (!RunFiles.refused(e)) throw e
            held(entry, manifest)
        }
    }

    /** A page the run held: an earlier run's copy, or the leading board's figures alone. */
    private suspend fun held(
        entry: RunIndexEntry,
        manifest: RunManifestAnswer,
    ): Pair<PageSource?, List<ReadStamp>> {
        val id = entry.id
        val held = files.read("/run/held", { decodeEnvelope<RunHeldAnswer>(it).held?.pages.orEmpty() }, pages::held)
        val page: RunHeldPage = held.value.firstOrNull { it.id == id } ?: return null to listOf(held.at)
        val copy = page.copy
        if (copy != null) {
            val read = files.read("/run/held/$id", { decodeEnvelope<RunPlayerAnswer>(it).player }) { tag -> pages.heldCopy(id, tag) }
            return PageSource.Copy(read.value, copy) to listOf(held.at, read.at)
        }
        val format =
            manifest.manifest.formats
                .firstOrNull()
                ?.id ?: return null to listOf(held.at)
        val board = board(format)
        return board.value.rows
            .firstOrNull { it.id == id }
            ?.let { PageSource.Facts(entry, it) } to listOf(held.at, board.at)
    }

    suspend fun manifest(): Read<RunManifestAnswer> = files.read("/run/manifest", { decodeEnvelope<RunManifestAnswer>(it) }, run::manifest)

    suspend fun designations(): Read<RunDesignations?> =
        files.read("/run/designations", { decodeEnvelope<RunDesignationsAnswer>(it).designations }, run::designations)

    suspend fun board(format: String): Read<RunBoardAnswer> =
        files.read("/run/boards/$format", { decodeEnvelope<RunBoardAnswer>(it) }) { tag -> run.board(format, tag) }

    suspend fun sources(): Read<List<RunAdpSource>> = files.read("/run/adp", { decodeEnvelope<RunAdpAnswer>(it).adp.sources }, run::adp)

    suspend fun clubs(): Read<List<RunClub>> = files.read("/run/clubs", { decodeEnvelope<RunClubsAnswer>(it).clubs }, run::clubs)

    suspend fun schedule(): Read<RunSchedule> =
        files.read("/run/schedule", { decodeEnvelope<RunScheduleAnswer>(it).schedule }, pages::schedule)
}

/** His week as his card reads it (live.ts readWeek): the member's league's read with a league, the public
 * read without one or when the league's cannot answer for him; a refused token signs out. */
class WeekReader(
    private val weeks: PlayerWeekReads,
    private val files: AnswerFiles,
) {
    /** His week and whether it was read in the league. */
    suspend fun read(
        player: String,
        league: FollowedLeague?,
    ): Pair<Read<PlayerWeek>, Boolean> {
        if (league != null) {
            try {
                val week =
                    files.read(
                        "/leagues/attached/${league.id}/players/$player",
                        ::decodeWeek,
                    ) { weeks.leagueWeek(league.id, player) }
                return week to true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught", "SwallowedException") e: Exception,
            ) {
                // The public read stands in, as the web's card does.
            }
        }
        return files.read("/players/$player/week", ::decodeWeek) { weeks.publicWeek(player) } to false
    }

    private fun decodeWeek(body: String): PlayerWeek = decodeEnvelope(body)
}
