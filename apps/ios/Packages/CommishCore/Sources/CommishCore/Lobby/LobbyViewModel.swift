import CommishAPI
import CommishDesign
import Foundation
import Observation

/// A room read that will never work, in the lobby's words (notice.ts, subject lobby): signed out, no
/// seat in the room, or no such room; and any other failure in the API's sentence.
public enum LobbyRefusal {
    /// 401, 403 and 404 are final (api.ts isFinalRefusal): no read or socket is tried again.
    public static func isFinal(_ error: any Error) -> Bool {
        status(error) != nil
    }

    static func status(_ error: any Error) -> Int? {
        switch error {
        case APIError.status(401), APIError.envelope(code: "unauthorized", _): 401
        case APIError.status(403), APIError.envelope(code: "forbidden", _): 403
        case APIError.status(404), APIError.envelope(code: "not_found", _): 404
        default: nil
        }
    }

    /// notice.ts noticeFor with subject lobby.
    public static func sentence(_ error: any Error) -> String {
        sentence(status: status(error)) ?? {
            switch error {
            case let APIError.envelope(_, message) where !message.isEmpty: message
            default: Words.Mock.unreachable
            }
        }()
    }

    static func sentence(status: Int?) -> String? {
        switch status {
        case 401: Words.Lobby.signedOut
        case 403: Words.Lobby.noSeat
        case 404: Words.Lobby.gone
        default: nil
        }
    }
}

/// The lobby room's view model (web/src/routes/lobby/[id]/+page.svelte): the API, the socket's
/// connector and token, the clock and the timer injected. The room is read once over HTTP (its seats,
/// board and socket), then its state is the log's replay over the room's socket, never a local guess:
/// the welcome and every update. A pick and the queue go over the socket as commands and land as rows;
/// Leave goes through HTTP. The clock is the room's: the welcome's offset on the phone's clock. A room
/// read refused for good (401, 403, 404) stops here (B208): nothing polls a refused draft. Rows that
/// skip a seq read the room again and replay the whole log from the welcome (B219).
@MainActor
@Observable
public final class LobbyViewModel {
    public enum State: Equatable, Sendable {
        case loading
        case room
        /// The room could not be read; `final` when no retry can fix it.
        case failed(String, final: Bool)
    }

    public private(set) var state: State = .loading
    public private(set) var room: LobbyRoom? {
        didSet { redraw() }
    }

    public private(set) var board: RoomBoardView?
    public private(set) var lobby: LobbyState? {
        didSet { redraw() }
    }

    public private(set) var card: RoomCard? {
        didSet { redraw() }
    }

    /// The pool's chip and the marked row.
    public private(set) var filter = "All" {
        didSet { redraw() }
    }

    public private(set) var marked: String? {
        didSet { redraw() }
    }

    /// The room as the screen draws it, built when its state changes (a row, the card, the chip, the
    /// mark), never on the clock's tick: the score bug and the filling line redraw their countdowns
    /// from it (`LobbyScoreBug.at`, `LobbyWait.at`) on the room's clock.
    public private(set) var drawn: LobbyRoomModel?
    /// The socket stopped for good: the room's sentence.
    public private(set) var stopped: String?
    public private(set) var leaving = false
    /// A leave the API refused, in its words, over the room.
    public private(set) var problem: String?

    public let id: String
    private let api: any LobbyAPI
    private let connector: any RoomConnector
    private let tokens: any TokenSource
    private let clock: any Clock
    private let timer: any PollTimer
    private let onSignedOut: @MainActor () -> Void
    private var socket: RoomSocket?
    private var cardFor = -1
    /// A resync's fresh state, which the welcome's whole log replays onto.
    private var rebuilding: LobbyState?

    public init(
        id: String, api: any LobbyAPI, connector: any RoomConnector, tokens: any TokenSource, clock: any Clock,
        timer: any PollTimer = SystemPollTimer(), onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.id = id
        self.api = api
        self.connector = connector
        self.tokens = tokens
        self.clock = clock
        self.timer = timer
        self.onSignedOut = onSignedOut
    }

    /// The room for the screen's whole life: read it, then hold its socket until the screen goes (the
    /// calling task's cancellation closes the socket with 1000). Run again after a read that did not go
    /// (Try again) it reads the room afresh; a room refused for good or a socket stopped for good is
    /// never tried again (B208, B252).
    public func run() async {
        if stopped != nil {
            return
        }
        if case .failed(_, final: true) = state {
            return
        }
        guard await load(), let socket else {
            return
        }
        await socket.run()
        stopped = socket.stopped ?? socket.refusedStatus.flatMap { LobbyRefusal.sentence(status: $0) }
    }

    /// The room's read; false when it failed.
    @discardableResult
    func load() async -> Bool {
        state = .loading
        do {
            let read = try await api.lobby(id: id)
            // A run the screen cancelled (it went, or Try again started another) shows nothing.
            try Task.checkCancellation()
            guard let url = URL(string: read.socketUrl) else {
                throw APIError.emptyEnvelope
            }
            show(read)
            socket = RoomSocket(
                url: url, connector: connector, tokens: tokens, clock: clock, timer: timer,
                onRows: { [weak self] rows in self?.apply(rows) },
                onSignedOut: onSignedOut,
                onGap: { [weak self] in await self?.resync() ?? false }
            )
            return true
        } catch where error is CancellationError || Task.isCancelled {
            // A cancelled read is not a failure (Android rethrows CancellationException): no failed screen.
            return false
        } catch {
            fail(error)
            return false
        }
    }

    private func show(_ read: LobbyRoom) {
        board = RoomBoardView(read.board, teams: read.teams)
        room = read
        lobby = LobbyState(room: read)
        state = .room
    }

    private func redraw() {
        drawn = model(at: clock.now)
    }

    private func fail(_ error: any Error) {
        let final = LobbyRefusal.isFinal(error)
        if LobbyRefusal.status(error) == 401 {
            onSignedOut()
        }
        state = .failed(LobbyRefusal.sentence(error), final: final)
    }

    /// B219: the room read again, its state started over for the welcome's whole log to replay onto.
    func resync() async -> Bool {
        do {
            let read = try await api.lobby(id: id)
            room = read
            rebuilding = LobbyState(room: read)
            cardFor = -1
            return true
        } catch {
            if LobbyRefusal.isFinal(error) {
                fail(error)
                return false
            }
            return true
        }
    }

    func apply(_ rows: [RoomRow]) {
        guard let room, let base = rebuilding ?? lobby else {
            return
        }
        rebuilding = nil
        let next = base.applying(rows, you: room.you)
        lobby = next
        if let card, card.pickNumber != next.pickNumber {
            self.card = nil
        }
        Task { await loadCard(next) }
    }

    /// The turn's card, once per pick, kept only while the room is still at that pick.
    func loadCard(_ state: LobbyState) async {
        guard state.drafting, !state.complete, cardFor != state.pickNumber else {
            return
        }
        cardFor = state.pickNumber
        do {
            let next = try await api.lobbyCard(id: id)
            if lobby?.pickNumber == state.pickNumber {
                card = next
            }
        } catch {
            // The room drafts without a card; the next pick brings one.
            card = nil
        }
    }

    // MARK: what the screen reads

    /// The socket's status, connecting before it exists.
    public var status: RoomSocket.Status {
        socket?.status ?? .connecting
    }

    /// The room's notice line: reconnecting, or the last command the room refused in its words. The
    /// refusal is the socket's own: a pick that goes out puts it away, every new error frame shows
    /// it again, and a welcome clears it, so no dismissal can outlive the action it answered (B252).
    public var notice: String? {
        if status == .reconnecting {
            return Words.Lobby.reconnecting
        }
        return problem ?? socket?.refusal
    }

    /// The room's clock: the phone's plus the latest welcome's offset.
    public func roomNow(_ phone: Date) -> Date {
        phone.addingTimeInterval(socket?.offset ?? 0)
    }

    /// Whether the room still takes people: drafting or filling, read, not stopped.
    public var open: Bool {
        guard let lobby, state == .room, stopped == nil else {
            return false
        }
        return !lobby.complete && !lobby.abandoned
    }

    /// The room as the screen draws it at the phone's `now`.
    public func model(at phone: Date) -> LobbyRoomModel? {
        guard let room, let board, let lobby else {
            return nil
        }
        return LobbyRoomModel(
            room: room, board: board, lobby: lobby, card: card, now: roomNow(phone), filter: filter, marked: marked
        )
    }

    /// Leave's question: what happens to the seat.
    public var leaveQuestion: String {
        lobby?.drafting == true ? Words.Lobby.leaveDrafting : Words.Lobby.leaveFilling
    }

    // MARK: verbs

    /// Draft a player: the pick on the clock, as a command; it lands when its row comes back.
    public func draft(_ player: String?) async {
        guard let player, let lobby, let room, open,
              RoomDraft.seatAt(lobby.pickNumber, teams: room.teams) == room.you, lobby.drafting
        else {
            // Off the clock nothing is sent, so the refusal stays (B252; the page clears `refused`
            // only in onpick).
            return
        }
        marked = nil
        // A pick that goes out puts the room's last refusal away (the socket's send clears it, the
        // page's `refused = null`); one that cannot go (reconnecting) leaves it for the welcome.
        await socket?.send(.pick(playerID: player, pick: lobby.pickNumber))
    }

    /// Queue or unqueue a player: the whole queue as a command.
    public func toggleQueue(_ player: String) async {
        guard let lobby, open else {
            return
        }
        let queue = lobby.queue.filter { !lobby.drafted.contains($0) }
        await socket?.send(.queue(queue.contains(player) ? queue.filter { $0 != player } : queue + [player]))
    }

    /// "Queue him first": to the front of the queue.
    public func queueFirst(_ player: String) async {
        guard let lobby, open else {
            return
        }
        let queue = lobby.queue.filter { !lobby.drafted.contains($0) && $0 != player }
        await socket?.send(.queue([player] + queue))
    }

    public func mark(_ player: String) {
        marked = marked == player ? nil : player
    }

    public func choose(filter: String) {
        self.filter = filter
    }

    /// Leave the lobby through the API; true when the seat is given up and the room can close. A
    /// refusal shows in the room's notice.
    public func leave() async -> Bool {
        leaving = true
        problem = nil
        defer { leaving = false }
        do {
            try await api.leave(id: id)
            await socket?.close()
            return true
        } catch {
            if LobbyRefusal.status(error) == 401 {
                onSignedOut()
            }
            problem = LobbyRefusal.sentence(error)
            return false
        }
    }

    /// A closed lobby's verb: a seat in the next one filling in the same format, its room's id.
    public func joinAnother() async -> String? {
        guard let room else {
            return nil
        }
        do {
            let seat = try await api.join(room.format)
            await socket?.close()
            return seat.roomId
        } catch {
            problem = (error as? LobbyHandleNeeded)?.message ?? LobbyRefusal.sentence(error)
            return nil
        }
    }

    /// Close the room without leaving: the socket ends with 1000 and the seat's stand-in drafts until
    /// the member comes back.
    public func close() async {
        await socket?.close()
    }
}
