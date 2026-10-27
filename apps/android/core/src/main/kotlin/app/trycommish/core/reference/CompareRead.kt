package app.trycommish.core.reference

import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunIndexEntry
import app.trycommish.api.models.RunManifestAnswer
import app.trycommish.api.models.RunPlayer
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.RunReadFailure
import app.trycommish.core.board.RunWords
import app.trycommish.core.liveorder.OrderAtClock
import app.trycommish.core.liveorder.OrderReader
import app.trycommish.core.player.PageSource
import app.trycommish.core.player.ReadStamp
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.headshotOf
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.time.ZoneId

/** What Compare is asked for: the two sides by their pages' slugs (the web's ?a= and ?b=) and the format. */
data class CompareAsk(
    val slugs: List<String?>,
    /** The format as the manifest names it; null for the followed league's where the run carries it, else
     * the run's default. */
    val format: String?,
    /** The followed league's board as the run names it ("half-ppr-12"), null with none. */
    val leagueFormat: String?,
) {
    fun with(
        slot: Int,
        slug: String?,
    ): CompareAsk = copy(slugs = slugs.mapIndexed { index, it -> if (index == slot) slug else it })

    fun with(format: String): CompareAsk = copy(format = format)

    companion object {
        /** format-ids.ts runFormatId: "half_ppr" at 12 teams is the run's "half-ppr-12". */
        fun runFormat(league: FollowedLeague?): String? = league?.format?.let { "${it.value.replace('_', '-')}-12" }
    }
}

/** Compare's reads: the manifest, the index, the ADP's sources, the clubs, the schedule and the capture, then
 * each side's page as the web's reader finds it. */
object CompareReader {
    /** A side as read: what it found, his own page where the run gave one (its season counts toward the
     * reach), and the reads it took. */
    private class ReadSide(
        val found: CompareFound,
        val page: RunPlayer?,
        val reads: List<ReadStamp>,
    )

    fun build(
        ask: CompareAsk,
        zone: ZoneId,
    ): ScreenBuild<CompareModel> =
        { reads ->
            coroutineScope {
                val manifest = reads.manifest()
                val index = async { reads.index() }
                val sources = async { reads.sources() }
                val clubs = async { reads.clubs() }
                val schedule = async { reads.schedule() }
                val capture = async { reads.designations() }
                val formats = manifest.value.manifest.formats
                val chosen = listOfNotNull(ask.format, ask.leagueFormat).firstOrNull { id -> formats.any { it.id == id } }
                val format = formats.firstOrNull { it.id == chosen } ?: formats.firstOrNull() ?: throw RunReadFailure.NoFormat()
                val indexRead = index.await()
                val captureRead = capture.await()
                val scheduleRead = schedule.await()
                val sides = ask.slugs.map { side(it, reads, indexRead.value, manifest.value) }
                val pages = sides.mapNotNull { it.page }
                val season = manifest.value.manifest.season
                val (complete, completeReads) = completeWeek(pages, reads, indexRead.value, manifest.value)
                val scoring =
                    pages.firstOrNull()?.let { page -> formats.firstOrNull { it.id == page.season.format } }?.label ?: format.label
                val input =
                    CompareInput(
                        manifest = manifest.value.manifest,
                        format = format,
                        sources = sources.await().value,
                        clubs = clubs.await().value,
                        underway = SeasonReach.underway(manifest.value.manifest, scheduleRead.value),
                        reach = if (heldSide(sides)) Reach.NONE else SeasonReach.counted(pages, scheduleRead.value.slates, complete),
                        scoring = scoring,
                        index = indexRead.value,
                        sides = found(sides, captureRead?.value, season),
                        zone = zone,
                    )
                val stamps =
                    listOf(manifest.at, indexRead.at, sources.await().at, clubs.await().at, scheduleRead.at) +
                        listOfNotNull(captureRead?.at) + sides.flatMap { it.reads } + completeReads
                Built(CompareModel.of(input), manifest.value.manifest, stamps) { reader -> atClock(input, reader) }
            }
        }

    /** The pair at the order's clock: each side read by his name, as the web's Compare reads the pair;
     * null before the season, where a read fails or the order does not place both. */
    private suspend fun atClock(
        input: CompareInput,
        reader: OrderReader,
    ): CompareModel? {
        if (input.format.rosFromWeek == null || input.names.size != 2) return null
        val reads = input.names.map { reader.readOrNull(search = it) ?: return null }
        val order = OrderAtClock.merged(reads) ?: return null
        return CompareModel.of(input.copy(order = order)).takeIf { it.atClock }
    }

    /** Each side found, a player with his status on the capture and last season's line. */
    private fun found(
        sides: List<ReadSide>,
        capture: RunDesignations?,
        season: Int,
    ): List<CompareFound> {
        val statuses = capture?.players.orEmpty()
        return sides.map { side ->
            val found = side.found
            if (found is CompareFound.Player) CompareFound.Player(found.player.with(statuses[found.player.id], season)) else found
        }
    }

    /** A side read from a held copy or the board has no log of his own to count, so the basis names no week
     * rather than one his cells may pass (Lane 199 review L1). */
    private fun heldSide(sides: List<ReadSide>): Boolean = sides.any { it.found is CompareFound.Player && it.page == null }

    /** The run's complete week: an own page's through week, the run's first own page's when neither side has one. */
    private suspend fun completeWeek(
        pages: List<RunPlayer>,
        reads: ReferenceReads,
        index: List<RunIndexEntry>,
        manifest: RunManifestAnswer,
    ): Pair<Int, List<ReadStamp>> {
        pages.firstOrNull()?.let { return it.season.through to emptyList() }
        val (complete, stamps) = reads.complete(index, manifest)
        return (complete ?: 0) to stamps
    }

    /** A side by its slug: nobody asked, a slug the index does not name (or a page the run cannot give), or
     * his page as the web's reader finds it. */
    private suspend fun side(
        slug: String?,
        reads: ReferenceReads,
        index: List<RunIndexEntry>,
        manifest: RunManifestAnswer,
    ): ReadSide {
        slug ?: return ReadSide(CompareFound.Open, null, emptyList())
        val entry = index.firstOrNull { it.slug == slug } ?: return ReadSide(CompareFound.Missing, null, emptyList())
        val (source, stamps) = reads.lookup.source(entry, manifest)
        return when (source) {
            is PageSource.Page -> ReadSide(CompareFound.Player(comparePlayer(source.player, entry)), source.player, stamps)
            is PageSource.Copy -> ReadSide(CompareFound.Player(comparePlayer(source.player, entry)), null, stamps)
            is PageSource.Facts -> {
                val player =
                    comparePlayer(
                        source.entry,
                        source.row,
                        manifest.manifest.formats
                            .firstOrNull()
                            ?.id,
                    )
                ReadSide(CompareFound.Player(player), null, stamps)
            }
            null -> ReadSide(CompareFound.Missing, null, stamps)
        }
    }

    fun comparePlayer(
        player: RunPlayer,
        entry: RunIndexEntry,
    ): ComparePlayer =
        ComparePlayer(
            id = player.id,
            slug = player.slug,
            name = player.name,
            position = player.position.value,
            team = player.team,
            headshot = headshotOf(player.headshot),
            formats = player.formats.mapValues { CompareNumbers.of(it.value) },
            status = null,
            seasonSoFar = SeasonSoFar(entry.season.games, entry.season.pointsPerGame?.toDouble()),
            lastSeasonPerGame = null,
            priorSeasons = player.priorSeasons.orEmpty(),
        )

    /** A held page with no copy: the board's figures in the leading format and no earlier season. */
    private fun comparePlayer(
        entry: RunIndexEntry,
        row: RunBoardRow,
        format: String?,
    ): ComparePlayer =
        ComparePlayer(
            id = entry.id,
            slug = entry.slug,
            name = entry.name,
            position = entry.position.value,
            team = entry.team,
            headshot = headshotOf(entry.headshot),
            formats = format?.let { mapOf(it to CompareNumbers.of(row)) }.orEmpty(),
            status = null,
            seasonSoFar = SeasonSoFar(entry.season.games, entry.season.pointsPerGame?.toDouble()),
            lastSeasonPerGame = null,
            priorSeasons = emptyList(),
        )

    /** Compare with the sides the address sets (its ?a= and ?b=, the pages' slugs), in the followed league's
     * format where the run carries it; `orders` reads the order in season, the pair drawn again at its
     * clock. */
    fun viewModel(
        slugs: List<String?>,
        league: FollowedLeague?,
        reads: ReferenceReads,
        zone: ZoneId,
        sessionEnd: SessionEnd,
        orders: OrderReader? = null,
    ): RunScreenViewModel<CompareModel> =
        RunScreenViewModel(reads, zone, sessionEnd, orders, build(CompareAsk(slugs, null, CompareAsk.runFormat(league)), zone))
}

/** The member's newest ask: the one in flight, else the screen shown's. */
private fun RunScreenViewModel<CompareModel>.compareAsk(): CompareAsk? {
    (ask.value as? ScreenAsk.Compare)?.let { return it.ask }
    val model = (state.value as? RunScreenState.Loaded)?.model ?: return null
    return CompareAsk(model.slugs, model.format, null)
}

/** A player picked for a side (0 the first, 1 the second), or the side cleared with null. */
fun RunScreenViewModel<CompareModel>.choose(
    slot: Int,
    slug: String?,
): Job? {
    val current = compareAsk()?.takeIf { slot in it.slugs.indices } ?: return null
    val wanted = current.with(slot, slug)
    return rebuild(CompareReader.build(wanted, zone), ScreenAsk.Compare(wanted))
}

/** A format chip: the same two in that format. */
fun RunScreenViewModel<CompareModel>.chooseFormat(format: String): Job? {
    val current = compareAsk()?.takeIf { it.format != format } ?: return null
    val model = (state.value as? RunScreenState.Loaded)?.model ?: return null
    val wanted = current.with(format)
    val label = model.formats.firstOrNull { it.value == format }?.label ?: format
    return rebuild(CompareReader.build(wanted, zone), ScreenAsk.Compare(wanted), RunWords.absent(label))
}

/** The format the member last chose, pressed on the chips while its read is in flight. */
fun RunScreenViewModel<CompareModel>.chosenFormat(): String? = compareAsk()?.format
