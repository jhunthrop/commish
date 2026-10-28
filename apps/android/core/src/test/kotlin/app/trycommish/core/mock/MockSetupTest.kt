package app.trycommish.core.mock

import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.League
import app.trycommish.api.models.Lineup
import app.trycommish.api.models.Scoring
import app.trycommish.api.models.ScoringPreset
import app.trycommish.api.models.ScoringRules
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.SiteLinks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.UUID

/**
 * The setup starts what it shows and starts from the member's context as the web's does (the iOS
 * MockSetupSeedTests): the context's format, and the saved league the link or the selected league names,
 * drafted as saved while the form holds it; and the site's mock links open the mock in the app.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MockSetupTest {
    private val main = StandardTestDispatcher()

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun idle() = main.scheduler.advanceUntilIdle()

    @Test
    fun `the setup starts what it shows`() {
        val stub = StubMock()
        val setup = MockSetupViewModel(stub)
        setup.chooseTeams(14)
        setup.chooseSlot(14)
        setup.chooseTeams(10)
        assertNull(setup.form.value.settings.slot)
        setup.chooseSlot(7)
        setup.choose(Lineup.superflex)
        setup.choose(ScoringPreset.half_ppr)
        setup.start()
        idle()
        assertEquals(MockFixtures.room(MockFixtures.Answer.Create).id.toString(), setup.form.value.started)
        val sent = requireNotNull(stub.created.first().settings)
        assertEquals(10, sent.teams)
        assertEquals(7, sent.slot)
        assertEquals("10 teams · half PPR · superflex", MockWords.formatLine(sent))
        assertEquals(11, setup.form.value.slots.size)
    }

    @Test
    fun `try another slot starts from the draft's settings with its slot let go`() {
        val report = MockFixtures.report()
        val setup = MockSetupViewModel(StubMock(), from = report.settings)
        assertNull(setup.form.value.settings.slot)
        assertEquals(report.settings.teams, setup.form.value.settings.teams)
    }

    @Test
    fun `a start that does not go says the API's sentence`() {
        val stub = StubMock().apply { offline = true }
        val setup = MockSetupViewModel(stub)
        setup.start()
        idle()
        assertEquals(app.trycommish.design.Words.Mock.unreachablePhone, setup.form.value.problem)
        assertNull(setup.form.value.started)
    }

    @Test
    fun `a half PPR member starts in half PPR`() {
        val form = MockSetupViewModel(StubMock(), seed = MockSetupSeed(format = BoardFormat.half_ppr)).form.value
        assertEquals(ScoringPreset.half_ppr, form.settings.scoring.preset)
        assertEquals(Lineup.standard, form.settings.lineup)
    }

    @Test
    fun `a rerun keeps its own settings over the format`() {
        val from = MockSetup.defaults().copy(teams = 8)
        val form = MockSetupViewModel(StubMock(), from = from, seed = MockSetupSeed(format = BoardFormat.half_ppr)).form.value
        assertEquals(ScoringPreset.ppr, form.settings.scoring.preset)
        assertEquals(8, form.settings.teams)
    }

    @Test
    fun `the saved league opens and is drafted as saved`() {
        val stub = StubMock().apply { saved = listOf(saved()) }
        val setup = MockSetupViewModel(stub, seed = MockSetupSeed(format = BoardFormat.ppr, league = SAVED))
        setup.load()
        idle()
        assertEquals(
            SAVED,
            setup.form.value.opened
                ?.id
                .toString(),
        )
        assertEquals(10, setup.form.value.settings.teams)
        assertEquals(Lineup.superflex, setup.form.value.settings.lineup)
        setup.start()
        idle()
        assertEquals(
            SAVED,
            stub.created
                .first()
                .leagueId
                .toString(),
        )
        assertNull(stub.created.first().settings)
    }

    @Test
    fun `another choice lets the saved league go and drafts the form`() {
        val stub = StubMock().apply { saved = listOf(saved()) }
        val setup = MockSetupViewModel(stub, seed = MockSetupSeed(league = SAVED))
        setup.load()
        idle()
        setup.chooseTeams(12)
        assertNull(setup.form.value.opened)
        setup.start()
        idle()
        assertNull(stub.created.first().leagueId)
        assertEquals(
            12,
            stub.created
                .first()
                .settings
                ?.teams,
        )
    }

    @Test
    fun `another slot drafts the league's settings from that slot`() {
        val stub = StubMock().apply { saved = listOf(saved()) }
        val setup = MockSetupViewModel(stub, seed = MockSetupSeed(league = SAVED))
        setup.load()
        idle()
        setup.chooseSlot(7)
        assertEquals(
            SAVED,
            setup.form.value.opened
                ?.id
                .toString(),
        )
        setup.start()
        idle()
        assertNull(stub.created.first().leagueId)
        assertEquals(
            7,
            stub.created
                .first()
                .settings
                ?.slot,
        )
        assertEquals(
            10,
            stub.created
                .first()
                .settings
                ?.teams,
        )
    }

    @Test
    fun `a league's own rules draft on the nearest preset without custom scoring`() {
        val stub = StubMock().apply { saved = listOf(saved(reception = 0.5)) }
        val setup = MockSetupViewModel(stub, seed = MockSetupSeed(league = SAVED))
        setup.load()
        idle()
        assertEquals(ScoringPreset.half_ppr, setup.form.value.settings.scoring.preset)
        setup.start()
        idle()
        assertNull(stub.created.first().leagueId)
        assertEquals(
            ScoringPreset.half_ppr,
            stub.created
                .first()
                .settings
                ?.scoring
                ?.preset,
        )
    }

    @Test
    fun `a league the account does not have leaves the form`() {
        val setup = MockSetupViewModel(StubMock(), seed = MockSetupSeed(format = BoardFormat.standard, league = "gone"))
        setup.load()
        idle()
        assertNull(setup.form.value.opened)
        assertEquals(ScoringPreset.standard, setup.form.value.settings.scoring.preset)
    }

    @Test
    fun `a chip chosen before the league is read is never undone, and a second load reads nothing`() {
        val stub = StubMock().apply { saved = listOf(saved()) }
        val setup = MockSetupViewModel(stub, seed = MockSetupSeed(league = SAVED))
        setup.load()
        setup.chooseTeams(14)
        idle()
        assertEquals(14, setup.form.value.settings.teams)
        assertNull(setup.load())
    }

    @Test
    fun `a shared mock's run signs out on a refused token`() {
        var ends = 0
        val stub = StubMock(MockFixtures.Answer.SharedRound5).apply { createSignedOut = true }
        val vm = SharedMockViewModel("code", stub) { ends++ }
        vm.load()
        idle()
        vm.run {}
        idle()
        assertEquals(1, ends)
        assertNull(vm.problem.value)
    }

    @Test
    fun `the site's mock links open in the app`() {
        val site = SiteLinks.ORIGIN
        assertEquals(ShellRoute.MockSetup(), SiteLinks.mock("$site/mock/new"))
        assertEquals(ShellRoute.MockSetup(), SiteLinks.mock("$site/mock"))
        assertEquals(ShellRoute.MockSetup(), SiteLinks.mock(SiteLinks.MOCK_SETUP))
        assertEquals(ShellRoute.MockSetup("saved-1"), SiteLinks.mock("$site/mock/new?league=saved-1"))
        assertEquals(ShellRoute.MockSetup(), SiteLinks.mock("$site/mock/new?league="))
        assertEquals(ShellRoute.SharedMock("abc"), SiteLinks.mock(MockRoomViewModel.shareLink("abc")))
        assertNull(SiteLinks.mock("$site/mock/some-id"))
        assertNull(SiteLinks.mock("$site/board"))
    }

    private fun saved(reception: Double? = null): League {
        val base = MockSetup.defaults().copy(teams = 10, slot = 3, lineup = Lineup.superflex)
        val settings = reception?.let { base.copy(scoring = Scoring(custom = rules(it))) } ?: base
        return League(UUID.fromString(SAVED), "Home league", settings, ROUNDS, MADE, MADE)
    }

    @Suppress("MagicNumber") // A league's own rules, as the API writes them.
    private fun rules(reception: Double) =
        ScoringRules(
            pointsPerPassingYard = 0.04,
            pointsPerPassingTouchdown = 4.0,
            pointsPerInterception = -2.0,
            pointsPerRushingYard = 0.1,
            pointsPerRushingTouchdown = 6.0,
            pointsPerReceivingYard = 0.1,
            pointsPerReceivingTouchdown = 6.0,
            pointsPerReception = reception,
            pointsPerFumbleLost = -2.0,
            teReceptionBonus = 0.0,
            pointsPerFieldGoal = 3.0,
            pointsPerExtraPoint = 1.0,
            pointsPerSack = 1.0,
            pointsPerDefensiveInterception = 2.0,
            pointsPerDefensiveTouchdown = 6.0,
            pointsPerTwoPointConversion = 2.0,
            pointsPerFieldGoalMissed = 0.0,
            pointsPerExtraPointMissed = 0.0,
            pointsPerReturnTouchdown = 6.0,
            pointsPerDefensiveFumbleRecovery = 2.0,
            pointsPerSafety = 2.0,
        )

    private companion object {
        const val SAVED = "6f1d1c52-0000-4000-8000-000000000214"
        const val ROUNDS = 15
        const val MADE = "2026-10-25T21:00:00Z"
    }
}
