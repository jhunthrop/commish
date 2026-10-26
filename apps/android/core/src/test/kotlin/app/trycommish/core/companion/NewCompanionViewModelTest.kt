package app.trycommish.core.companion

import app.trycommish.api.models.CompanionHost
import app.trycommish.core.SessionEnd
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/** The companion's start page, as the iOS NewCompanionViewModelTests hold it: the verb waits on a link and,
 * by username, a name; following sends the seat and hands the draft's id to open; the replay follows the
 * recorded draft in the web's words; a refusal says the API's sentence; no connection says the web's words;
 * the drafts followed before are listed. */
@OptIn(ExperimentalCoroutinesApi::class)
class NewCompanionViewModelTest {
    private val main = StandardTestDispatcher()

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel(
        stub: StubCompanion = StubCompanion(),
        replay: Boolean = false,
    ) = NewCompanionViewModel(stub, SessionEnd {}, replay)

    @Test
    fun `the verb waits on a link and by username on a name`() {
        val vm = viewModel()
        assertFalse(vm.form.value.ready)
        vm.type("sleeper.com/draft/nfl/1")
        assertTrue(vm.form.value.ready)
        vm.seat(SeatBy.Username)
        assertFalse(vm.form.value.ready)
        vm.username("  kelley ")
        assertTrue(vm.form.value.ready)
    }

    @Test
    fun `following sends the seat and hands over the draft to open`() =
        runTest(main) {
            val stub = StubCompanion()
            val vm = viewModel(stub)
            vm.type(" sleeper.com/draft/nfl/1 ")
            vm.slot(5)
            vm.follow()?.join()
            assertEquals(CompanionFixtures.ID, vm.form.value.followed)
            val body = stub.followed.single()
            assertEquals("sleeper.com/draft/nfl/1", body.draft)
            assertEquals(5, body.seat.slot)
            assertNull(body.seat.username)
            assertNull(body.replay)
            assertEquals(CompanionHost.sleeper, body.host)
            vm.opened()
            assertNull(vm.form.value.followed)
            assertFalse(vm.form.value.busy)
        }

    @Test
    fun `the replay follows the recorded draft in the web's words`() =
        runTest(main) {
            val stub = StubCompanion()
            val vm = viewModel(stub, replay = true)
            assertEquals("The recorded draft (development replay)", vm.form.value.link)
            vm.follow()?.join()
            assertEquals(true, stub.followed.single().replay)
        }

    @Test
    fun `a refusal says the API's sentence, the field's first`() =
        runTest(main) {
            val vm = viewModel(StubCompanion(refusal = mapOf("seat" to "No seat 15.", "draft" to "That draft is an auction.")))
            vm.type("sleeper.com/draft/nfl/1")
            vm.follow()?.join()
            assertEquals("That draft is an auction.", vm.form.value.problem)
            assertNull(vm.form.value.followed)
            assertFalse(vm.form.value.busy)
        }

    @Test
    fun `no connection says the web's words`() =
        runTest(main) {
            val vm = viewModel(StubCompanion(mode = StubMode.Offline))
            vm.type("sleeper.com/draft/nfl/1")
            vm.follow()?.join()
            assertEquals(Words.CompanionNew.failed, vm.form.value.problem)
            vm.load().join()
            assertTrue(vm.form.value.recentFailed)
        }

    @Test
    fun `the followed drafts are listed`() =
        runTest(main) {
            val vm = viewModel()
            vm.load().join()
            assertEquals(
                listOf("S.U.C.K. - Severely Underrated Carolina Keepers"),
                vm.form.value.recent
                    .map { it.lead },
            )
            assertEquals(
                "slot 5 · over, the report is ready · followed Oct 25",
                vm.form.value.recent
                    .first()
                    .text,
            )
            assertEquals(SeatBy.Slot, vm.form.value.seat)
        }
}
