package app.trycommish.feature.reference

import app.trycommish.api.models.RunGameState
import app.trycommish.core.Cache
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.liveorder.OneValueFixture
import app.trycommish.core.liveorder.OrderReader
import app.trycommish.core.liveorder.OrderShare
import app.trycommish.core.liveorder.StubOrderSearch
import app.trycommish.core.player.StubPages
import app.trycommish.core.reference.AdpModel
import app.trycommish.core.reference.Built
import app.trycommish.core.reference.ClubFiles
import app.trycommish.core.reference.ClubPageModel
import app.trycommish.core.reference.ClubScreens
import app.trycommish.core.reference.ClubsModel
import app.trycommish.core.reference.CompareModel
import app.trycommish.core.reference.CompareReader
import app.trycommish.core.reference.ReferenceReads
import app.trycommish.core.reference.RunScreenState
import app.trycommish.core.reference.RunScreenViewModel
import app.trycommish.core.reference.ScheduleModel
import app.trycommish.core.reference.scheduleModel
import kotlinx.coroutines.test.TestCoroutineScheduler
import java.time.Instant

/**
 * The reference screens' mock scenes, the iOS ReferenceSnapshotTests' (Lane 199 after its fix round), each
 * through its view model over a fixture run at the run's clock. Before the draft, the stand-in
 * (shared/fixtures/standin-run): ADP's top with the Gap, Compare with two players and its call, the clubs
 * index, a club's page (CIN). In season, the contract run (shared/fixtures/run): ADP with the run's three
 * format chips and no Gap, Compare with one side a slug the run does not name, the schedule's rest of
 * season grid with its played weeks set back, and ADP saved and read with no signal, stale with its reason.
 */
enum class ReferenceScene(
    val id: String,
    val inSeason: Boolean,
) {
    AdpTop("adp-top", false),
    AdpInSeason("adp-inseason", true),
    CompareTwo("compare-two", false),
    CompareAbsent("compare-absent", true),
    Clubs("clubs", false),
    Club("club", false),

    /** In season: a club whose bye is played (KC, week 5), its schedule saying week 6's games as the run read them. */
    ClubInSeason("club-inseason", true),

    /** In season, the Bye row with both byes ahead (BUF 7, GB 11 before the week 7 board). */
    CompareByeAhead("compare-bye-ahead", true),

    /** In season, the Bye row with one bye played (DET 6), its cell blank. */
    CompareByePlayed("compare-bye-played", true),
    Schedule("schedule", true),

    /** In season, the run read on week 6's Sunday morning: each game still to come says its kickoff with its day
     * and zone, the longest word the grid draws (Lane 231 review H1). */
    ScheduleUpcoming("schedule-upcoming", true),
    Stale("stale", true),

    /** In season at the order's clock (Lane 226, the iOS reference-club-clock): CHI on the one-value
     * stand-in at the Sunday clock, its rows the order's under the order's head and lead. */
    ClubClock("club-clock", true),

    /** The same club while the order is unread: the run's rows with the run's stamp. */
    ClubClockUnread("club-clock-unread", true),

    /** In season at the order's clock: Swift and Washington, the pair the order's. */
    CompareClock("compare-clock", true),

    /** The same pair while the order is unread: both sides the run's, the basis with the run's stamp. */
    CompareClockUnread("compare-clock-unread", true),
    ;

    /** The scenes on the one-value stand-in, read at the order's clock or with the order unread. */
    val clock: Boolean get() = this in setOf(ClubClock, ClubClockUnread, CompareClock, CompareClockUnread)

    /** A clock scene whose order does not answer. */
    val unread: Boolean get() = this == ClubClockUnread || this == CompareClockUnread

    val fixture: RunFixture
        get() =
            when {
                clock -> RunFixture.OneValue
                inSeason -> RunFixture.Contract
                else -> RunFixture.StandIn
            }

    val now: Instant
        get() =
            when {
                clock -> OneValueFixture.now
                inSeason -> RunFixture.inSeason
                else -> RunFixture.preDraft
            }
}

/** A scene's view model read, through the stub at the scene's clock (`offline` with no signal). */
internal class SceneReads(
    private val scene: ReferenceScene,
    private val scheduler: TestCoroutineScheduler,
) {
    private val zone = RunFixture.zone

    private fun reads(
        cache: Cache = MemoryCache(),
        offline: Boolean = false,
        at: Instant = scene.now,
    ) = ReferenceReads(
        StubRunReads(scene.fixture, offline = offline),
        StubPages(scene.fixture, offline = offline),
        cache,
        FixedClock(at),
    )

    /** A clock scene's order over the fixture's Sunday read, failing every read while the scene is unread;
     * none for another scene. */
    private fun orders(): OrderReader? =
        if (scene.clock) OrderReader(OrderShare(StubOrderSearch(offline = scene.unread), FixedClock(scene.now))) else null

    private fun <Model> loaded(vm: RunScreenViewModel<Model>): RunScreenViewModel<Model> {
        vm.load()
        scheduler.advanceUntilIdle()
        check(vm.state.value is RunScreenState.Loaded) { "${scene.id}: ${vm.state.value}" }
        return vm
    }

    fun adp(): RunScreenViewModel<AdpModel> {
        if (scene != ReferenceScene.Stale) return loaded(AdpModel.viewModel(null, reads(), zone, SessionEnd {}))
        val cache = MemoryCache()
        loaded(AdpModel.viewModel(null, reads(cache), zone, SessionEnd {}))
        return loaded(AdpModel.viewModel(null, reads(cache, offline = true, at = scene.now.plusSeconds(HALF_HOUR)), zone, SessionEnd {}))
    }

    fun compare(): RunScreenViewModel<CompareModel> {
        val slugs =
            when (scene) {
                ReferenceScene.CompareTwo -> listOf("ja-marr-chase", "rome-odunze")
                ReferenceScene.CompareByeAhead -> listOf("josh-allen", "josh-jacobs")
                ReferenceScene.CompareByePlayed -> listOf("jahmyr-gibbs", "josh-jacobs")
                ReferenceScene.CompareClock, ReferenceScene.CompareClockUnread -> listOf("d-andre-swift", "parker-washington")
                else -> listOf("jahmyr-gibbs", "nobody")
            }
        return loaded(CompareReader.viewModel(slugs, null, reads(), zone, SessionEnd {}, orders()))
    }

    fun clubs(): RunScreenViewModel<ClubsModel> = loaded(ClubScreens.clubs(reads(), zone, SessionEnd {}, orders()))

    fun club(): RunScreenViewModel<ClubPageModel> {
        val abbr =
            when (scene) {
                ReferenceScene.ClubInSeason -> "kc"
                ReferenceScene.ClubClock, ReferenceScene.ClubClockUnread -> "chi"
                else -> "cin"
            }
        return loaded(ClubScreens.club(abbr, reads(), zone, SessionEnd {}, orders()))
    }

    fun schedule(): RunScreenViewModel<ScheduleModel> {
        if (scene != ReferenceScene.ScheduleUpcoming) return loaded(ClubScreens.schedule(reads(), zone, SessionEnd {}))
        return loaded(
            RunScreenViewModel(reads(), zone, SessionEnd {}, null) { r ->
                val files = beforeKickoff(ClubFiles.read(r, sources = false), UPCOMING_WEEK)
                Built(scheduleModel(files, zone), files.manifest.manifest, files.reads)
            },
        )
    }

    private companion object {
        const val HALF_HOUR = 1800L
    }
}

/** A loaded view model's model. */
internal fun <Model> RunScreenViewModel<Model>.model(): Model {
    val loaded = state.value
    check(loaded is RunScreenState.Loaded) { "$loaded" }
    return loaded.model
}

/** The week the upcoming scene reads before its games. */
internal const val UPCOMING_WEEK = 6

/** The run's files as a read on the Sunday morning of `week` would hold them: the Thursday game final, every
 * other game of that week still to kick off, so its cell says its kickoff (a scene-local override of the
 * fixture's schedule, which read every one as kicked off). */
internal fun beforeKickoff(
    files: ClubFiles,
    week: Int,
): ClubFiles {
    val slates =
        files.schedule.slates.map { slate ->
            slate.copy(
                games =
                    slate.games.map {
                        if (it.week == week &&
                            it.state == RunGameState.kicked_off
                        ) {
                            it.copy(state = RunGameState.upcoming)
                        } else {
                            it
                        }
                    },
            )
        }
    return ClubFiles(
        files.manifest,
        files.clubs,
        files.schedule.copy(slates = slates),
        files.board,
        files.capture,
        files.sources,
        files.underway,
        files.played,
        files.reads,
    )
}
