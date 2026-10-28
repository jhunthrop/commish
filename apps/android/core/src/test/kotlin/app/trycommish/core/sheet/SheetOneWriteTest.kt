package app.trycommish.core.sheet

import app.trycommish.api.models.BoardFormat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * One write at a time and one sheet for the tab (Lane 267 review M1, M2, L3): a second Try again while one
 * is on its way sends nothing, an edit made while a retry reads is written by the retry, a read older than
 * the copy shown is not drawn, an edit taken back stops the head saying not saved, and the league shown
 * changing moves only the empty sheet's start, never the sheet or its unsaved edits.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SheetOneWriteTest {
    private val main = StandardTestDispatcher()

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.offlineEdit(): Pair<SheetStub, SheetViewModel> {
        val stub = SheetStub(sheetDetail(parityRows()))
        val vm = sheetViewModel(stub, main)
        vm.load()
        settle()
        stub.offline = true
        vm.setNote("4689114", "Stash")
        settle()
        stub.offline = false
        return stub to vm
    }

    @Test
    fun `a second Try again while one is on its way sends nothing`() =
        runTest(main) {
            val (stub, vm) = offlineEdit()
            assertNotNull(vm.retry())
            assertTrue(vm.ui.value.retrying, "the screen holds the button")
            assertNull(vm.retry(), "the second tap is ignored")
            settle()
            assertEquals(1, stub.writes.size, "one write")
            assertEquals(SheetSave.Saved, vm.ui.value.save)
            assertFalse(vm.ui.value.retrying)
            assertNull(vm.retry(), "nothing left to retry")
        }

    @Test
    fun `an edit made while a retry reads is written by the retry, once`() =
        runTest(main) {
            val (stub, vm) = offlineEdit()
            vm.retry()
            vm.toggleTag("4689114", "sleeper")
            settle()
            assertEquals(1, stub.writes.size)
            val written = stub.writes.single().first[5]
            assertEquals("Stash", written.note)
            assertEquals(listOf("sleeper"), written.tags)
            assertFalse(vm.ui.value.unsaved)
        }

    @Test
    fun `a read older than the copy shown is not drawn`() =
        runTest(main) {
            val stub = SheetStub(sheetDetail(parityRows()))
            val vm = sheetViewModel(stub, main)
            vm.load()
            settle()
            vm.setNote("4689114", "Stash")
            settle()
            // A slow read answers with the sheet as it stood before the write.
            stub.detail = sheetDetail(parityRows())
            vm.load()
            settle()
            assertEquals(
                "Stash",
                vm
                    .model(vm.ui.value)
                    ?.lines
                    ?.get(5)
                    ?.note,
            )
            assertEquals(
                SheetClock.later(SheetClock.STAMP, 1),
                vm.ui.value.detail
                    ?.updatedAt,
            )
        }

    @Test
    fun `an edit taken back to the account's value stops saying not saved`() =
        runTest(main) {
            val (stub, vm) = offlineEdit()
            stub.offline = true
            assertTrue(vm.ui.value.save is SheetSave.Failed)
            vm.setNote("4689114", "")
            settle()
            assertFalse(vm.ui.value.unsaved)
            assertEquals(SheetSave.Idle, vm.ui.value.save)
            assertFalse(
                vm
                    .model(vm.ui.value)
                    ?.line
                    .orEmpty()
                    .contains(SheetWords.offline),
            )
        }

    @Test
    fun `the league shown changing keeps the sheet and its unsaved edits`() =
        runTest(main) {
            val (stub, vm) = offlineEdit()
            val held = vm.ui.value.edits
            vm.toggle("4689114")
            assertNull(vm.startIn(BoardFormat.dynasty), "a sheet with rows reads no board")
            assertEquals(BoardFormat.dynasty, vm.ui.value.start)
            assertEquals(held, vm.ui.value.edits)
            assertEquals("4689114", vm.ui.value.openRow)
            assertEquals("PPR", vm.ui.value.formatLabel, "the sheet's own format is said")
            vm.retry()
            settle()
            assertEquals(
                "Stash",
                stub.writes
                    .last()
                    .first[5]
                    .note,
            )
        }

    @Test
    fun `an empty sheet's preview follows the league shown`() =
        runTest(main) {
            val vm = sheetViewModel(SheetStub(null), main)
            vm.load()
            settle()
            assertTrue(vm.ui.value.board is SheetBoard.Ready)
            vm.startIn(BoardFormat.dynasty)
            settle()
            assertEquals(SheetBoard.None, vm.ui.value.board)
            assertEquals("Dynasty", vm.ui.value.formatLabel)
        }
}
