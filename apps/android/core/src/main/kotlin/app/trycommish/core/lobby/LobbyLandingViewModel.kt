package app.trycommish.core.lobby

import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import app.trycommish.api.ApiFailure
import app.trycommish.api.models.LeagueSettings
import app.trycommish.api.models.Lineup
import app.trycommish.api.models.LobbyFilling
import app.trycommish.api.models.LobbyFormat
import app.trycommish.api.models.LobbyRoom
import app.trycommish.core.SessionEnd
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** A lobby card (LobbyList.svelte at 390): the format's title, its clock, how many are in the room filling now,
 * and its one verb; the card of a draft the member holds a seat in says "Your seat" and opens that room. */
data class LobbyCard(
    val id: String,
    val format: LobbyFormat,
    val title: String,
    val clock: String,
    val fill: String,
    /** Nobody in yet: words, quiet, not a figure. */
    val empty: Boolean,
    val verb: String,
    /** The room the member is seated in for this format, which the card opens. */
    val seat: String?,
)

/** Where the landing keeps the rooms the member holds a seat in, by format, across a relaunch: the phone's
 * preferences in the app, memory in a test. The seats are one signed-in device's (its owner, the paired device's
 * id, new at every sign-in): another owner reads none, and keeping an owner's seats drops any other's, so a
 * sign-out leaves no seat for the next member. */
interface LobbySeatMemory {
    fun seats(owner: String): Map<String, String>

    fun keep(
        seats: Map<String, String>,
        owner: String,
    )
}

/** Seats kept for the test's life only, with the same one-owner rule. */
class MemoryLobbySeats(
    var owner: String? = null,
    var kept: Map<String, String> = emptyMap(),
) : LobbySeatMemory {
    override fun seats(owner: String): Map<String, String> = if (owner == this.owner) kept else emptyMap()

    override fun keep(
        seats: Map<String, String>,
        owner: String,
    ) {
        this.owner = owner
        kept = seats
    }
}

/** The phone's preferences: one record, its owner and its seats by format, as JSON. */
class PrefsLobbySeats(
    private val prefs: SharedPreferences,
) : LobbySeatMemory {
    override fun seats(owner: String): Map<String, String> {
        val record =
            prefs.getString(KEY, null)?.let {
                try {
                    Json.parseToJsonElement(it).jsonObject
                } catch (e: IllegalArgumentException) {
                    null
                }
            } ?: return emptyMap()
        if ((record[OWNER] as? JsonPrimitive)?.contentOrNull != owner) return emptyMap()
        return (record[SEATS] as? JsonObject)?.mapValues { it.value.jsonPrimitive.content }.orEmpty()
    }

    override fun keep(
        seats: Map<String, String>,
        owner: String,
    ) {
        val record = JsonObject(mapOf(OWNER to JsonPrimitive(owner), SEATS to JsonObject(seats.mapValues { JsonPrimitive(it.value) })))
        prefs.edit().putString(KEY, record.toString()).apply()
    }

    private companion object {
        const val KEY = "lobby.seats"
        const val OWNER = "owner"
        const val SEATS = "seats"
    }
}

/**
 * The open house drafts (the lobby list on the web's /mock/new, where /lobby goes), the iOS
 * LobbyLandingViewModel's: every format with how full its filling room is, a card each, one verb, Join. A join
 * answers the room's id, which the app opens; a join without a handle asks for one first (HandlePrompt.svelte).
 * The rooms the member joined are remembered across a relaunch so their card reads "Your seat" while the seat is
 * still the member's in a room still drafting or filling; every read checks it.
 */
class LobbyLandingViewModel(
    private val reads: LobbyReads,
    private val memory: LobbySeatMemory = MemoryLobbySeats(),
    private val owner: () -> String? = { null },
    private val sessionEnd: SessionEnd = SessionEnd {},
) : ViewModel() {
    private val mutableLobbies = MutableStateFlow<List<LobbyFilling>>(emptyList())
    private val mutableSeated = MutableStateFlow<Map<String, String>>(emptyMap())
    private val mutableBusy = MutableStateFlow(false)
    private val mutableProblem = MutableStateFlow<String?>(null)
    private val mutableHandleFor = MutableStateFlow<LobbyFormat?>(null)
    private val mutableHandleProblem = MutableStateFlow<String?>(null)
    private val mutableRead = MutableStateFlow(false)

    val lobbies: StateFlow<List<LobbyFilling>> = mutableLobbies.asStateFlow()

    /** The rooms joined, by format, while the API still seats the member in them: written through to the memory
     * under the signed-in device. */
    val seated: StateFlow<Map<String, String>> = mutableSeated.asStateFlow()
    val busy: StateFlow<Boolean> = mutableBusy.asStateFlow()
    val problem: StateFlow<String?> = mutableProblem.asStateFlow()

    /** The format a join waits on a handle for, and the API's word on the last handle tried. */
    val handleFor: StateFlow<LobbyFormat?> = mutableHandleFor.asStateFlow()
    val handleProblem: StateFlow<String?> = mutableHandleProblem.asStateFlow()

    /** The list has been read once: the cards draw from then on. */
    val read: StateFlow<Boolean> = mutableRead.asStateFlow()

    /** Whose seats [seated] holds: the signed-in device, read at each load; null keeps nothing. */
    private var signedIn: String? = null

    /** The seats changed: drawn at once and kept for the signed-in device. */
    private fun store(seats: Map<String, String>) {
        mutableSeated.value = seats
        signedIn?.let { memory.keep(seats, it) }
    }

    /** The list's head: "Lobbies filling now" from the first seat taken, else "Open lobbies". */
    val head: String get() = LobbyWords.listHead(mutableLobbies.value.map { it.filling })

    val cards: List<LobbyCard>
        get() =
            mutableLobbies.value.map { lobby ->
                val key = lobby.format.value
                val (fill, empty) = LobbyWords.fill(lobby.filling)
                val seat = mutableSeated.value[key]
                LobbyCard(
                    id = key,
                    format = lobby.format,
                    title = LobbyWords.title(lobby.teams, lobby.scoring, lobby.lineup),
                    clock = LobbyWords.pickClock(lobby.clockSeconds),
                    fill = fill,
                    empty = empty,
                    verb = if (seat == null) Words.Lobby.join else Words.Lobby.yourSeat,
                    seat = seat,
                )
            }

    /** The list read again (on appear and on pull), and each remembered seat checked: one the API no longer
     * holds for the member (403, 404), a room drafted to its end or closed unattended, or a seat the member left
     * is forgotten, so the card offers Join again. A 401 keeps the seat and signs out: the seat is still the
     * member's once they sign in again. */
    suspend fun load() {
        val device = owner()
        if (device != signedIn) {
            signedIn = device
            mutableSeated.value = device?.let(memory::seats).orEmpty()
        }
        try {
            mutableLobbies.value = reads.lobbies()
            mutableProblem.value = null
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (LobbyRefusal.signsOut(e)) sessionEnd.signedOut()
            mutableProblem.value = LobbyRefusal.sentence(e)
        }
        mutableRead.value = true
        mutableSeated.value.forEach { (format, room) -> verify(format, room) }
    }

    private suspend fun verify(
        format: String,
        room: String,
    ) {
        try {
            if (over(reads.lobby(room))) forgetFormat(format)
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            when (LobbyRefusal.status(e)) {
                FORBIDDEN, NOT_FOUND -> forgetFormat(format)
                UNAUTHORIZED -> sessionEnd.signedOut()
                // Offline: the seat stays until a read says otherwise.
                else -> Unit
            }
        }
    }

    private fun forgetFormat(format: String) = store(mutableSeated.value - format)

    /** A card's verb: the room the member is seated in, or a seat in the format's filling room. Null when the API
     * refused (its words in [problem]) or a handle is needed first. */
    suspend fun join(format: LobbyFormat): String? {
        mutableSeated.value[format.value]?.let { return it }
        if (mutableBusy.value) return null
        mutableBusy.value = true
        mutableProblem.value = null
        return try {
            val seat = reads.join(format)
            val room = seat.roomId.toString()
            store(mutableSeated.value + (format.value to room))
            mutableHandleFor.value = null
            room
        } catch (e: CancellationException) {
            throw e
        } catch (e: LobbyHandleNeeded) {
            mutableHandleFor.value = format
            null
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            if (LobbyRefusal.signsOut(e)) sessionEnd.signedOut()
            mutableProblem.value = LobbyRefusal.sentence(e)
            null
        } finally {
            mutableBusy.value = false
        }
    }

    /** The handle saved, then the join it waited on. */
    suspend fun saveHandle(handle: String): String? {
        val format = mutableHandleFor.value ?: return null
        try {
            reads.setHandle(handle.trim())
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            mutableHandleProblem.value = (e as? ApiFailure)?.message?.takeIf { it.isNotEmpty() } ?: Words.Lobby.handleFailed
            return null
        }
        mutableHandleProblem.value = null
        mutableHandleFor.value = null
        return join(format)
    }

    /** The seat given up (Leave), the room drafted to its end, or its report's Join another lobby: its card
     * offers Join again. */
    fun forget(room: String) = store(mutableSeated.value.filterValues { it != room })

    /** A room opened from elsewhere (a closed lobby's Join another lobby): its card reads "Your seat". */
    fun seat(
        room: String,
        format: LobbyFormat,
    ) = store(mutableSeated.value + (format.value to room))

    companion object {
        private const val UNAUTHORIZED = 401
        private const val FORBIDDEN = 403
        private const val NOT_FOUND = 404
        private const val TEN_TEAMS = 10

        /** setup.ts nearestLobby: superflex drafts in the superflex room, ten teams or fewer in the ten-team one,
         * the rest in the twelve-team PPR room. */
        fun nearest(settings: LeagueSettings): LobbyFormat =
            when {
                settings.lineup == Lineup.superflex -> LobbyFormat._12_half_superflex
                settings.teams <= TEN_TEAMS -> LobbyFormat._10_ppr
                else -> LobbyFormat._12_ppr
            }

        /** A room the member's seat is no longer in play in: drafted to its end, closed unattended, or left. */
        fun over(room: LobbyRoom): Boolean {
            val mine = room.seats.firstOrNull { it.seat == room.you }?.let(LobbySeats::kind)
            return room.status == LobbyRoom.Status.complete || room.status == LobbyRoom.Status.abandoned || mine == LobbySeatKind.Left
        }
    }
}
