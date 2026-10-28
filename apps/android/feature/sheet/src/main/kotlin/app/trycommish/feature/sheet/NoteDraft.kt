package app.trycommish.feature.sheet

/**
 * The note field's text against the note it holds from the account (Lane 267 review H1): `text` is what the
 * field shows, `synced` what it opened with or last followed or wrote. Only text the member typed is ever
 * written: a field that is not being typed in follows the account's note as it changes under it (a refresh,
 * a retry's merge, an import), and letting go writes only when the text differs from what it holds.
 */
internal data class NoteDraft(
    val text: String,
    val synced: String,
    val focused: Boolean = false,
) {
    fun typed(text: String): NoteDraft = copy(text = text)

    fun focus(focused: Boolean): NoteDraft = copy(focused = focused)

    /** The account's note as it now stands: the field follows it unless the member is typing in it. */
    fun follow(note: String?): NoteDraft = if (focused) this else opened(note)

    /** Letting go of the field: the draft after it, and the text to write, null when nothing was typed. */
    fun commit(): Pair<NoteDraft, String?> = if (text == synced) this to null else copy(synced = text) to text

    companion object {
        fun opened(note: String?): NoteDraft = NoteDraft(note.orEmpty(), note.orEmpty())
    }
}
