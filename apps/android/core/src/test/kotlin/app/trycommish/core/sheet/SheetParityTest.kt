package app.trycommish.core.sheet

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.time.Instant

/** The sheet's ports held to the web's (shared/fixtures/parity/sheet.json, written by
 * shared/scripts/sheet-parity.ts), as the iOS SheetParityTests hold them: the fixed tags, a tag tap, a typed
 * tag, the status line, the first name, the limits, a file read as the web's decodeCsv reads it, and a write
 * carrying the fixture's rows as the account holds them. */
class SheetParityTest {
    private val parity = SheetParity.load()

    @Test
    fun `the fixed tags are the web's in its order and tone`() {
        assertEquals(parity.fixedTags.map { it.tag }, SheetTags.fixed.map { it.tag })
        assertEquals(parity.fixedTags.map { it.label }, SheetTags.fixed.map { it.label })
        assertEquals(parity.fixedTags.map { it.tone }, SheetTags.fixed.map { SheetTags.tone(it.tag).id })
        parity.labels.forEach {
            assertEquals(it.label, SheetTags.label(it.tag))
            assertEquals(it.tone, SheetTags.tone(it.tag).id)
        }
        assertEquals(parity.defaultName, SheetWords.defaultName)
    }

    @Test
    fun `a tag tap does what the web's does`() {
        parity.toggles.forEach { assertEquals(it.after, SheetTags.toggled(it.tags, it.tag), "${it.tags} + ${it.tag}") }
    }

    @Test
    fun `a typed tag is spelled and refused as the web's is`() {
        parity.typed.forEach {
            val canonical = SheetTags.canonical(it.tag)
            assertEquals(it.canonical, canonical, it.tag)
            assertEquals(it.problem, SheetTags.problem(canonical), it.tag)
        }
    }

    @Test
    fun `the status line says what the web's says`() {
        val answered = Instant.parse(parity.answeredAt)
        parity.statuses.forEach {
            val save =
                when (it.status) {
                    "saving" -> SheetSave.Saving
                    "saved" -> SheetSave.Saved
                    else -> SheetSave.Failed(it.problem ?: SheetWords.notSaved, false)
                }
            val words = SheetWords.status(save, it.changedAt?.let(Instant::parse), answered, it.players, SHEET_ZONE)
            assertEquals(it.words, words, "${it.status} ${it.players}")
        }
    }

    @Test
    fun `a save today is said at the reader's time`() {
        assertEquals(
            "Saved to your account at 10:41 AM",
            SheetWords.status(SheetSave.Saved, Instant.parse(SheetClock.STAMP), SheetClock.now, 3, SHEET_ZONE),
        )
    }

    @Test
    fun `the limits are the web's`() {
        val limits = parity.limits
        assertEquals(
            listOf(limits.rows, limits.sheetName, limits.playerId, limits.playerName, limits.team, limits.tier),
            with(SheetLimits) { listOf(ROWS, SHEET_NAME, PLAYER_ID, PLAYER_NAME, TEAM, TIER) },
        )
        assertEquals(
            listOf(limits.note, limits.tags, limits.tagLength, limits.headshot),
            with(SheetLimits) { listOf(NOTE, TAGS, TAG_LENGTH, HEADSHOT) },
        )
    }

    /** The web's reasons with "line" said as the phone says it, "row" (SheetWords). */
    private fun phone(web: String?): String? = web?.replace("line", "row")

    @Test
    fun `a file reads on the phone as the web reads it`() {
        parity.reads.forEach { file ->
            val label = file.text.take(LABEL)
            val read =
                try {
                    SheetCsv.read(file.text)
                } catch (e: SheetCsv.HeaderError) {
                    assertEquals(phone(file.header), e.message, label)
                    return@forEach
                }
            assertNull(file.header, label)
            assertEquals(file.ids, read.ids, label)
            assertEquals(file.skipped.map { it.line }, read.skipped.map { it.row }, label)
            assertEquals(file.skipped.map { phone(it.reason) }, read.skipped.map { it.reason }, label)
        }
    }

    @Test
    fun `a row writes back as the account holds it`() {
        val rows = parityRows()
        assertEquals(rows, sheetDetail(rows).rows.map { SheetEntry.of(it).input })
    }

    private companion object {
        const val LABEL = 30
    }
}
