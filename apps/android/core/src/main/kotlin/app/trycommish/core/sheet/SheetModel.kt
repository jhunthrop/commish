package app.trycommish.core.sheet

import app.trycommish.api.models.SheetRow
import app.trycommish.api.models.SheetRowInput
import app.trycommish.core.board.BoardChip
import app.trycommish.core.companion.PlayerSlug
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.headshotOf
import app.trycommish.core.shell.initialsOf

/** One player's row on the sheet as the account holds it, with any edit the phone has not saved yet laid
 * over it: who he is, his tier, his tags and his note (web model.ts SheetRow). */
data class SheetEntry(
    val id: String,
    val name: String,
    val position: String,
    val team: String?,
    val headshot: String?,
    val tier: Int?,
    val tags: List<String>,
    val note: String?,
) {
    /** The row as a write sends it (remote.ts toApiRow). */
    val input: SheetRowInput get() = SheetRowInput(id, name, position, team, headshot, tier, tags, note)

    fun with(
        tags: List<String>,
        note: String?,
    ): SheetEntry = copy(tags = tags, note = note)

    companion object {
        fun of(row: SheetRow): SheetEntry =
            SheetEntry(row.playerId, row.name, row.position, row.team, row.headshot, row.tier, SheetTags.normalized(row.tags), row.note)
    }
}

/** An edit made on the phone and not yet saved to the account: the account's row it was made over (the
 * ancestor merge.ts keeps), and the row as the phone set it, or null when his row is taken off. The rows
 * drawn and written lay the edit over the account's row field by field (SheetMerge), so a field another
 * device changed and the phone did not is never written back as it was. */
data class SheetEdit(
    val base: SheetEntry,
    val local: SheetEntry?,
) {
    /** The account's row with this edit laid over it; null when the edit takes him off. */
    fun over(server: SheetEntry): SheetEntry? = local?.let { SheetMerge.row(base, it, server).entry }
}

/** A field's value as merged, and whether the phone's value lost a conflict. */
data class Picked<T>(
    val value: T,
    val overruled: Boolean,
)

/** A row merged, with a sentence for each field the account's copy won. */
data class Merged(
    val entry: SheetEntry,
    val notices: List<String>,
)

/**
 * A row edited on the phone and the account's copy of it become one row (a port of web/src/lib/sheet
 * merge.ts mergeRow for the fields a phone edits, the iOS SheetMerge): each field, his note and his tags,
 * against the row the edit was made over. A field changed on one side only takes that side's value.
 * Changed on both sides to different values, the account's copy stands and the row says what the phone
 * had, in the web's words. The phone never writes its whole row over the account's.
 */
object SheetMerge {
    /** merge.ts pick. */
    fun <T> pick(
        base: T,
        local: T,
        server: T,
    ): Picked<T> {
        val localMoved = local != base
        val serverMoved = server != base
        if (localMoved && !serverMoved) return Picked(local, false)
        return Picked(server, localMoved && serverMoved && local != server)
    }

    fun row(
        base: SheetEntry,
        local: SheetEntry,
        server: SheetEntry,
    ): Merged {
        val note = pick(base.note, local.note, server.note)
        val tags = pick(base.tags, local.tags, server.tags)
        val notices =
            listOfNotNull(
                SheetWords.noteReplaced(local.name).takeIf { note.overruled },
                SheetWords.tagsReplaced(local.name).takeIf { tags.overruled },
            )
        return Merged(server.with(tags.value, note.value), notices)
    }
}

/** A row as the phone draws it (SheetRow.svelte's compact row): his face, his name the biggest thing, his
 * position and club, his tier as a chip, his tags and note, his place on the sheet; whether its edit is
 * saved; what the phone had where the account's copy won; the player his face and name open. */
data class SheetLine(
    val id: String,
    val place: Int,
    val name: String,
    val initials: String,
    val headshot: String?,
    val position: String,
    val team: String?,
    val tier: Int?,
    val tags: List<TagMark>,
    /** His tags as stored, which the editor's chips are pressed by. */
    val tagged: List<String>,
    val note: String?,
    val save: RowSave,
    val notices: List<String>,
    val player: SheetPlayer,
    /** A defense: its face is its club's chip (B245). */
    val clubMark: Boolean,
) {
    companion object {
        fun of(
            entry: SheetEntry,
            place: Int,
            save: RowSave = RowSave.Saved,
            notices: List<String> = emptyList(),
        ): SheetLine {
            val defense = entry.position == DEFENSE
            return SheetLine(
                id = entry.id,
                place = place,
                name = entry.name,
                initials = initialsOf(entry.name),
                headshot = if (defense) null else headshotOf(entry.headshot),
                position = entry.position,
                team = entry.team,
                tier = entry.tier,
                tags = SheetTags.marks(entry.tags),
                tagged = entry.tags,
                note = entry.note,
                save = save,
                notices = notices,
                player =
                    SheetPlayer(
                        entry.id,
                        PlayerSlug.of(entry.name),
                        entry.name,
                        entry.position,
                        null,
                        entry.team,
                        null,
                        boardId = entry.id,
                    ),
                clubMark = defense && entry.team != null,
            )
        }
    }
}

/** A defense's position as the sheet stores it. */
internal const val DEFENSE = "DST"

/** What the screen draws from the sheet: its name and line, the position chips, the rows in the order the
 * account holds them with the chosen position's alone, and the count shown under a filter. */
data class SheetModel(
    val name: String,
    val line: String,
    val positions: List<BoardChip<String?>>,
    val lines: List<SheetLine>,
    /** "3 players shown" while a position narrows the sheet. */
    val shown: String?,
    val players: Int,
    /** The drafter's own tags anywhere on the sheet, offered in every row's editor. */
    val ownTags: List<String>,
) {
    companion object {
        /** The positions in the order the sheet draws its chips (types/player.ts POSITIONS). */
        val order = listOf("QB", "RB", "WR", "TE", "K", DEFENSE)

        fun of(
            name: String,
            line: String,
            entries: List<SheetEntry>,
            saves: Map<String, RowSave>,
            position: String?,
            notices: Map<String, List<String>> = emptyMap(),
        ): SheetModel {
            val present = order.filter { p -> entries.any { it.position == p } }
            val chips =
                listOf(BoardChip<String?>(SheetWords.all, null, position == null)) +
                    present.map { BoardChip<String?>(it, it, it == position) }
            val drawn = entries.withIndex().filter { position == null || it.value.position == position }
            return SheetModel(
                name = name,
                line = line,
                positions = chips,
                lines =
                    drawn.map { (index, entry) ->
                        SheetLine.of(entry, index + 1, saves[entry.id] ?: RowSave.Saved, notices[entry.id].orEmpty())
                    },
                shown = if (drawn.size == entries.size) null else SheetWords.shown(drawn.size),
                players = entries.size,
                ownTags = SheetTags.own(entries.map { it.tags }),
            )
        }

        /** The editor's chips (RowEditor.svelte): the fixed tags in their order, then the drafter's own, each
         * pressed where it is on his row. */
        fun tagChips(
            line: SheetLine,
            ownTags: List<String>,
        ): List<BoardChip<String>> =
            (SheetTags.fixed.map { it.tag } + ownTags).map { BoardChip(SheetTags.label(it), it, SheetTags.has(line.tagged, it)) }
    }
}
