package app.trycommish.feature.sheet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The note field writes only what the member typed (Lane 267 review H1). */
class NoteDraftTest {
    @Test
    fun `a note changed elsewhere and refreshed under an open editor is never written back`() {
        // Open the editor, the note changes on another device, a refresh draws it, the editor closes.
        val opened = NoteDraft.opened("Round one, no thinking.")
        val refreshed = opened.follow("Fade him")
        assertEquals("the account's note is shown", "Fade him", refreshed.text)
        val (_, written) = refreshed.commit()
        assertNull("nothing is written", written)
    }

    @Test
    fun `focused without typing and let go writes nothing`() {
        val draft = NoteDraft.opened("Stash").focus(true).focus(false)
        assertNull(draft.commit().second)
    }

    @Test
    fun `text typed is kept while the account's note moves under it, and written on letting go`() {
        val typing = NoteDraft.opened("Stash").focus(true).typed("Stash late")
        val moved = typing.follow("Backup only")
        assertEquals("a field being typed in keeps the member's text", "Stash late", moved.text)
        val (after, written) = moved.focus(false).commit()
        assertEquals("Stash late", written)
        assertNull("written once", after.commit().second)
    }

    @Test
    fun `a cleared note is written as empty`() {
        val (_, written) =
            NoteDraft
                .opened("Stash")
                .focus(true)
                .typed("")
                .focus(false)
                .commit()
        assertEquals("", written)
    }
}
