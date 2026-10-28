package app.trycommish.core.sheet

import app.trycommish.api.ApiFailure
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.ImportSkip
import app.trycommish.core.board.RunFixture
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.nio.file.Files

/**
 * The cheat sheet's import, export and empty sheet over a stub account at a fixed clock, as the iOS ones are
 * held (Lane 254): a file read on the phone first, a list of names, a bad header or a file that reads no
 * player refused before any request, an import the account answers sent and shown, one it refuses or reads
 * no player from shown as refused with the sheet read again and nothing written back, no import while a
 * row's write is on its way; the export's file shared as the API wrote it, waiting while an edit is unsaved;
 * the empty sheet started from our board.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SheetFilesTest {
    private val main = StandardTestDispatcher()
    private val refusedHeader = "The first row must name rank, player_id, name and position"

    @BeforeEach
    fun setUp() = Dispatchers.setMain(main)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.open(stub: SheetStub): SheetViewModel {
        val vm = sheetViewModel(stub, main)
        vm.load()
        settle()
        return vm
    }

    private fun TestScope.loaded(): Pair<SheetStub, SheetViewModel> {
        val stub = SheetStub(sheetDetail(parityRows()))
        return stub to open(stub)
    }

    private fun SheetViewModel.done(): SheetImportWords = assertInstanceOf(SheetImport.Done::class.java, ui.value.importing).words

    private fun SheetViewModel.players(): Int? = model(ui.value)?.players

    @Test
    fun `an import replaces the rows and says what it read and skipped`() =
        runTest(main) {
            val (stub, vm) = loaded()
            val skips = (1..14).map { ImportSkip(it + 1, "The rank is not a whole number from 1") }
            stub.importAnswer = SheetImportAnswer(3, skips, parityRows().take(3))
            assertEquals(SheetWords.replace, vm.ui.value.importVerb)
            val csv = SheetParity.load().csv
            vm.importCsv(csv)
            settle()
            assertEquals(listOf(csv), stub.imports)
            val words = vm.done()
            assertEquals("3 players read", words.read)
            assertEquals("14 rows skipped", words.skipped)
            assertEquals(13, words.rows.size)
            assertEquals("Row 2: The rank is not a whole number from 1", words.rows.first())
            assertEquals("And 2 more", words.rows.last())
            assertNull(words.kept)
            assertEquals(3, vm.players())
        }

    @Test
    fun `a refused import says the API's sentence and keeps the sheet`() =
        runTest(main) {
            val (stub, vm) = loaded()
            val sentence = "Some of that did not check out"
            stub.importRefusal = ApiFailure(400, "invalid", sentence)
            vm.importCsv(SheetParity.load().csv)
            settle()
            assertEquals(SheetImport.Open(sentence), vm.ui.value.importing)
            assertEquals(8, vm.players())
            assertTrue(stub.writes.isEmpty())
        }

    @Test
    fun `a pasted list of names is refused before any request`() =
        runTest(main) {
            val stub = SheetStub(null)
            val vm = open(stub)
            assertNull(vm.importCsv("1. Puka Nacua\n2. Ja'Marr Chase"))
            assertEquals(SheetImport.Open(refusedHeader), vm.ui.value.importing)
            assertTrue(stub.imports.isEmpty())
            assertTrue(stub.created.isEmpty(), "no sheet is made")
            assertTrue(stub.deleted.isEmpty())
            assertNull(vm.model(vm.ui.value))
        }

    @Test
    fun `a header that names the wrong columns is refused before any request`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.openImport()
            vm.paste("name,team\nJa'Marr Chase,CIN")
            assertNull(vm.importCsv(vm.ui.value.pasted))
            assertEquals(SheetImport.Open(refusedHeader), vm.ui.value.importing)
            assertTrue(stub.imports.isEmpty())
        }

    @Test
    fun `no import while a row's write is on its way`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.update { it.copy(save = SheetSave.Saving) }
            vm.openImport()
            assertEquals(SheetImport.Closed, vm.ui.value.importing)
            assertNull(vm.importCsv(SheetParity.load().csv))
            assertTrue(stub.imports.isEmpty())
        }

    @Test
    fun `a file over one megabyte or not text is refused before it is sent`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.importCsv("x".repeat(SheetLimits.CSV_BYTES + 1))
            assertEquals(SheetImport.Open(SheetWords.tooLarge), vm.ui.value.importing)
            vm.chose(ByteArray(SheetLimits.CSV_BYTES + 1), "big.csv")
            assertEquals(SheetImport.Open(SheetWords.tooLarge), vm.ui.value.importing)
            vm.chose(byteArrayOf(0xFF.toByte()), "odd.csv")
            assertEquals(SheetImport.Open(SheetWords.unreadable), vm.ui.value.importing)
            assertNull(vm.ui.value.chosen)
            assertTrue(stub.imports.isEmpty())
        }

    @Test
    fun `a chosen file is held under its name and never fills the paste box`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.openImport()
            val csv = SheetParity.load().csv
            vm.chose(csv.toByteArray(), "rankings.csv")
            assertEquals(ChosenFile("rankings.csv", csv), vm.ui.value.chosen, "the panel says its name")
            assertEquals("", vm.ui.value.pasted)
            assertEquals(csv, vm.ui.value.importText, "the verb sends the file")
            vm.paste("rank,player_id,name,position\n")
            assertNull(vm.ui.value.chosen, "the last way in is the one sent")
            vm.chose(csv.toByteArray(), "rankings.csv")
            stub.importAnswer = SheetImportAnswer(8, emptyList(), parityRows())
            vm.importCsv(vm.ui.value.importText)
            settle()
            assertEquals(listOf(csv), stub.imports)
            assertNull(vm.ui.value.chosen, "an import that lands lets the file go")
        }

    @Test
    fun `the rows are held while an import is on its way`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.update { it.copy(importing = SheetImport.Sending) }
            assertNull(vm.setNote("4689114", "Stash"))
            assertTrue(vm.toggleTag("4689114", "sleeper"))
            assertNull(vm.addTag("4689114", "late round"))
            assertNull(vm.remove("dst-BUF"))
            settle()
            assertTrue(
                vm.ui.value.edits
                    .isEmpty(),
            )
            assertTrue(stub.writes.isEmpty())
        }

    @Test
    fun `an export the phone cannot keep says so in its own words`() =
        runTest(main) {
            val stub = SheetStub(sheetDetail(parityRows()))
            val blocked = Files.createTempFile("sheet-exports", ".csv").toFile()
            val vm = sheetViewModel(stub, main, exports = blocked)
            vm.load()
            settle()
            vm.exportFile()
            settle()
            assertEquals(SheetExport.Failed(SheetWords.notKept), vm.ui.value.export, "never no connection")
        }

    @Test
    fun `a file that reads no player on the phone is not sent`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.importCsv("rank,player_id,name,position\n1,x,Somebody,LB\n")
            val words = vm.done()
            assertEquals("0 players read", words.read)
            assertEquals(listOf("Row 2: The position is not QB, RB, WR, TE, K or DST"), words.rows)
            assertEquals(SheetWords.keptAsItWas, words.kept)
            settle()
            assertTrue(stub.imports.isEmpty())
            assertTrue(stub.writes.isEmpty())
            assertEquals(8, vm.players())
        }

    @Test
    fun `an import the account reads no player from is refused and the sheet read again`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.importAnswer = SheetImportAnswer(0, listOf(ImportSkip(2, "name: runs 1 to 80 characters")), emptyList())
            vm.importCsv(SheetParity.load().csv)
            settle()
            val words = vm.done()
            assertEquals("0 players read", words.read)
            assertEquals(SheetWords.readNone, words.kept)
            assertTrue(stub.writes.isEmpty(), "the old rows are never written back")
            assertEquals(2, stub.reads, "the sheet is read again")
            assertEquals(0, vm.players(), "the phone shows what the account holds")
            assertTrue(vm.model(vm.ui.value)?.line?.contains(SheetWords.saved) != true)
        }

    @Test
    fun `an import into an empty account makes the sheet and takes it off when refused`() =
        runTest(main) {
            val stub = SheetStub(null)
            val vm = open(stub)
            assertNull(vm.model(vm.ui.value))
            assertEquals(SheetWords.use, vm.ui.value.importVerb)
            stub.importRefusal = ApiFailure(400, "invalid", "Refused")
            vm.importCsv(SheetParity.load().csv)
            settle()
            assertEquals(SheetImport.Open("Refused"), vm.ui.value.importing)
            assertEquals(1, stub.created.size)
            assertEquals(listOf(SheetClock.SHEET_ID), stub.deleted)
            assertNull(vm.model(vm.ui.value))
            stub.importRefusal = null
            stub.importAnswer = SheetImportAnswer(8, emptyList(), parityRows())
            vm.importCsv(SheetParity.load().csv)
            settle()
            assertEquals(8, vm.players())
        }

    // Export.

    /** The phone shares the API's file byte for byte under its name; that the API's file is the web's for the
     * same rows is held by api/internal/sheets/csv_parity_test.go over the same sheet.json. */
    @Test
    fun `the export shares the API's file byte for byte`() =
        runTest(main) {
            val (stub, vm) = loaded()
            val csv = SheetParity.load().csv.toByteArray()
            stub.exportFile = "My sheet.csv" to csv
            vm.exportFile()
            settle()
            val ready = assertInstanceOf(SheetExport.Ready::class.java, vm.ui.value.export)
            assertEquals("My sheet.csv", ready.file.name)
            assertArrayEquals(csv, ready.file.readBytes(), "the file is shared as the export wrote it")
            vm.finishExport()
            assertEquals(SheetExport.Idle, vm.ui.value.export)
        }

    @Test
    fun `an export's name never leaves the exports folder`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.exportFile = "../../My sheet.csv" to byteArrayOf(1)
            vm.exportFile()
            settle()
            val ready = assertInstanceOf(SheetExport.Ready::class.java, vm.ui.value.export)
            assertEquals(vm.deps.exports, ready.file.parentFile)
        }

    @Test
    fun `the export waits while an edit is not saved`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.offline = true
            vm.setNote("4689114", "Stash")
            settle()
            assertNull(vm.exportFile())
            assertEquals(SheetExport.Idle, vm.ui.value.export)
        }

    @Test
    fun `an export with no signal says so`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.offline = true
            vm.exportFile()
            settle()
            assertEquals(SheetExport.Failed(SheetWords.offline), vm.ui.value.export)
        }

    // The empty sheet.

    @Test
    fun `an empty account previews our board and starts from it`() =
        runTest(main) {
            val stub = SheetStub(null)
            val vm = open(stub)
            val entries = assertInstanceOf(SheetBoard.Ready::class.java, vm.ui.value.board).entries
            val board = RunFixture.StandIn.read().board
            assertEquals(board.rows.size + board.market.size, entries.size)
            assertEquals(board.rows.first().id, entries.first().id)
            assertEquals(board.market.map { it.id }.toSet(), entries.takeLast(board.market.size).map { it.id }.toSet())
            assertEquals(5, vm.ui.value.preview.size)
            assertEquals("PPR", vm.ui.value.formatLabel)
            vm.start()
            settle()
            assertEquals(entries.size, stub.created.first().size)
            assertEquals(entries.size, vm.players())
            assertEquals(
                board.rows.first().id,
                vm
                    .model(vm.ui.value)
                    ?.lines
                    ?.first()
                    ?.player
                    ?.boardId,
            )
        }

    @Test
    fun `a format the run has no board for says it is not out`() =
        runTest(main) {
            val vm = sheetViewModel(SheetStub(null), main, format = BoardFormat.dynasty)
            vm.load()
            settle()
            assertEquals(SheetBoard.None, vm.ui.value.board)
        }
}
