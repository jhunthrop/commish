package app.trycommish.core.shell

import app.trycommish.core.start.GameRead
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
    /** His board id where the row carries it: his week is read by it when the run's index names no page
     * for his slug. */
    val boardId: String? = null,
)

/** What the screen under the sheet offers him (shelf-state.ts ScreenOffer): the verb in the screen's
 * words, the line under it, what it does there, and whether the screen is one of the lineup's, whose
 * verb gives way to his game's state once it has kicked off (shelf.ts LINEUP_SCREENS). */
class SheetOffer(
    val label: String,
    val line: String?,
    val lineup: Boolean,
    val act: () -> Unit,
) {
    companion object {
        /** shelf-state.ts compareOffer: Compare, the comparison with him on one side (the card's word),
         * opened through `open` with its site link, which the app pushes as its own screen. */
        fun compare(
            player: SheetPlayer,
            open: (String) -> Unit,
        ): SheetOffer = SheetOffer(Words.Card.compare, null, lineup = false) { open(SiteLinks.compare(player.slug)) }
    }
}

/** The sheet's verb (shelf.ts shelfVerb): the screen's offer, or on a lineup screen once his game has
 * kicked off the held words in its place, since no lineup move takes him then. */
sealed interface SheetVerb {
    data class Act(
        val label: String,
        val line: String?,
    ) : SheetVerb

    data class Held(
        val words: String,
    ) : SheetVerb

    companion object {
        /** `game` is his game by his week's line once his card is read, null before. */
        fun of(
            offer: SheetOffer?,
            game: GameRead?,
        ): SheetVerb? {
            if (offer == null) return null
            if (offer.lineup && game == GameRead.Final) return Held(Words.Card.gameFinal)
            if (offer.lineup && game == GameRead.KickedOff) return Held(Words.Card.kickedOff)
            return Act(offer.label, offer.line)
        }
    }
}

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

/** card.ts unreadBasis: what the week's tiles are, read as the sheet opens, or why they show "--"; a
 * listed player's week tiles say his list, read or not (Lane 128). */
fun unreadBasis(
    failed: Boolean,
    weekTile: String,
    listed: String? = null,
): String {
    if (listed != null) return Words.Card.listedWeek
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

    /** What is free (links.pass(), the account's plan card's link in the free season). */
    const val PASS = "$ORIGIN/pass"

    /** The two legal pages (legal/legal-links.ts), named at the account's foot. */
    const val PRIVACY = "$ORIGIN/privacy"
    const val TERMS = "$ORIGIN/terms"

    /** The one address a member writes to (legal/contact.ts SUPPORT_HREF). */
    const val SUPPORT = "mailto:${Words.Support.email}"

    /** A player's page, /players/<slug>. */
    fun player(slug: String): String = "$ORIGIN/players/$slug"

    /** ADP for a format as the run names it (links.ts adp): /adp/ppr-12. */
    fun adp(format: String): String = "$ORIGIN/adp/$format"

    /** Every club (links.ts clubs). */
    const val CLUBS = "$ORIGIN/clubs"

    /** A club's page by its abbreviation, lower case (links.ts club): /clubs/ari. */
    fun club(abbr: String): String = "$CLUBS/${abbr.lowercase()}"

    /** The strength of schedule (links.ts schedule). */
    const val SCHEDULE = "$ORIGIN/schedule"

    /** Compare with the sides by their pages' slugs (links.ts compare): /compare?a=chris-olave&b=nico-collins. */
    fun compare(
        first: String? = null,
        second: String? = null,
    ): String {
        val query = listOfNotNull(first?.let { "a=$it" }, second?.let { "b=$it" }).joinToString("&")
        return "$ORIGIN/compare${if (query.isEmpty()) "" else "?$query"}"
    }

    /** The reference pages the app draws by their site paths (links.ts): /adp/<format>, /compare?a=&b=,
     * /clubs, /clubs/<abbr>, /schedule; null for any other link, which the app leaves to the site. */
    fun reference(link: String): ShellRoute? {
        val rest = link.removePrefix("$ORIGIN/").takeIf { it != link } ?: return null
        val path = rest.substringBefore('?').substringBefore('#').trimEnd('/')
        val query =
            rest
                .substringAfter('?', "")
                .substringBefore('#')
                .split('&')
                .mapNotNull { pair -> pair.split('=', limit = 2).takeIf { it.size == 2 && it[1].isNotEmpty() }?.let { it[0] to it[1] } }
                .toMap()
        val parts = path.split('/').filter { it.isNotEmpty() }
        return when {
            parts.size == 2 && parts[0] == "adp" -> ShellRoute.Adp(parts[1])
            parts == listOf("compare") -> ShellRoute.Compare(query["a"], query["b"])
            parts == listOf("clubs") -> ShellRoute.Clubs
            parts.size == 2 && parts[0] == "clubs" -> ShellRoute.Club(parts[1])
            parts == listOf("schedule") -> ShellRoute.Schedule
            else -> null
        }
    }

    /** The live-draft companion's pages the app draws by their site paths (links.ts companionNew and
     * companion): /companion/new (`?replay=1` for the development replay) and /companion/<id>; null for any
     * other link. */
    fun companion(link: String): ShellRoute? {
        val rest = link.removePrefix("$ORIGIN/companion/").takeIf { it != link } ?: return null
        val path = rest.substringBefore('?').substringBefore('#').trimEnd('/')
        if (path.isEmpty() || '/' in path) return null
        val replay =
            rest
                .substringAfter('?', "")
                .substringBefore('#')
                .split('&')
                .contains("replay=1")
        return if (path == COMPANION_START) ShellRoute.CompanionNew(replay) else ShellRoute.Companion(path)
    }

    /** The mock room's pages the app draws by their site paths (links.ts mockSetup, mockLeague and
     * sharedMock, nav.ts MOCK_SETUP): /mock and /mock/new the setup, on the saved league `?league=` names,
     * and /mock/share/<code> a shared draft; null for any other link (a room by its id stays on the site). */
    fun mock(link: String): ShellRoute? {
        val rest = link.removePrefix("$ORIGIN/").takeIf { it != link } ?: return null
        val parts =
            rest
                .substringBefore('?')
                .substringBefore('#')
                .split('/')
                .filter { it.isNotEmpty() }
        val league =
            rest
                .substringAfter('?', "")
                .substringBefore('#')
                .split('&')
                .firstNotNullOfOrNull { pair -> pair.removePrefix("league=").takeIf { it != pair && it.isNotEmpty() } }
        return when {
            parts == listOf("mock") || parts == listOf("mock", "new") -> ShellRoute.MockSetup(league)
            parts.size == MOCK_SHARE_PARTS && parts[0] == "mock" && parts[1] == "share" -> ShellRoute.SharedMock(parts[2])
            else -> null
        }
    }

    /** /mock/share/<code>: three parts. */
    private const val MOCK_SHARE_PARTS = 3

    /** The companion's start page's last segment (nav.ts COMPANION_START). */
    private const val COMPANION_START = "new"

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

    /** What the screen the sheet opened from offers him, null where it offers none. */
    var offer: SheetOffer? = null
        private set

    fun open(
        player: SheetPlayer,
        offer: SheetOffer? = null,
    ) {
        this.offer = offer
        mutableShown.value = player
    }

    fun close() {
        offer = null
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
