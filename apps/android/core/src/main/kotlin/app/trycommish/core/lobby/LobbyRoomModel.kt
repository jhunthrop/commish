package app.trycommish.core.lobby

import app.trycommish.api.models.LobbyRoom
import app.trycommish.api.models.RoomCard
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.board.Heat
import app.trycommish.core.companion.CallModel
import app.trycommish.core.companion.CallView
import app.trycommish.core.companion.DraftFormat
import app.trycommish.core.companion.PickStripModel
import app.trycommish.core.companion.PoolLine
import app.trycommish.core.companion.PoolModel
import app.trycommish.core.companion.RoomBoardView
import app.trycommish.core.companion.RoomDraft
import app.trycommish.core.companion.RoomWall
import app.trycommish.core.companion.RoomWords
import app.trycommish.core.companion.StripFace
import app.trycommish.core.companion.TeamLine
import app.trycommish.core.companion.TeamModel
import app.trycommish.core.mock.MockDraw
import app.trycommish.core.mock.MockPool
import app.trycommish.core.mock.MockPoolLine
import app.trycommish.core.mock.MockRoomModel
import app.trycommish.core.mock.MockWords
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant
import kotlin.math.ceil

/** The score bug (ScoreBug.svelte): the round and the pick, who is on the clock, the room's clock, and your pick,
 * "Now" when it is yours. */
data class LobbyScoreBug(
    val round: String,
    val pick: String,
    val onClock: String,
    val clock: String,
    val yourPick: String,
    val yours: Boolean,
    /** What a screen reader hears at ten and five seconds on your own clock, else null. */
    val spoken: String?,
    /** When the turn on the clock runs out, on the room's clock: what [at] redraws the clock from. */
    val deadline: Instant?,
) {
    /** The bug at another moment on the room's clock: only the clock and what is spoken move. */
    fun at(now: Instant): LobbyScoreBug {
        val left = LobbyRoomModel.secondsLeft(deadline, now)
        val mark = LobbyRoomModel.SPOKEN_MARKS.lastOrNull { left <= it }
        return copy(clock = LobbyWords.clock(left), spoken = if (yours) mark?.let(LobbyWords::secondsLeft) else null)
    }
}

/** A seat in the seats strip (SeatsStrip.svelte): a person's seat names him and says how he is; a bot's or an
 * open seat is a compact cell with its number. */
data class LobbySeatCell(
    val id: Int,
    val name: String,
    val line: String,
    val compact: Boolean,
    val open: Boolean,
    val you: Boolean,
    val onClock: Boolean,
    val left: Boolean,
    /** What a screen reader names a compact cell by. */
    val label: String,
)

/** The filling room's line (LobbyRoomView.svelte .wait): the count in bold, then when it starts. */
data class LobbyWait(
    val count: String,
    val words: String,
    val teams: Int,
    /** When the room starts with bots in the open seats, on the room's clock. */
    val starts: Instant?,
) {
    /** The line at another moment on the room's clock: only its countdown moves. */
    fun at(now: Instant): LobbyWait = copy(words = LobbyWords.wait(teams, starts?.let { LobbyRoomModel.secondsLeft(it, now) } ?: 0))
}

/** The room's call (RoomCall.svelte in the lobby): our call, its one verb, and whether the verb drafts (your
 * turn) or queues him first. */
data class LobbyCall(
    val model: CallModel,
    val playerId: String,
    val drafts: Boolean,
)

/**
 * The lobby as LobbyRoomView.svelte draws it at 390, the iOS LobbyRoomModel's: from the room's read, the log's
 * replay, the turn's card and the room's clock; pure, held to shared/fixtures/parity/lobby.json.
 */
data class LobbyRoomModel(
    val bug: LobbyScoreBug?,
    val seats: List<LobbySeatCell>,
    val wait: LobbyWait?,
    val landing: PickStripModel?,
    val call: LobbyCall?,
    val pool: MockPool?,
    val wall: RoomWall,
    val aboutHead: String,
    val about: String,
    val team: TeamModel,
    val yourTurn: Boolean,
    val pickNumber: Int,
) {
    /** The model at another moment on the room's clock: only the score bug's clock and the wait's countdown. */
    fun at(now: Instant): LobbyRoomModel = copy(bug = bug?.at(now), wait = wait?.at(now))

    companion object {
        /** LobbyRoomView.svelte FILTERS. */
        val filters: List<String> = RoomDraft.filters + Words.Mock.queue

        /** ScoreBug.svelte SPOKEN_MARKS. */
        val SPOKEN_MARKS = listOf(10, 5)

        private const val MILLIS = 1_000.0

        /** `now` is the room's clock (the phone's plus the welcome's offset); `filter` the chip and `marked` the
         * marked row. */
        @Suppress("LongParameterList") // The room view's own inputs, as the web's component takes them.
        fun of(
            room: LobbyRoom,
            board: RoomBoardView,
            lobby: LobbyState,
            card: RoomCard?,
            now: Instant,
            filter: String = RoomDraft.ALL,
            marked: String? = null,
        ): LobbyRoomModel {
            val facts = LobbyFacts.of(room, lobby, card, board)
            val wallShown = minOf(room.rounds, facts.round)
            val mine = lobby.picks.filter { it.seat == room.you }.map { it.placed }
            val slots = RoomDraft.team(room.settings.roster, room.settings.lineup, mine, board)
            return LobbyRoomModel(
                bug = bug(facts, lobby, now),
                seats = seats(facts, room, lobby),
                wait = if (facts.started) null else wait(room, now, facts.people),
                landing = landing(lobby, board, room),
                call = call(facts),
                pool = if (lobby.complete) null else pool(facts, board, card, filter, marked),
                wall =
                    RoomWall.of(
                        lobby.picks.map { it.placed },
                        board,
                        facts.names,
                        room.you,
                        room.teams,
                        room.rounds,
                        shown = wallShown,
                        now = if (lobby.drafting) lobby.pickNumber else null,
                    ),
                aboutHead = LobbyWords.aboutHead(room.teams, preset(room)),
                about = LobbyWords.about(facts.people, room.teams, facts.started, room.clockSeconds),
                team =
                    TeamModel(
                        RoomWords.teamCount(slots.count { it.player != null }, room.rounds),
                        slots.map { TeamLine(it.slot, it.player, it.pick?.let { pick -> DraftFormat.pickLabel(pick, room.teams) }) },
                    ),
                yourTurn = facts.yourTurn,
                pickNumber = lobby.pickNumber,
            )
        }

        /** The whole seconds left before a clock runs out, never below none (the web's Math.ceil). */
        fun secondsLeft(
            deadline: Instant?,
            now: Instant,
        ): Int {
            deadline ?: return 0
            val millis = Duration.between(now, deadline).toMillis().toDouble()
            return maxOf(0, ceil(millis / MILLIS).toInt())
        }

        private fun preset(room: LobbyRoom): String =
            room.settings.scoring.preset
                ?.let(RoomWords::preset) ?: RoomWords.preset(DEFAULT_PRESET)

        private val DEFAULT_PRESET = ScoringPreset.ppr

        private fun call(facts: LobbyFacts): LobbyCall? {
            val view = facts.view ?: return null
            val model = MockDraw.callModel(view)
            if (facts.yourTurn) return LobbyCall(model, view.player.id, drafts = true)
            val position =
                model.rows
                    .firstOrNull()
                    ?.player
                    ?.position
                    .orEmpty()
            return LobbyCall(model.copy(verb = LobbyWords.queueFirst(position)), view.player.id, drafts = false)
        }

        private fun bug(
            facts: LobbyFacts,
            lobby: LobbyState,
            now: Instant,
        ): LobbyScoreBug? {
            val yourPick = facts.yourPick
            if (!lobby.drafting || yourPick == null) return null
            val yours = yourPick == lobby.pickNumber
            return LobbyScoreBug(
                round = LobbyWords.round(DraftFormat.snakeSlot(lobby.pickNumber, facts.teams).round),
                pick = LobbyWords.pick(lobby.pickNumber, facts.teams),
                onClock = facts.onClock?.let { facts.names[it - 1] }.orEmpty(),
                clock = "",
                yourPick = if (yours) Words.Lobby.now else LobbyWords.yourPickIn(yourPick, yourPick - lobby.pickNumber, facts.teams),
                yours = yours,
                spoken = null,
                deadline = lobby.deadline,
            ).at(now)
        }

        private fun seats(
            facts: LobbyFacts,
            room: LobbyRoom,
            lobby: LobbyState,
        ): List<LobbySeatCell> =
            (1..maxOf(facts.teams, 1)).map { seat ->
                val kind = lobby.seats[seat]?.kind ?: LobbySeatKind.Open
                val compact = seat != room.you && (kind == LobbySeatKind.Bot || kind == LobbySeatKind.Open)
                val onClock = seat == facts.onClock
                val name = facts.names[seat - 1]
                LobbySeatCell(
                    id = seat,
                    name = name,
                    line = if (onClock) Words.Lobby.seatOnClock else seatLine(kind),
                    compact = compact,
                    open = compact && kind == LobbySeatKind.Open,
                    you = seat == room.you,
                    onClock = onClock,
                    left = kind == LobbySeatKind.Left,
                    label = LobbyWords.seatLabel(name, kind == LobbySeatKind.Open, onClock),
                )
            }

        /** SeatsStrip.svelte status off the clock. */
        private fun seatLine(kind: LobbySeatKind): String =
            when (kind) {
                LobbySeatKind.Left -> Words.Lobby.seatLeft
                LobbySeatKind.Drafter -> Words.Lobby.seatDrafter
                LobbySeatKind.Bot, LobbySeatKind.Open -> Words.Lobby.seatWaiting
            }

        private fun wait(
            room: LobbyRoom,
            now: Instant,
            people: Int,
        ): LobbyWait = LobbyWait("${LobbyWords.fill(people).first}.", "", room.teams, roomInstant(room.fillDeadline)).at(now)

        /** LandingStrip.svelte: the last round of picks, newest first, each credited to who made it. */
        private fun landing(
            lobby: LobbyState,
            board: RoomBoardView,
            room: LobbyRoom,
        ): PickStripModel? {
            val picks = lobby.picks.takeLast(room.teams).reversed()
            val newest = picks.firstOrNull() ?: return null
            val people = picks.count { it.madeBy == LobbyPickBy.Drafter }
            val faces =
                picks.mapIndexedNotNull { index, pick ->
                    board.byId[pick.playerId]?.let { player ->
                        StripFace(
                            pick = pick.pick,
                            player = player,
                            name = DraftFormat.lastName(player.name),
                            lines = LobbySeats.credit(pick, lobby.seats, room.you) + DraftFormat.pickLabel(pick.pick, room.teams),
                            newest = index == 0,
                            strong = pick.madeBy == LobbyPickBy.Drafter,
                        )
                    }
                }
            return PickStripModel(
                lead = DraftFormat.pickLabel(newest.pick, room.teams),
                lines = listOf(Words.Lobby.justTaken, LobbyWords.byPeople(people, picks.size)),
                picks = faces,
            )
        }

        private fun pool(
            facts: LobbyFacts,
            board: RoomBoardView,
            card: RoomCard?,
            filter: String,
            marked: String?,
        ): MockPool {
            val chances = card?.stillThere.orEmpty()
            val chosen = filter.takeIf { it in filters } ?: RoomDraft.ALL
            val players =
                if (chosen == Words.Mock.queue) {
                    facts.queue.mapNotNull { board.byId[it] }
                } else {
                    RoomDraft.pool(board, facts.drafted, chosen)
                }
            val lines =
                players.map { player ->
                    val vor = player.vor
                    val round = player.vorRound
                    PoolLine(
                        player = player,
                        value = RoomWords.value(player),
                        heat = if (vor != null && round != null) Heat.of(vor, round) else null,
                        chance = chances[player.id]?.let(DraftFormat::chanceShort),
                        isCall = player.id == facts.view?.player?.id,
                    )
                }
            val model =
                PoolModel(
                    line = RoomWords.poolLine(board.players.size - facts.drafted.size),
                    basis = RoomWords.poolBasis(board, card, facts.teams),
                    chanceHead = card?.let { Words.Mock.stillThere },
                    chanceLabel = card?.let { LobbyWords.chanceLabel(it.conditional, it.forPick, it.nextPick, facts.teams) }.orEmpty(),
                    missing = RoomWords.chanceMissing(gone = false, read = chances.isNotEmpty()),
                    filter = chosen,
                    rows = lines,
                )
            val queued = facts.queue.toSet()
            return MockPool(
                model = model,
                rows = lines.map { MockPoolLine(it, it.player.id in queued, it.player.id == marked) },
                filters = filters,
                empty = if (lines.isEmpty()) MockWords.poolEmpty(chosen) else null,
                draftShown = facts.yourTurn,
                canDraft = facts.yourTurn,
                readOnly = false,
            )
        }
    }
}

/** What the room reads off its state before it draws (LobbyRoomView.svelte's derived values). */
internal data class LobbyFacts(
    val teams: Int,
    val onClock: Int?,
    val yourTurn: Boolean,
    val yourPick: Int?,
    val round: Int,
    val started: Boolean,
    val people: Int,
    val names: List<String>,
    val drafted: Set<String>,
    val queue: List<String>,
    val view: CallView?,
) {
    companion object {
        fun of(
            room: LobbyRoom,
            lobby: LobbyState,
            card: RoomCard?,
            board: RoomBoardView,
        ): LobbyFacts {
            val teams = room.teams
            val total = teams * room.rounds
            val onClock = if (lobby.drafting && lobby.pickNumber <= total) RoomDraft.seatAt(lobby.pickNumber, teams) else null
            val drafted = lobby.drafted
            // model.ts turnFrom: this pick when it is yours, else your next.
            val yourPick =
                when {
                    !lobby.drafting -> null
                    RoomDraft.seatAt(lobby.pickNumber, teams) == room.you -> lobby.pickNumber
                    else -> MockRoomModel.turnAfter(lobby.pickNumber, room.you, teams, total)
                }
            return LobbyFacts(
                teams = teams,
                onClock = onClock,
                yourTurn = onClock == room.you,
                yourPick = yourPick,
                round = DraftFormat.snakeSlot(minOf(lobby.pickNumber, total), teams).round,
                started = lobby.drafting || lobby.complete,
                people = LobbySeats.people(lobby.seats.values.map { it.kind }),
                names = (1..maxOf(teams, 1)).map { LobbySeats.name(it, lobby.seats[it], room.you) },
                drafted = drafted,
                queue = lobby.queue.filter { it !in drafted },
                view = if (lobby.drafting) card?.let { CallView.of(it, board, drafted, teams) } else null,
            )
        }
    }
}
