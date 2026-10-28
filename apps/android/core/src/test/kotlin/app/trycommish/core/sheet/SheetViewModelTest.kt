package app.trycommish.core.sheet

import app.trycommish.core.MemoryCache
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
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * The cheat sheet's view model over a stub account at a fixed clock, as the iOS one is held (Lane 254): an
 * edit's round trip guarded by the sheet's stamp, an edit made with no signal or over a sheet changed
 * elsewhere never saying saved and saved by a retry that merges it field by field into the account's copy
 * (the laptop adds a tag while the phone edits the note offline; both change one field; a row removed
 * elsewhere), and a refused token.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SheetViewModelTest {
    private val main = StandardTestDispatcher()

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.loaded(stub: SheetStub = SheetStub(sheetDetail(parityRows()))): Pair<SheetStub, SheetViewModel> {
        val vm = sheetViewModel(stub, main)
        vm.load()
        settle()
        return stub to vm
    }

    private fun SheetViewModel.drawn(): SheetModel = requireNotNull(model(ui.value))

    @Test
    fun `the sheet opens with its rows and the account's stamp`() =
        runTest(main) {
            val (_, vm) = loaded()
            val model = vm.drawn()
            assertEquals("My sheet", model.name)
            assertEquals("PPR · 8 players · Saved to your account at 10:41 AM", model.line)
            assertEquals((1..8).toList(), model.lines.map { it.place })
            assertEquals("Ja'Marr Chase", model.lines.first().name)
            assertEquals(listOf(TagMark("Target", TagTone.You)), model.lines.first().tags)
            assertEquals(TagMark("Avoid", TagTone.Loss), model.lines[3].tags.first())
            assertTrue(model.lines.all { it.save == RowSave.Saved })
            assertEquals(listOf("PPR bump"), model.ownTags)
            assertNull(vm.ui.value.stampWords(SHEET_ZONE))
        }

    @Test
    fun `a position narrows the rows and keeps their places`() =
        runTest(main) {
            val (_, vm) = loaded()
            vm.choose("RB")
            val model = vm.drawn()
            assertEquals(listOf(2, 5), model.lines.map { it.place })
            assertEquals("2 players shown", model.shown)
            assertEquals(listOf("All", "QB", "RB", "WR", "K", "DST"), model.positions.map { it.label })
        }

    @Test
    fun `a note is written with every row guarded by the stamp and saved`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.setNote("4689114", "  Upside late  ")
            settle()
            assertEquals(1, stub.writes.size)
            assertEquals(SheetClock.STAMP, stub.writes.first().second, "the stamp goes back to the microsecond")
            assertEquals(
                8,
                stub.writes
                    .first()
                    .first.size,
            )
            assertEquals(
                "Upside late",
                stub.writes
                    .first()
                    .first[5]
                    .note,
            )
            assertEquals(SheetSave.Saved, vm.ui.value.save)
            assertFalse(vm.ui.value.unsaved)
            assertEquals("Upside late", vm.drawn().lines[5].note)
            assertEquals(RowSave.Saved, vm.drawn().lines[5].save)
        }

    @Test
    fun `a note that reads the same writes nothing`() =
        runTest(main) {
            val (stub, vm) = loaded()
            assertNull(vm.setNote("4362628", "Round one, no thinking. "))
            settle()
            assertTrue(stub.writes.isEmpty())
        }

    @Test
    fun `a tag tap takes its opposite's place and a full row refuses`() =
        runTest(main) {
            val (stub, vm) = loaded()
            assertTrue(vm.toggleTag("4362628", "avoid"))
            settle()
            assertEquals(
                listOf("avoid"),
                stub.writes
                    .last()
                    .first
                    .first()
                    .tags,
            )
            vm.toggleTag("4430807", "target")
            settle()
            vm.toggleTag("4430807", "breakout")
            settle()
            assertFalse(vm.toggleTag("4430807", "injury"))
            assertEquals(SheetWords.full, vm.addTag("4430807", "late round"))
            assertEquals("A tag is 1 to 20 letters or numbers", vm.addTag("4239996", "-late"))
            assertNull(vm.addTag("4239996", "late   round"))
            settle()
            assertEquals(
                listOf("Handcuff", "late round"),
                vm
                    .drawn()
                    .lines[4]
                    .tags
                    .map { it.label },
            )
        }

    @Test
    fun `an edit with no signal says it is not saved and a retry saves it`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.offline = true
            vm.setNote("4689114", "Stash")
            settle()
            assertEquals(SheetSave.Failed(SheetWords.offline, false), vm.ui.value.save)
            val row = vm.drawn().lines[5]
            assertEquals("Stash", row.note, "the edit stays on the row")
            assertEquals(RowSave.Unsaved(SheetWords.offline), row.save)
            assertEquals("Not saved to your account. No connection.", row.save.words)
            assertTrue(vm.drawn().line.endsWith(SheetWords.offline), "the head never says saved")
            assertTrue(vm.ui.value.unsaved)
            stub.offline = false
            vm.retry()
            settle()
            assertEquals(SheetSave.Saved, vm.ui.value.save)
            assertEquals(RowSave.Saved, vm.drawn().lines[5].save)
            assertEquals(
                "Stash",
                stub.writes
                    .last()
                    .first[5]
                    .note,
            )
        }

    @Test
    fun `an edit over a saved copy is written only once the account answers`() =
        runTest(main) {
            val stub = SheetStub(sheetDetail(parityRows()))
            val cache = MemoryCache()
            sheetViewModel(stub, main, cache).load()
            settle()
            stub.offline = true
            val vm = sheetViewModel(stub, main, cache)
            vm.load()
            settle()
            assertTrue(vm.ui.value.stale)
            assertEquals("Last read Fri 11:00 am", vm.ui.value.stampWords(SHEET_ZONE))
            vm.toggleTag("3054850", "sleeper")
            settle()
            assertEquals(RowSave.Unsaved(SheetWords.offline), vm.drawn().lines[7].save)
            stub.offline = false
            vm.retry()
            settle()
            assertEquals(2, stub.reads, "a saved copy is read again before the retry writes")
            assertEquals(SheetSave.Saved, vm.ui.value.save)
            assertFalse(vm.ui.value.stale)
            assertEquals(
                listOf("sleeper"),
                stub.writes
                    .last()
                    .first[7]
                    .tags,
            )
            assertEquals(SheetClock.STAMP, stub.writes.last().second)
        }

    @Test
    fun `a sheet changed on another device is read again and the edit written over it`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.changedElsewhere = true
            vm.setNote("4689114", "Stash")
            settle()
            val changed = "This sheet changed on another device"
            assertEquals(SheetSave.Failed(changed, true), vm.ui.value.save)
            assertEquals(RowSave.Unsaved(changed), vm.drawn().lines[5].save)
            vm.retry()
            settle()
            assertEquals(SheetSave.Saved, vm.ui.value.save)
            assertEquals(2, stub.writes.size)
            assertEquals(SheetClock.later(SheetClock.STAMP, 30), stub.writes.last().second)
            assertEquals(
                "Stash",
                stub.writes
                    .last()
                    .first[5]
                    .note,
            )
        }

    @Test
    fun `a note changed with no signal and a tag added elsewhere both survive Try again`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.offline = true
            vm.setNote("4362628", "Round one, locked")
            settle()
            assertEquals(RowSave.Unsaved(SheetWords.offline), vm.drawn().lines[0].save)
            stub.offline = false
            stub.editElsewhere("4362628", listOf("target", "sleeper"), "Round one, no thinking.")
            vm.retry()
            settle()
            assertEquals(SheetSave.Saved, vm.ui.value.save)
            val written =
                stub.writes
                    .last()
                    .first
                    .first()
            assertEquals("Round one, locked", written.note, "the phone's note")
            assertEquals(listOf("target", "sleeper"), written.tags, "the laptop's tag")
            assertEquals(SheetClock.later(SheetClock.STAMP, 60), stub.writes.last().second)
            assertEquals(emptyList<String>(), vm.drawn().lines[0].notices)
        }

    @Test
    fun `a note changed on both sides keeps the account's and says so`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.offline = true
            vm.setNote("4362628", "Round one, locked")
            settle()
            stub.offline = false
            stub.editElsewhere("4362628", listOf("target"), "Fade him")
            vm.retry()
            settle()
            assertTrue(stub.writes.isEmpty(), "nothing of the phone's is left to write")
            assertFalse(vm.ui.value.unsaved)
            val row = vm.drawn().lines[0]
            assertEquals("Fade him", row.note)
            assertEquals(RowSave.Saved, row.save)
            assertEquals(listOf("Your note on Ja'Marr Chase was replaced by the one saved on another device"), row.notices)
            vm.toggleTag("4362628", "sleeper")
            settle()
            assertEquals(emptyList<String>(), vm.drawn().lines[0].notices, "an edit to the row clears what it said")
        }

    @Test
    fun `a pull to refresh merges an unsaved edit too`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.offline = true
            vm.toggleTag("4689114", "sleeper")
            settle()
            stub.offline = false
            stub.editElsewhere("4689114", emptyList(), "Backup only")
            vm.load()
            settle()
            val row = vm.drawn().lines[5]
            assertEquals(listOf("Sleeper"), row.tags.map { it.label }, "the unsaved edit stays on top of the merged row")
            assertEquals("Backup only", row.note)
            assertEquals(RowSave.Unsaved(SheetWords.offline), row.save, "and still says it is not saved")
            vm.retry()
            settle()
            val written = stub.writes.last().first[5]
            assertEquals(listOf("sleeper"), written.tags)
            assertEquals("Backup only", written.note)
        }

    @Test
    fun `a pull to refresh that finds the edit on the account stops saying not saved`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.offline = true
            vm.setNote("4689114", "Stash")
            settle()
            stub.offline = false
            stub.editElsewhere("4689114", emptyList(), "Stash")
            vm.load()
            settle()
            assertFalse(vm.ui.value.unsaved)
            assertEquals(SheetSave.Idle, vm.ui.value.save)
            assertFalse(vm.drawn().line.contains(SheetWords.offline))
            assertEquals(RowSave.Saved, vm.drawn().lines[5].save)
        }

    @Test
    fun `a read while a write is on its way leaves the edits to it`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.offline = true
            vm.setNote("4689114", "Stash")
            settle()
            val held = vm.ui.value.edits
            stub.offline = false
            stub.editElsewhere("4689114", listOf("sleeper"), null)
            vm.update { it.copy(save = SheetSave.Saving) }
            vm.load()
            settle()
            assertEquals(held, vm.ui.value.edits, "the edits keep the base the write carries")
            assertTrue(
                vm
                    .drawn()
                    .lines[5]
                    .tags
                    .isEmpty(),
                "the rows wait for the write's answer",
            )
        }

    @Test
    fun `a row taken off elsewhere drops the phone's edit to it`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.offline = true
            vm.setNote("3054850", "Indoors")
            settle()
            stub.offline = false
            stub.replaceRows(SheetClock.SHEET_ID, parityRows().take(7), null)
            vm.retry()
            settle()
            assertEquals(7, vm.drawn().players)
            assertFalse(vm.ui.value.unsaved)
        }

    @Test
    fun `a row taken off is written without him`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.remove("dst-BUF")
            settle()
            assertEquals(
                7,
                stub.writes
                    .last()
                    .first.size,
            )
            assertEquals(7, vm.drawn().players)
        }

    @Test
    fun `a refused token signs out`() =
        runTest(main) {
            val stub = SheetStub(sheetDetail(parityRows())).apply { refusesToken = true }
            val ends = Ends()
            val vm = sheetViewModel(stub, main, ends = ends)
            vm.load()
            settle()
            assertEquals(1, ends.count)
            assertEquals(SheetPhase.SignedOut, vm.ui.value.phase)
        }
}
