package app.trycommish.core.shell

import app.trycommish.design.Site
import app.trycommish.design.Words
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** A player as the row that opens his sheet drew him: the row's own facts, which the sheet's head shows
 * before anything else is read (web/src/lib/player/shelf.ts shelfHead). */
data class SheetPlayer(
    /** His id: what the sheet holds, so it keeps him whatever the list under it does. */
    val id: String,
    /** His page's address on the site, /players/<slug>. */
    val slug: String,
    val name: String,
    /** His position, null where the row draws none. */
    val position: String?,
    /** His rank at the position as the row draws it, or the list he is on ("IR"); null with none. */
    val rank: String?,
    /** His club as the row draws it. */
    val club: String?,
    /** His face as the row draws it, null with none (headshotOf). */
    val headshot: String?,
)

/**
 * The sheet's frame (the web's player shelf, PlayerShelf.svelte): his name, position pill and club in
 * the head from the row, his full page on the site, and the words the shelf shows while his week is
 * read, which the body says until the player sheet's own lane fills it.
 */
data class PlayerSheetModel(
    val name: String,
    /** His face: the row's headshot, his initials while it loads and where there is none. */
    val headshot: String?,
    val initials: String,
    /** "WR 4", "RB IR", or his position alone; null where the row draws none. */
    val pill: String?,
    val club: String?,
    /** His page on the site, an app link the app routes to his page. */
    val fullPage: String,
    val fullPageWords: String,
    val closeWords: String,
    val loading: String,
)

fun playerSheetModel(player: SheetPlayer): PlayerSheetModel =
    PlayerSheetModel(
        name = player.name,
        headshot = player.headshot,
        initials = initialsOf(player.name),
        pill = player.position?.let { position -> player.rank?.let { "$position $it" } ?: position },
        club = player.club,
        fullPage = SiteLinks.player(player.slug),
        fullPageWords = Words.Shelf.fullPage,
        closeWords = Words.Shelf.close,
        loading = unreadBasis(failed = false, weekTile = Words.Card.proj),
    )

/** card.ts unreadBasis for a player on no list: what the week's tiles are, read as the sheet opens, or
 * why they show "--". */
fun unreadBasis(
    failed: Boolean,
    weekTile: String,
): String {
    val tiles = "$weekTile, ${Words.Card.opp} and ${Words.Card.delta}"
    return if (failed) {
        "$tiles show \"${Words.Card.none}\" because this week's figures could not be read just now."
    } else {
        "$tiles are this week's, read as the page opens."
    }
}

/** His face where the API gives an https address (the app loads no other), else none. */
fun headshotOf(address: String?): String? = address?.takeIf { it.startsWith("https://") }

/** Name suffixes that are never the last name (web/src/lib/ui/initials.ts). */
private val SUFFIXES = setOf("jr", "sr", "ii", "iii", "iv", "v")

/** initials.ts initialsOf: the first name's and the last name's letters, "Ja'Marr Chase" is "JC", a
 * one-word name its first two letters. */
fun initialsOf(name: String): String {
    val words =
        name
            .split(Regex("\\s+"))
            .map { word -> word.filter(Char::isLetter) }
            .filter { it.isNotEmpty() && it.lowercase() !in SUFFIXES }
    val first = words.firstOrNull() ?: return ""
    val last = if (words.size > 1) words.last() else null
    return (if (last == null) first.take(2) else "${first.first()}${last.first()}").uppercase()
}

/** The site's addresses the app links to. */
object SiteLinks {
    /** The site, whose assetlinks.json hands its app-link paths to the app. */
    const val ORIGIN = Site.ORIGIN

    /** Our record, past weeks of our order (the Lineup strip's link, web links.record()). */
    const val RECORD = "$ORIGIN/record"

    /** Following a league (verb-links.ts verbHref follow and open_league). */
    const val LEAGUE_START = "$ORIGIN/league/new"

    /** A mock draft's setup (verbHref mock). */
    const val MOCK_SETUP = "$ORIGIN/mock/new"

    /** The cheat sheet (verbHref sheet). */
    const val SHEET = "$ORIGIN/sheet"

    /** A player's page, /players/<slug>. */
    fun player(slug: String): String = "$ORIGIN/players/$slug"

    /** The slug of a link to a player's page on the site, null for any other link. */
    fun playerSlug(link: String): String? =
        link
            .removePrefix("$ORIGIN/players/")
            .takeIf { it != link && it.isNotEmpty() && '/' !in it && '?' !in it && '#' !in it }
}

/**
 * The sheet a screen presents from its rows: the player shown, by his id. A screen whose list reads
 * again hands the new rows here, and the sheet keeps the player it opened on, his fresh facts when the
 * list still has him (plan Review Focus 3).
 */
class PlayerSheetHost {
    private val mutableShown = MutableStateFlow<SheetPlayer?>(null)

    /** The player the sheet shows, null while it is closed. */
    val shown: StateFlow<SheetPlayer?> = mutableShown.asStateFlow()

    fun open(player: SheetPlayer) {
        mutableShown.value = player
    }

    fun close() {
        mutableShown.value = null
    }

    /** The member tapped Full page: the sheet closes as his page opens, so the page is never under
     * it. The route to his page, null (and the sheet left open) for a link that is not one. */
    fun followFullPage(link: String): ShellRoute.Player? {
        val slug = SiteLinks.playerSlug(link) ?: return null
        close()
        return ShellRoute.Player(slug)
    }

    /** The screen under the sheet read its list again: the sheet keeps its player. */
    fun parentRefreshed(rows: List<SheetPlayer>) {
        val held = mutableShown.value ?: return
        mutableShown.value = rows.firstOrNull { it.id == held.id } ?: held
    }
}
