package app.trycommish.feature.companion

import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.companion.CompanionFixtures
import app.trycommish.core.companion.CompanionFixtures.Moment
import app.trycommish.core.companion.CompanionViewModel
import app.trycommish.core.companion.NewCompanionViewModel
import app.trycommish.core.companion.StubCompanion
import app.trycommish.core.companion.StubMode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler

/**
 * The companion's mock scenes, the iOS CompanionSnapshotTests' (Lane 210 after its fix round), each through
 * its view model over the recorded replay: the start page with a link pasted and slot 5 chosen; waiting for
 * others before the first turn (the bar, the picks as they land, the call that waits on the board); the
 * member's turn with the odds (the picks since, our call, who we would take next) and the pool under it; the
 * pick marked on the strip once it lands, with the team; the wall through round 2 with the pick on the
 * clock; the report's head, its pick by pick and its runs; and the stale state, the last picks kept with the
 * reconnecting line and their stamp.
 */
enum class CompanionScene(
    val id: String,
    val moments: List<Moment>,
    val parts: Set<CompanionPart> = CompanionPart.entries.toSet(),
    val report: ReportPart? = null,
) {
    New("new", listOf(Moment.Waiting)),
    Waiting("waiting", listOf(Moment.Waiting)),
    Turn("turn", CompanionFixtures.through(Moment.Turn), setOf(CompanionPart.Strips, CompanionPart.Call)),
    TurnPool("turn-pool", CompanionFixtures.through(Moment.Turn), setOf(CompanionPart.Pool)),
    Marked("marked", CompanionFixtures.through(Moment.Taken), setOf(CompanionPart.Strips, CompanionPart.Call, CompanionPart.Team)),
    Wall("wall", CompanionFixtures.through(Moment.Taken), setOf(CompanionPart.Wall)),
    ReportHead("report-head", CompanionFixtures.through(Moment.Complete), report = ReportPart.Head),
    ReportPicks("report-picks", CompanionFixtures.through(Moment.Complete), report = ReportPart.Picks),
    ReportRuns("report-runs", CompanionFixtures.through(Moment.Complete), report = ReportPart.Runs),
    Stale("stale", CompanionFixtures.through(Moment.Between)),
}

/** The scene's view models, read through the stub on the test scheduler at the replay's clock. */
internal class SceneReads(
    private val scheduler: TestCoroutineScheduler,
) {
    private val scope = CoroutineScope(StandardTestDispatcher(scheduler))

    /** One read, as the poll makes it. */
    private fun CompanionViewModel.launchLoad() {
        scope.launch { load() }
    }

    fun room(scene: CompanionScene): CompanionViewModel {
        val stub = StubCompanion(scene.moments)
        val vm =
            CompanionViewModel(
                CompanionFixtures.ID,
                stub,
                MemoryCache(),
                FixedClock(CompanionFixtures.readAt),
                CompanionFixtures.zone,
                SessionEnd {},
            )
        scene.moments.forEach { _ ->
            vm.launchLoad()
            scheduler.advanceUntilIdle()
        }
        if (scene == CompanionScene.Stale) {
            stub.mode = StubMode.Offline
            vm.launchLoad()
            scheduler.advanceUntilIdle()
        }
        return vm
    }

    fun start(): NewCompanionViewModel {
        val vm = NewCompanionViewModel(StubCompanion(), SessionEnd {})
        vm.load()
        scheduler.advanceUntilIdle()
        vm.type("sleeper.com/draft/nfl/1382163311050645504")
        vm.slot(SLOT)
        return vm
    }

    private companion object {
        const val SLOT = 5
    }
}
