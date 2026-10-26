import CommishAPI
import CommishDesign
import Foundation

/// The score bug (ScoreBug.svelte): the round and the pick, who is on the clock, the room's clock, and
/// your pick, "Now" when it is yours.
public struct LobbyScoreBug: Equatable, Sendable {
    public let round: String
    public let pick: String
    public let onClock: String
    public let clock: String
    public let yourPick: String
    public let yours: Bool
    /// What a screen reader hears at ten and five seconds on your own clock, else nil.
    public let spoken: String?
    /// When the turn on the clock runs out, on the room's clock: what `at` redraws the clock from.
    public let deadline: Date?

    /// The bug at another moment on the room's clock: only the clock and what is spoken move.
    public func at(_ now: Date) -> LobbyScoreBug {
        let left = LobbyRoomModel.secondsLeft(deadline, now: now)
        let mark = LobbyRoomModel.spokenMarks.last { left <= $0 }
        return LobbyScoreBug(
            round: round, pick: pick, onClock: onClock, clock: LobbyWords.clock(left), yourPick: yourPick,
            yours: yours, spoken: yours ? mark.map(LobbyWords.secondsLeft) : nil, deadline: deadline
        )
    }
}

/// A seat in the seats strip (SeatsStrip.svelte): a person's seat names him and says how he is; a
/// bot's or an open seat is a compact cell with its number.
public struct LobbySeatCell: Equatable, Sendable, Identifiable {
    public let id: Int
    public let name: String
    public let line: String
    public let compact: Bool
    public let open: Bool
    public let you: Bool
    public let onClock: Bool
    public let left: Bool
    /// What a screen reader names a compact cell by.
    public let label: String
}

/// The filling room's line (LobbyRoomView.svelte .wait): the count in bold, then when it starts.
public struct LobbyWait: Equatable, Sendable {
    public let count: String
    public let words: String
    public let teams: Int
    /// When the room starts with bots in the open seats, on the room's clock.
    public let starts: Date?

    /// The line at another moment on the room's clock: only its countdown moves.
    public func at(_ now: Date) -> LobbyWait {
        let left = starts.map { LobbyRoomModel.secondsLeft($0, now: now) } ?? 0
        return LobbyWait(
            count: count, words: LobbyWords.wait(teams: teams, secondsLeft: left), teams: teams, starts: starts
        )
    }
}

/// The room's call (RoomCall.svelte in the lobby): our call, its one verb, and whether the verb drafts
/// (your turn) or queues him first.
public struct LobbyCall: Equatable, Sendable {
    public let model: CallModel
    public let playerID: String
    public let drafts: Bool
}

/// The lobby as LobbyRoomView.svelte draws it at 390, from the room's read, the log's replay, the turn's
/// card and the room's clock: pure, held to shared/fixtures/parity/lobby.json.
public struct LobbyRoomModel: Equatable, Sendable {
    public let bug: LobbyScoreBug?
    public let seats: [LobbySeatCell]
    public let wait: LobbyWait?
    public let landing: PickStripModel?
    public let call: LobbyCall?
    public let pool: MockPool?
    public let wall: RoomWall
    public let aboutHead: String
    public let about: String
    public let team: TeamModel
    public let yourTurn: Bool
    public let pickNumber: Int

    /// LobbyRoomView.svelte FILTERS.
    public static let filters = RoomDraft.filters + [Words.Mock.queue]
    /// ScoreBug.svelte SPOKEN_MARKS.
    static let spokenMarks = [10, 5]

    /// `now` is the room's clock (the phone's plus the welcome's offset); `filter` the chip and `marked`
    /// the marked row.
    public init(
        room: LobbyRoom, board: RoomBoardView, lobby: LobbyState, card: RoomCard?, now: Date, filter: String = "All",
        marked: String? = nil
    ) {
        let facts = Facts(room: room, lobby: lobby, card: card, board: board)
        pickNumber = lobby.pickNumber
        yourTurn = facts.yourTurn
        bug = Self.bug(facts, room: room, lobby: lobby, now: now)
        seats = Self.seats(facts, room: room, lobby: lobby)
        wait = facts.started ? nil : Self.wait(room: room, lobby: lobby, now: now, people: facts.people)
        landing = Self.landing(lobby, board: board, room: room)
        call = facts.view.map { view in
            LobbyCall(
                model: MockRoomModel.callModel(view), playerID: view.player.id, drafts: facts.yourTurn
            )
        }.map { call in
            facts.yourTurn ? call : LobbyCall(
                model: CallModel(
                    tag: call.model.tag, chanceHead: call.model.chanceHead,
                    verb: LobbyWords.queueFirst(call.model.rows.first?.player.position ?? ""),
                    waiting: call.model.waiting, rows: call.model.rows
                ),
                playerID: call.playerID, drafts: false
            )
        }
        pool = lobby.complete ? nil : Self.pool(facts, board: board, card: card, filter: filter, marked: marked)
        wall = RoomWall(
            picks: lobby.picks.map(\.placed), board: board, names: facts.names, you: room.you, teams: room.teams,
            rounds: room.rounds, shown: min(room.rounds, facts.round), now: lobby.drafting ? lobby.pickNumber : nil
        )
        aboutHead = LobbyWords.aboutHead(teams: room.teams, preset: RoomWords.preset(Self.preset(room)))
        about = LobbyWords.about(
            people: facts.people, teams: room.teams, started: facts.started, clockSeconds: room.clockSeconds
        )
        let mine = lobby.picks.filter { $0.seat == room.you }.map(\.placed)
        let slots = RoomDraft.team(room.settings, mine: mine, board: board)
        team = TeamModel(
            count: RoomWords.teamCount(slots.count { $0.player != nil }, of: room.rounds),
            slots: slots.enumerated().map { index, slot in
                TeamLine(
                    id: index, slot: slot.slot, player: slot.player,
                    pick: slot.pick.map { DraftFormat.pickLabel($0, teams: room.teams) }
                )
            }
        )
    }

    /// What the room reads off its state before it draws (LobbyRoomView.svelte's derived values).
    struct Facts {
        let teams: Int
        let total: Int
        let onClock: Int?
        let yourTurn: Bool
        let yourPick: Int?
        let round: Int
        let started: Bool
        let people: Int
        let names: [String]
        let drafted: Set<String>
        let queue: [String]
        let view: CallView?

        init(room: LobbyRoom, lobby: LobbyState, card: RoomCard?, board: RoomBoardView) {
            teams = room.teams
            total = room.teams * room.rounds
            onClock = lobby.drafting && lobby.pickNumber <= total ? RoomDraft
                .seatAt(lobby.pickNumber, teams: teams) : nil
            yourTurn = onClock == room.you
            // model.ts turnFrom: this pick when it is yours, else your next.
            yourPick = !lobby.drafting ? nil
                : RoomDraft.seatAt(lobby.pickNumber, teams: room.teams) == room.you ? lobby.pickNumber
                : MockRoomModel.turnAfter(lobby.pickNumber, seat: room.you, teams: room.teams, total: total)
            round = DraftFormat.snakeSlot(min(lobby.pickNumber, total), teams: teams).round
            started = lobby.drafting || lobby.complete
            people = LobbySeats.people(Array(lobby.seats.values.map(\.kind)))
            names = (1 ... max(teams, 1)).map { LobbySeats.name($0, state: lobby.seats[$0], you: room.you) }
            drafted = lobby.drafted
            queue = lobby.queue.filter { !lobby.drafted.contains($0) }
            let size = room.teams
            view = lobby.drafting
                ? card.flatMap { CallView($0, board: board, drafted: lobby.drafted, teams: size) } : nil
        }
    }

    static func preset(_ room: LobbyRoom) -> String {
        let preset = room.settings.scoring.preset?.value1
        return preset?.value1?.rawValue ?? preset?.value2 ?? "ppr"
    }

    static func bug(_ facts: Facts, room _: LobbyRoom, lobby: LobbyState, now: Date) -> LobbyScoreBug? {
        guard lobby.drafting, let yourPick = facts.yourPick else {
            return nil
        }
        let yours = yourPick == lobby.pickNumber
        return LobbyScoreBug(
            round: LobbyWords.round(DraftFormat.snakeSlot(lobby.pickNumber, teams: facts.teams).round),
            pick: LobbyWords.pick(lobby.pickNumber, teams: facts.teams),
            onClock: facts.onClock.map { facts.names[$0 - 1] } ?? "",
            clock: "",
            yourPick: yours
                ? Words.Lobby.now
                : LobbyWords.yourPickIn(yourPick, away: yourPick - lobby.pickNumber, teams: facts.teams),
            yours: yours, spoken: nil, deadline: lobby.deadline
        ).at(now)
    }

    /// The whole seconds left before a clock runs out, never below none (the web's Math.ceil).
    public static func secondsLeft(_ deadline: Date?, now: Date) -> Int {
        guard let deadline else {
            return 0
        }
        let millis = (deadline.timeIntervalSince(now) * 1000).rounded()
        return max(0, Int((millis / 1000).rounded(.up)))
    }

    static func seats(_ facts: Facts, room: LobbyRoom, lobby: LobbyState) -> [LobbySeatCell] {
        (1 ... max(facts.teams, 1)).map { seat in
            let kind = lobby.seats[seat]?.kind ?? .open
            let compact = seat != room.you && (kind == .bot || kind == .open)
            let onClock = seat == facts.onClock
            let line = onClock ? Words.Lobby.seatOnClock : seatLine(kind)
            let name = facts.names[seat - 1]
            return LobbySeatCell(
                id: seat, name: name, line: line, compact: compact, open: compact && kind == .open,
                you: seat == room.you, onClock: onClock, left: kind == .left,
                label: LobbyWords.seatLabel(name, open: kind == .open, onClock: onClock)
            )
        }
    }

    /// SeatsStrip.svelte status off the clock.
    static func seatLine(_ kind: LobbySeatKind) -> String {
        switch kind {
        case .left: Words.Lobby.seatLeft
        case .drafter: Words.Lobby.seatDrafter
        default: Words.Lobby.seatWaiting
        }
    }

    static func wait(room: LobbyRoom, lobby _: LobbyState, now: Date, people: Int) -> LobbyWait {
        LobbyWait(
            count: "\(LobbyWords.fill(people).words).", words: "", teams: room.teams,
            starts: room.fillDeadline
        ).at(now)
    }

    /// LandingStrip.svelte: the last round of picks, newest first, each credited to who made it.
    static func landing(_ lobby: LobbyState, board: RoomBoardView, room: LobbyRoom) -> PickStripModel? {
        let picks = Array(lobby.picks.suffix(room.teams).reversed())
        guard let newest = picks.first else {
            return nil
        }
        let people = picks.count { $0.madeBy == .drafter }
        let faces = picks.enumerated().compactMap { index, pick -> StripFace? in
            board.byID[pick.playerID].map { player in
                StripFace(
                    id: pick.pick, player: player, name: DraftFormat.lastName(player.name),
                    lines: LobbySeats.credit(pick, seats: lobby.seats, you: room.you)
                        + [DraftFormat.pickLabel(pick.pick, teams: room.teams)],
                    newest: index == 0, strong: pick.madeBy == .drafter
                )
            }
        }
        return PickStripModel(
            lead: DraftFormat.pickLabel(newest.pick, teams: room.teams),
            lines: [Words.Lobby.justTaken, LobbyWords.byPeople(people, of: picks.count)], picks: faces
        )
    }

    static func pool(
        _ facts: Facts,
        board: RoomBoardView,
        card: RoomCard?,
        filter: String,
        marked: String?
    ) -> MockPool {
        let chances = card?.stillThere.additionalProperties ?? [:]
        let chosen = filters.contains(filter) ? filter : "All"
        let players = chosen == Words.Mock.queue
            ? facts.queue.compactMap { board.byID[$0] }
            : RoomDraft.pool(board, drafted: facts.drafted, filter: chosen)
        let lines = players.map { player in
            PoolLine(
                player: player, value: RoomWords.value(player),
                heat: player.vor.flatMap { vor in player.vorRound.map { Heat.of(vor: vor, round: $0) } },
                chance: chances[player.id].map(DraftFormat.chanceShort), isCall: player.id == facts.view?.player.id
            )
        }
        let model = PoolModel(
            line: RoomWords.poolLine(board.players.count - facts.drafted.count),
            basis: RoomWords.poolBasis(board, card: card, teams: facts.teams),
            chanceHead: card == nil ? nil : Words.Mock.stillThere,
            chanceLabel: chanceLabel(card, teams: facts.teams),
            missing: RoomWords.chanceMissing(gone: false, read: !chances.isEmpty), filter: chosen, rows: lines
        )
        let queued = Set(facts.queue)
        return MockPool(
            model: model,
            rows: lines.map { MockPoolLine(line: $0, queued: queued.contains($0.id), marked: $0.id == marked) },
            filters: filters, empty: lines.isEmpty ? MockWords.poolEmpty(filter: chosen) : nil,
            draftShown: facts.yourTurn, canDraft: facts.yourTurn, readOnly: false
        )
    }

    /// LobbyRoomView.svelte chanceLabel: what the pool's chances are of.
    static func chanceLabel(_ card: RoomCard?, teams: Int) -> String {
        guard let card else {
            return ""
        }
        if card.conditional {
            return "reaches \(DraftFormat.pickLabel(card.forPick, teams: teams))"
        }
        return card.nextPick.map { "still there at \(DraftFormat.pickLabel($0, teams: teams))" } ?? Words.Mock.lastPick
    }
}
