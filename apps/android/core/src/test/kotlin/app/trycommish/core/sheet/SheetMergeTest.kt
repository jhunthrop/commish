package app.trycommish.core.sheet

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The field merge's edge cases (merge.ts pick and sameTags, Lane 267 review L2): both sides clearing a note,
 * both adding the same tag, the same tags in another order, and a row taken off here while edited there. */
class SheetMergeTest {
    private val base = SheetEntry("4362628", "Ja'Marr Chase", "WR", "CIN", null, 1, listOf("target"), "Round one")

    @Test
    fun `a note both sides cleared is cleared with nothing said`() {
        val merged = SheetMerge.row(base, base.with(base.tags, null), base.with(base.tags, null))
        assertNull(merged.entry.note)
        assertTrue(merged.notices.isEmpty())
    }

    @Test
    fun `the same tag added on both sides is kept once with nothing said`() {
        val both = base.with(listOf("target", "sleeper"), base.note)
        val merged = SheetMerge.row(base, both, both)
        assertEquals(listOf("target", "sleeper"), merged.entry.tags)
        assertTrue(merged.notices.isEmpty())
    }

    @Test
    fun `the same tags in another order are a change on each side, and the account's stands`() {
        val local = base.with(listOf("target", "sleeper"), base.note)
        val server = base.with(listOf("sleeper", "target"), base.note)
        val merged = SheetMerge.row(base, local, server)
        assertEquals(listOf("sleeper", "target"), merged.entry.tags, "merge.ts sameTags reads the order")
        assertEquals(listOf("Your tags on Ja'Marr Chase were replaced by the ones saved on another device"), merged.notices)
    }

    @Test
    fun `a row taken off here while edited there stays off`() {
        val detail = sheetDetail(parityRows())
        val account = SheetEntry.of(detail.rows.first())
        val ui = SheetUi(detail = detail, edits = mapOf(account.id to SheetEdit(account, null)))
        val fresh = sheetDetail(parityRows().map { if (it.playerId == account.id) it.copy(note = "Fade him") else it })
        val merged = ui.merged(fresh).shown(fresh, SheetClock.now, false)
        assertEquals(SheetEdit(SheetEntry.of(fresh.rows.first()), null), merged.edits[account.id])
        assertTrue(merged.entries.none { it.id == account.id }, "he is not drawn")
        assertTrue(merged.notices.isEmpty())
        assertEquals(7, merged.entries.size)
    }
}
