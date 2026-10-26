package app.trycommish.feature.reference

import app.trycommish.core.Cache
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.player.StubPages
import app.trycommish.core.reference.AdpModel
import app.trycommish.core.reference.ClubPageModel
import app.trycommish.core.reference.ClubScreens
import app.trycommish.core.reference.ClubsModel
import app.trycommish.core.reference.CompareModel
import app.trycommish.core.reference.CompareReader
import app.trycommish.core.reference.ReferenceReads
import app.trycommish.core.reference.RunScreenState
import app.trycommish.core.reference.RunScreenViewModel
import app.trycommish.core.reference.ScheduleModel
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
    Stale("stale", true),
    ;

    val fixture: RunFixture get() = if (inSeason) RunFixture.Contract else RunFixture.StandIn

    val now: Instant get() = if (inSeason) RunFixture.inSeason else RunFixture.preDraft
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
                else -> listOf("jahmyr-gibbs", "nobody")
            }
        return loaded(CompareReader.viewModel(slugs, null, reads(), zone, SessionEnd {}))
    }

    fun clubs(): RunScreenViewModel<ClubsModel> = loaded(ClubScreens.clubs(reads(), zone, SessionEnd {}))

    fun club(): RunScreenViewModel<ClubPageModel> =
        loaded(ClubScreens.club(if (scene == ReferenceScene.ClubInSeason) "kc" else "cin", reads(), zone, SessionEnd {}))

    fun schedule(): RunScreenViewModel<ScheduleModel> = loaded(ClubScreens.schedule(reads(), zone, SessionEnd {}))

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
