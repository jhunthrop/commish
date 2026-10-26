@testable import CommishCore
import Foundation
import Testing

/// The socket never outlives its owner: a cancelled `run()` closes the open socket, a `close()` while
/// the socket is still opening leaves no socket and sends no hello, and a cancellation during the
/// ladder's wait opens nothing more. Frames this client does not know are skipped, and text that is
/// no frame at all closes with 1002, never the reserved 1006.
@MainActor
struct RoomSocketLifetimeTests {
    static let welcome = #"{"type":"welcome","room_id":"r","seq":0,"now":"2026-08-20T01:02:03Z","actions":[]}"#

    @Test func aCancelledRunClosesTheOpenSocket() async {
        let connection = HeldConnection(frames: [Self.welcome])
        let connector = HeldConnector([.connection(connection)])
        let socket = Self.socket(connector)
        let running = Task { await socket.run() }
        await connection.received.wait()
        #expect(socket.status == .open)
        running.cancel()
        await running.value
        #expect(await connection.closes == [RoomClosed(code: 1000, reason: "left the page")])
        #expect(await connector.opens == 1)
        #expect(socket.status == .closed)
    }

    @Test func aCloseWhileOpeningLeavesNoSocketAndSendsNoHello() async {
        let connection = HeldConnection(frames: [Self.welcome])
        let connector = HeldConnector([.connection(connection)], holdOpen: true)
        let socket = Self.socket(connector)
        let running = Task { await socket.run() }
        await connector.opening.wait()
        await socket.close()
        await connector.release()
        await running.value
        #expect(await connection.sent.isEmpty)
        #expect(await connection.closes == [RoomClosed(code: 1000, reason: "left the page")])
        #expect(await connector.opens == 1)
        #expect(socket.status == .closed)
    }

    @Test func aCancellationDuringTheLaddersWaitOpensNothingMore() async {
        let connector = HeldConnector([.refused(RoomClosed(code: 1006)), .refused(RoomClosed(code: 1006))])
        let timer = HeldTimer()
        let socket = Self.socket(connector, timer: timer)
        let running = Task { await socket.run() }
        await timer.waiting.wait()
        running.cancel()
        await running.value
        #expect(await connector.opens == 1)
        #expect(socket.status == .closed)
    }

    @Test func aFrameOfAnUnknownTypeIsSkippedAndTheNextUpdateStillApplies() async {
        var applied: [Int64] = []
        let row = { (seq: Int) in
            #"{"seq":\#(seq),"kind":"SET_QUEUE","seat":3,"payload":{},"at":"2026-08-20T01:00:22Z"}"#
        }
        let connection = HeldConnection(frames: [
            Self.welcome,
            #"{"type":"update","seq":1,"actions":[\#(row(1))]}"#,
            #"{"type":"presence","seats":[1,4]}"#,
            #"{"type":"update","seq":2,"actions":[\#(row(2))]}"#,
        ])
        let socket = RoomSocket(
            url: RoomSocketTests.url, connector: HeldConnector([.connection(connection)]), tokens: FixedTokens(),
            clock: FixedClock(RoomSocketTests.phoneNow), timer: RecordingTimer(),
            onRows: { rows in applied += rows.map(\.seq) }
        )
        let running = Task { await socket.run() }
        await connection.received.wait()
        #expect(applied == [1, 2])
        #expect(socket.status == .open)
        running.cancel()
        await running.value
        #expect(await connection.closes == [RoomClosed(code: 1000, reason: "left the page")])
    }

    @Test func textThatIsNoFrameClosesWith1002AndRetries() async {
        let broken = HeldConnection(frames: [Self.welcome, "not json"])
        let connector = HeldConnector([.connection(broken), .refused(RoomClosed(code: 1006, status: 404))])
        let timer = RecordingTimer()
        let socket = Self.socket(connector, timer: timer)
        await socket.run()
        #expect(await broken.closes == [RoomClosed(code: 1002, reason: "unreadable frame")])
        #expect(await timer.waits == [.milliseconds(250)])
        #expect(await connector.opens == 2)
    }

    static func socket(_ connector: HeldConnector, timer: any PollTimer = RecordingTimer()) -> RoomSocket {
        RoomSocket(
            url: RoomSocketTests.url, connector: connector, tokens: FixedTokens(),
            clock: FixedClock(RoomSocketTests.phoneNow), timer: timer, onRows: { _ in }
        )
    }
}

/// A one-shot signal a test waits on.
actor Signal {
    private var fired = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func fire() {
        fired = true
        waiters.forEach { $0.resume() }
        waiters = []
    }

    func wait() async {
        if fired {
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }
}

/// A socket that hands out its frames, then holds the receive open until it is closed, as a live one
/// does; `received` fires once every frame has been read.
actor HeldConnection: RoomConnection {
    private var frames: [String]
    private var parked: CheckedContinuation<Void, Never>?
    private var closed: RoomClosed?
    private(set) var sent: [String] = []
    private(set) var closes: [RoomClosed] = []
    let received = Signal()

    init(frames: [String]) {
        self.frames = frames
    }

    func send(_ text: String) async throws {
        if let closed {
            throw closed
        }
        sent.append(text)
    }

    func receive() async throws -> String {
        if let closed {
            throw closed
        }
        if !frames.isEmpty {
            return frames.removeFirst()
        }
        await received.fire()
        await withCheckedContinuation { parked = $0 }
        throw closed ?? RoomClosed(code: 1006)
    }

    func close(code: Int, reason: String) async {
        let close = RoomClosed(code: code, reason: reason)
        closes.append(close)
        closed = close
        parked?.resume()
        parked = nil
    }
}

/// Opens its scripted sockets in order; with `holdOpen` the first open waits until `release`.
actor HeldConnector: RoomConnector {
    enum Opening {
        case connection(HeldConnection)
        case refused(RoomClosed)
    }

    private var openings: [Opening]
    private var holdOpen: Bool
    private var parked: CheckedContinuation<Void, Never>?
    private(set) var opens = 0
    let opening = Signal()

    init(_ openings: [Opening], holdOpen: Bool = false) {
        self.openings = openings
        self.holdOpen = holdOpen
    }

    func release() {
        holdOpen = false
        parked?.resume()
        parked = nil
    }

    nonisolated func open(_: URL, token _: String?) async throws -> any RoomConnection {
        try await next()
    }

    private func next() async throws -> any RoomConnection {
        opens += 1
        await opening.fire()
        if holdOpen {
            await withCheckedContinuation { parked = $0 }
        }
        guard !openings.isEmpty else {
            throw RoomClosed(code: 1006, status: 404)
        }
        switch openings.removeFirst() {
        case let .connection(connection): return connection
        case let .refused(closed): throw closed
        }
    }
}

/// A ladder wait that lasts until its task is cancelled; `waiting` fires when it starts.
actor HeldTimer: PollTimer {
    let waiting = Signal()

    func sleep(for _: Duration) async throws {
        await waiting.fire()
        try await Task.sleep(for: .seconds(3600))
    }
}
