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
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.nio.file.Files

/**
 * The cheat sheet's import, export and empty sheet over a stub account at a fixed clock, as the iOS ones are
 * held (Lanes 254 and 278): a CSV read on the phone first, a bad header or a CSV that reads no player refused
 * before any request, a list of names sent as it is (text/plain) for the account to read, an import the
 * account answers sent and shown, one it refuses for reading no player shown as the import's result in its
 * sentence with the sheet read again and nothing written back, any other refusal shown as the panel's
 * problem, no import while a row's write is on its way; the export's file shared as the API wrote it, waiting while an edit is unsaved;
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
            vm.importText(csv)
            settle()
            assertEquals(listOf(SheetImportBody.Csv(csv)), stub.imports)
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
    fun `a refusal for another reason says the API's sentence and keeps the sheet`() =
        runTest(main) {
            val (stub, vm) = loaded()
            val sentence = "Our board did not load, so a list of names cannot be read yet"
            stub.importRefusal = ApiFailure(503, "unavailable", sentence)
            vm.importText("1. Puka Nacua")
            settle()
            assertEquals(SheetImport.Open(sentence), vm.ui.value.importing)
            assertEquals(8, vm.players())
            assertTrue(stub.writes.isEmpty())
        }

    /** Every pasted list of the parity file: a list is sent as it is, typed text/plain, and what the account reads
     * (the web's read, which the API is held to) is shown as a CSV import's is, each reason in the phone's word
     * for a line; a list the account reads no player from is refused in its sentence; a first line that names
     * player_id takes the CSV path. */
    @Test
    fun `every parity list is sent as names and shown as the account reads it`() =
        runTest(main) {
            val parity = SheetParity.load()
            parity.lists.filter { it.text.isNotBlank() }.forEach { list ->
                val (stub, vm) = loaded()
                val kept = parityRows().take(list.ids.size)
                stub.importAnswer = SheetImportAnswer(kept.size, list.skipped.map { ImportSkip(it.line, it.reason) }, kept)
                vm.importText(list.text)
                settle()
                if (list.csv) {
                    assertEquals(listOf(SheetImportBody.Csv(list.text)), stub.imports, list.text)
                    return@forEach
                }
                assertEquals(listOf(SheetImportBody.Names(list.text)), stub.imports, list.text)
                val words = vm.done()
                assertEquals(SheetWords.read(kept.size), words.read, list.text)
                val named = list.skipped.take(SheetWords.SKIPS_SHOWN).map { said(it.line, it.reason.replace("line", "row"), list.text) }
                assertEquals(named, words.rows.take(named.size), list.text)
                if (kept.isEmpty()) {
                    assertEquals(SheetStub.EMPTY_READ, words.kept, list.text)
                    assertEquals(if (list.skipped.isEmpty()) SheetWords.listShape else null, words.shape, list.text)
                    assertEquals(SheetWords.fixList, words.verb)
                    assertEquals(8, vm.players(), "the sheet is as it was")
                    assertTrue(stub.writes.isEmpty())
                    return@forEach
                }
                assertNull(words.kept)
                assertEquals(kept.size, vm.players())
            }
        }

    /** "Row 3, Michael Thomas: reason" for a row of [text] that holds something (its rank set aside), else "Row 3:
     * reason": what the phone says for a pasted list's skipped row, written out here apart from the code. */
    private fun said(
        line: Int,
        reason: String,
        text: String,
    ): String {
        val typed =
            text
                .split("\n")
                .getOrNull(line - 1)
                ?.trim { it.isWhitespace() || it == '\uFEFF' }
                ?.replace(Regex("""(?U)^[0-9]+\s*[.)\-:]?\s+"""), "")
                ?.take(40)
                ?.trimEnd()
                .orEmpty()
        return if (typed.isEmpty()) "Row $line: $reason" else "Row $line, $typed: $reason"
    }

    /** Every refusal of the parity file (Lane 297), pasted as the member would: a list the account refuses shows,
     * under "0 players read" and the account's sentence, each row it skipped with what was typed on it and why; a
     * CSV of a header alone is read on the phone, never sent, and says it held a header alone, never a list's
     * shape. The verb is "Fix the list", which goes back to the box with the text kept; nothing is written. */
    @Test
    fun `every parity refusal lists its skipped rows and Fix the list keeps the text`() =
        runTest(main) {
            val refusals = SheetParity.load().refusals
            assertTrue(refusals.any { it.skipped.isNotEmpty() })
            assertTrue(refusals.any { it.skipped.isEmpty() })
            refusals.forEach { refusal ->
                val (stub, vm) = loaded()
                stub.importRefusal = refusal.failure
                vm.openImport()
                vm.paste(refusal.text)
                vm.importText(vm.ui.value.importText)
                settle()
                val words = vm.done()
                assertEquals("0 players read", words.read)
                assertEquals(refusal.body, words.kept)
                assertEquals(if (refusal.skipped.isEmpty()) null else SheetWords.skipped(refusal.skipped.size), words.skipped)
                assertEquals(refusal.skipped.map { said(it.line, SheetWords.rowWords(it.reason), refusal.text) }, words.rows)
                assertEquals(if (refusal.skipped.isEmpty()) SheetWords.headerOnly else null, words.shape, refusal.text)
                assertEquals("Fix the list", words.verb)
                assertEquals(if (refusal.csv) 0 else 1, stub.imports.size, "a CSV is read on the phone first")
                assertTrue(stub.writes.isEmpty())
                assertEquals(8, vm.players(), "the sheet is as it was")
                vm.finishImport()
                assertEquals(SheetImport.Open(), vm.ui.value.importing)
                assertEquals(refusal.text, vm.ui.value.pasted, "the text is kept to fix")
            }
            val named = refusals.first { it.skipped.isNotEmpty() }
            assertEquals("Row 3, Michael Thomas: x", said(3, "x", named.text), "the typed name, not the count")
            assertEquals("Row 1, Puka Nacua: x", said(1, "x", named.text), "the rank set aside")
        }

    @Test
    fun `a typed row is cut and a missing one says the row alone`() {
        val long = "Amon-Ra St. Brown ".repeat(4)
        val words =
            SheetImportWords.of(
                0,
                listOf(SheetCsv.Skip(1, "R"), SheetCsv.Skip(3, "R"), SheetCsv.Skip(9, "R")),
                "K",
                "$long\r\n   \nGibbs\r",
            )
        assertEquals("Row 1, ${long.take(40).trimEnd()}: R", words.rows[0])
        assertEquals("Row 3, Gibbs: R", words.rows[1])
        assertEquals("Row 9: R", words.rows[2])
    }

    /** An API from before Lane 297 refuses with its sentence alone: shown as the import's result, the shape said,
     * the verb "Fix the list"; a result that read players says Done. */
    @Test
    fun `an older API's refusal without rows still reads as the result`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.importRefusal = ApiFailure(400, "invalid", "Some of that did not check out", mapOf("body" to SheetStub.EMPTY_READ))
            vm.importText("Gibbs")
            settle()
            val words = vm.done()
            assertEquals(SheetStub.EMPTY_READ, words.kept)
            assertTrue(words.rows.isEmpty())
            assertEquals(SheetWords.listShape, words.shape)
            assertEquals(SheetWords.fixList, words.verb)
            assertEquals(SheetWords.done, SheetImportWords.of(1, emptyList(), null).verb)
        }

    @Test
    fun `the account's word for a line is said as a row`() {
        assertEquals("This player is already on an earlier row", SheetWords.rowWords("This player is already on an earlier line"))
        assertEquals(refusedHeader, SheetWords.rowWords("The first line must name rank, player_id, name and position"))
        assertEquals("Rows past the limit", SheetWords.rowWords("Lines past the limit"))
        assertEquals("A sideline pass", SheetWords.rowWords("A sideline pass"))
    }

    @Test
    fun `a list is told from a CSV by its first line`() {
        SheetParity.load().lists.forEach { assertEquals(it.csv, SheetCsv.looksLikeCsv(it.text), it.text) }
        assertTrue(SheetCsv.looksLikeCsv("\uFEFF\n  Rank,Player_ID,Name,Position\n1,a,B,QB"))
        // As the API reads it: a no-break space is not set aside, and "\r" alone does not end the line.
        assertFalse(SheetCsv.looksLikeCsv(" \nrank,player_id,name,position"))
        assertTrue(SheetCsv.looksLikeCsv("Gibbs\rrank,player_id,name,position"))
    }

    /** A list the account reads no player from and names no row for says why (its sentence), what a list that
     * reads looks like, and "Fix the list" goes back to the box with the text kept; an import that read players
     * closes. */
    @Test
    fun `a list that reads nothing says what to paste and Done keeps the text`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.openImport()
            vm.paste("Puka Nacua - WR - LAR")
            vm.importText(vm.ui.value.importText)
            settle()
            val words = vm.done()
            assertEquals(SheetStub.EMPTY_READ, words.kept)
            assertEquals(SheetWords.listShape, words.shape)
            assertTrue(words.again)
            vm.finishImport()
            assertEquals(SheetImport.Open(), vm.ui.value.importing)
            assertEquals("Puka Nacua - WR - LAR", vm.ui.value.pasted, "the text is kept to fix")
            stub.importAnswer = SheetImportAnswer(1, emptyList(), parityRows().take(1))
            vm.importText("1. Ja'Marr Chase")
            settle()
            val read = vm.done()
            assertNull(read.shape)
            assertFalse(read.again)
            vm.finishImport()
            assertEquals(SheetImport.Closed, vm.ui.value.importing)
            assertEquals("", vm.ui.value.pasted)
        }

    @Test
    fun `a CSV that reads no player names its rows and no shape`() =
        runTest(main) {
            val (_, vm) = loaded()
            vm.importText("rank,player_id,name,position\n1,x,Somebody,LB\n")
            val words = vm.done()
            assertNull(words.shape, "the skipped row says why")
            assertTrue(words.again)
        }

    @Test
    fun `a list of names into an empty account makes the sheet and takes it off when no player is read`() =
        runTest(main) {
            val stub = SheetStub(null)
            val vm = open(stub)
            vm.importText("Gibbs\nJahmyr")
            settle()
            assertEquals(listOf(SheetImportBody.Names("Gibbs\nJahmyr")), stub.imports)
            val words = vm.done()
            assertEquals("0 players read", words.read)
            assertEquals(SheetStub.EMPTY_READ, words.kept)
            assertEquals(1, stub.created.size)
            assertEquals(listOf(SheetClock.SHEET_ID), stub.deleted)
            assertNull(vm.model(vm.ui.value))
        }

    @Test
    fun `a header that names the wrong columns is refused before any request`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.openImport()
            vm.paste("player_id,name\n4362628,Ja'Marr Chase")
            assertNull(vm.importText(vm.ui.value.pasted))
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
            assertNull(vm.importText(SheetParity.load().csv))
            assertTrue(stub.imports.isEmpty())
        }

    @Test
    fun `a file over one megabyte or not text is refused before it is sent`() =
        runTest(main) {
            val (stub, vm) = loaded()
            vm.importText("x".repeat(SheetLimits.CSV_BYTES + 1))
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
            vm.importText(vm.ui.value.importText)
            settle()
            assertEquals(listOf(SheetImportBody.Csv(csv)), stub.imports)
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
            vm.importText("rank,player_id,name,position\n1,x,Somebody,LB\n")
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
    fun `an import the account reads no player from is shown in its sentence and the sheet read again`() =
        runTest(main) {
            val (stub, vm) = loaded()
            stub.importAnswer = null
            vm.importText(SheetParity.load().csv)
            settle()
            val words = vm.done()
            assertEquals("0 players read", words.read)
            assertEquals(SheetStub.EMPTY_READ, words.kept)
            assertTrue(stub.writes.isEmpty(), "the old rows are never written back")
            assertEquals(2, stub.reads, "the sheet is read again")
            assertEquals(8, vm.players(), "the account kept the sheet")
        }

    @Test
    fun `an import into an empty account makes the sheet and takes it off when refused`() =
        runTest(main) {
            val stub = SheetStub(null)
            val vm = open(stub)
            assertNull(vm.model(vm.ui.value))
            assertEquals(SheetWords.use, vm.ui.value.importVerb)
            stub.importRefusal = ApiFailure(503, "unavailable", "Refused")
            vm.importText(SheetParity.load().csv)
            settle()
            assertEquals(SheetImport.Open("Refused"), vm.ui.value.importing)
            assertEquals(1, stub.created.size)
            assertEquals(listOf(SheetClock.SHEET_ID), stub.deleted)
            assertNull(vm.model(vm.ui.value))
            stub.importRefusal = null
            stub.importAnswer = SheetImportAnswer(8, emptyList(), parityRows())
            vm.importText(SheetParity.load().csv)
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
