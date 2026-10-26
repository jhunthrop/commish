import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The room's socket through the protocol's whole exchange (shared/fixtures/room-socket/exchange.json,
/// the protocol's section 10): the hello, the welcome and the clock offset, a command and its update, a
/// refusal, a drop mid-draft and the reconnect that replays the log from the last seq; then each way
/// the room stops a client for good, the retry ladder, and a command while closed.
@MainActor
struct RoomSocketTests {
    static let exchange = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("../../../../shared/fixtures/room-socket/exchange.json").standardized

    struct Exchange: Decodable {
        let socketURL: String
        let phoneNow: String
        let connections: [[Step]]

        enum CodingKeys: String, CodingKey {
            case socketURL = "socket_url"
            case phoneNow = "phone_now"
            case connections
        }
    }

    struct Step: Decodable {
        let client: RoomValue?
        let server: RoomValue?
        let close: Close?
        let end: Bool?

        struct Close: Decodable {
            let code: Int
            let reason: String
            let status: Int?
        }
    }

    static func load() throws -> Exchange {
        try JSONDecoder().decode(Exchange.self, from: Data(contentsOf: exchange))
    }

    @Test func theWholeExchangeLosesNoRowAndAppliesNoneTwice() async throws {
        let script = try Self.load()
        let phone = try #require(RoomClockReading.parse(script.phoneNow))
        let timer = RecordingTimer()
        var applied: [Int64] = []
        let connector = ScriptedConnector(script.connections.map { $0.map(ScriptedStep.init) })
        let socket = try RoomSocket(
            url: #require(URL(string: script.socketURL)), connector: connector, tokens: FixedTokens(),
            clock: FixedClock(phone), timer: timer, onRows: { rows in applied += rows.map(\.seq) }
        )
        await connector.drive { command in
            if command == .leave {
                await socket.close()
            } else {
                #expect(await socket.send(command))
            }
        }
        await socket.run()

        #expect(applied == [1, 2, 3, 4, 5, 6])
        #expect(socket.lastSeq == 6)
        #expect(await timer.waits == [.milliseconds(250)])
        // The refusal was the first socket's; the second welcome cleared it.
        #expect(socket.refusal == nil)
        // The second welcome's clock: 01:02:09 less the phone's 01:02:02.
        #expect(socket.offset == 7)
        #expect(socket.status == .closed)
        #expect(socket.stopped == nil)
        let sent = await connector.sent
        #expect(sent == script.connections.map { $0.compactMap(\.client) })
        #expect(sent.map(\.first) == [
            .object(["type": .string("hello"), "last_seq": .number(0)]),
            .object(["type": .string("hello"), "last_seq": .number(4)]),
        ])
        #expect(await connector.tokens == ["fixture-token", "fixture-token"])
        #expect(await connector.closes == [RoomClosed(code: RoomSocket.normal, reason: "left the page")])
    }

    @Test func aRevokedTokenClosesWith1008AndSignsOut() async {
        var signedOut = false
        let connector = ScriptedConnector([[
            .server(#"{"type":"welcome","room_id":"r","seq":0,"now":"2026-08-20T01:02:03Z","actions":[]}"#),
            .server(#"{"type":"error","code":"unauthorized","message":"Sign in to do that"}"#),
            .close(RoomClosed(code: 1008, reason: "signed out")),
        ]])
        let socket = Self.socket(connector, timer: RecordingTimer(), signedOut: { signedOut = true })
        await socket.run()
        #expect(signedOut)
        #expect(socket.status == .closed)
        #expect(socket.stopped == "Sign in to do that")
    }

    static let tooManyTabs = "This seat already has three tabs open on the room. Close one and reload."

    @Test func aSeatOverItsBudgetStopsWithTheRoomsSentence() async {
        var signedOut = false
        let connector = ScriptedConnector([[
            .server(
                #"{"type":"error","code":"rate_limited","message":"\#(Self.tooManyTabs)"}"#
            ),
            .close(RoomClosed(code: 1008, reason: "seat over its socket budget")),
        ]])
        let timer = RecordingTimer()
        let socket = Self.socket(connector, timer: timer, signedOut: { signedOut = true })
        await socket.run()
        #expect(!signedOut)
        #expect(socket.stopped == Self.tooManyTabs)
        #expect(await timer.waits.isEmpty)
    }

    @Test func aRefusalBeforeTheUpgradeIsFinalOnlyFor401403And404() async {
        let refused = { (status: Int) in [ScriptedStep.close(RoomClosed(code: 1006, status: status))] }
        let connector = ScriptedConnector([
            refused(503),
            refused(429),
            refused(500),
            refused(502),
            refused(500),
            refused(500),
            refused(403),
        ])
        let timer = RecordingTimer()
        let socket = Self.socket(connector, timer: timer)
        await socket.run()
        #expect(socket.refusedStatus == 403)
        #expect(socket.status == .closed)
        #expect(await timer.waits == RoomSocket.retryLadder + [.seconds(5)])
        #expect(await connector.sent.allSatisfy { $0 == [.object(["type": .string("hello"), "last_seq": .number(0)])] })
    }

    @Test func a401BeforeTheUpgradeSignsOut() async {
        var signedOut = false
        let connector = ScriptedConnector([[.close(RoomClosed(code: 1006, status: 401))]])
        let socket = Self.socket(connector, timer: RecordingTimer(), signedOut: { signedOut = true })
        await socket.run()
        #expect(signedOut)
        #expect(socket.refusedStatus == 401)
    }

    @Test func aWelcomeResetsTheLadder() async {
        let welcome = ScriptedStep
            .server(#"{"type":"welcome","room_id":"r","seq":0,"now":"2026-08-20T01:02:03Z","actions":[]}"#)
        let drop = ScriptedStep.close(RoomClosed(code: 1006))
        let connector = ScriptedConnector([
            [drop],
            [drop],
            [welcome, drop],
            [.close(RoomClosed(code: 1006, status: 404))],
        ])
        let timer = RecordingTimer()
        let socket = Self.socket(connector, timer: timer)
        await socket.run()
        #expect(await timer.waits == [.milliseconds(250), .milliseconds(500), .milliseconds(250)])
    }

    @Test func aRowAlreadyAppliedIsNotAppliedAgain() async {
        var applied: [Int64] = []
        let row = { (seq: Int) in
            #"{"seq":\#(seq),"kind":"SET_QUEUE","seat":3,"payload":{},"at":"2026-08-20T01:00:22Z"}"#
        }
        let connector = ScriptedConnector([[
            .server(
                #"{"type":"welcome","room_id":"r","seq":2,"now":"2026-08-20T01:02:03Z","#
                    + #""actions":[\#(row(1)),\#(row(2))]}"#
            ),
            .server(#"{"type":"update","seq":3,"actions":[\#(row(2)),\#(row(3))]}"#),
            .close(RoomClosed(code: 1006, status: 404)),
        ]])
        let socket = RoomSocket(
            url: Self.url, connector: connector, tokens: FixedTokens(), clock: FixedClock(Self.phoneNow),
            timer: RecordingTimer(), onRows: { rows in applied += rows.map(\.seq) }
        )
        await socket.run()
        #expect(applied == [1, 2, 3])
    }

    @Test func aCommandWhileTheSocketIsNotOpenIsNotQueued() async {
        let socket = Self.socket(ScriptedConnector([]), timer: RecordingTimer())
        #expect(socket.status == .connecting)
        #expect(await !socket.send(.pick(playerID: "9509", pick: 1)))
    }

    @Test func commandsAreTheProtocolsFrames() {
        #expect(RoomCommand.pick(playerID: "9509", pick: 3).text == #"{"pick":3,"player_id":"9509","type":"pick"}"#)
        #expect(RoomCommand.queue(["9509", "8150"]).text == #"{"player_ids":["9509","8150"],"type":"queue"}"#)
        #expect(RoomCommand.leave.text == #"{"type":"leave"}"#)
        #expect(Self.hello(4) == #"{"last_seq":4,"type":"hello"}"#)
    }

    static let url = URL(string: "wss://room.example/rooms/r/ws")!
    /// The exchange's phone clock, so no test reads the real one.
    static let phoneNow = RoomClockReading.parse("2026-08-20T01:02:02.000Z")!

    static func hello(_ seq: Int64) -> String {
        RoomCommand.hello(lastSeq: seq)
    }

    static func socket(
        _ connector: ScriptedConnector, timer: RecordingTimer, signedOut: @escaping @MainActor () -> Void = {}
    ) -> RoomSocket {
        RoomSocket(
            url: url, connector: connector, tokens: FixedTokens(), clock: FixedClock(phoneNow), timer: timer,
            onRows: { _ in }, onSignedOut: signedOut
        )
    }
}

struct FixedTokens: TokenSource {
    func token() async -> String? {
        "fixture-token"
    }
}

actor RecordingTimer: PollTimer {
    private(set) var waits: [Duration] = []

    func sleep(for interval: Duration) async throws {
        waits.append(interval)
    }
}

/// One step of a scripted socket: a frame the client must send, one the room sends, the socket's end,
/// or the client leaving.
enum ScriptedStep: Sendable {
    case client(String)
    case server(String)
    case close(RoomClosed)
    case end

    init(_ step: RoomSocketTests.Step) {
        if let client = step.client {
            self = .client(RoomCommand.json(Self.fields(client)))
        } else if let server = step.server {
            self = .server(RoomCommand.json(Self.fields(server)))
        } else if let close = step.close {
            self = .close(RoomClosed(code: close.code, reason: close.reason, status: close.status))
        } else {
            self = .end
        }
    }

    static func fields(_ value: RoomValue) -> [String: RoomValue] {
        guard case let .object(fields) = value else {
            return [:]
        }
        return fields
    }

    /// The command a client step names, for the test to send through the socket.
    var command: RoomCommand? {
        guard case let .client(text) = self else {
            return nil
        }
        let value = try? JSONDecoder().decode(RoomValue.self, from: Data(text.utf8))
        guard case let .string(type) = value?["type"], let value else {
            return nil
        }
        switch type {
        case "pick":
            guard case let .string(player) = value["player_id"], case let .number(pick) = value["pick"] else {
                return nil
            }
            return .pick(playerID: player, pick: Int(pick))
        case "queue":
            guard case let .array(ids) = value["player_ids"] else {
                return nil
            }
            return .queue(ids.compactMap {
                if case let .string(id) = $0 {
                    id
                } else {
                    nil
                }
            })
        case "leave":
            return .leave
        default:
            return nil
        }
    }
}

/// A connector over scripted sockets, one per open, in order; it records what the client sent on each
/// (as parsed JSON) and asks the test to send each scripted command but the hello.
actor ScriptedConnector: RoomConnector {
    private var scripts: [[ScriptedStep]]
    private var driver: (@MainActor @Sendable (RoomCommand) async -> Void)?
    private(set) var sent: [[RoomValue]] = []
    private(set) var tokens: [String?] = []
    private(set) var closes: [RoomClosed] = []

    init(_ scripts: [[ScriptedStep]]) {
        self.scripts = scripts
    }

    func drive(_ driver: @escaping @MainActor @Sendable (RoomCommand) async -> Void) {
        self.driver = driver
    }

    nonisolated func open(_: URL, token: String?) async throws -> any RoomConnection {
        try await next(token)
    }

    private func next(_ token: String?) throws -> any RoomConnection {
        tokens.append(token)
        guard !scripts.isEmpty else {
            throw RoomClosed(code: 1006, status: 404)
        }
        sent.append([])
        return ScriptedConnection(index: sent.count - 1, steps: scripts.removeFirst(), connector: self)
    }

    func record(_ text: String, on index: Int) {
        if let value = try? JSONDecoder().decode(RoomValue.self, from: Data(text.utf8)) {
            sent[index].append(value)
        }
    }

    func closed(_ close: RoomClosed) {
        closes.append(close)
    }

    func command(_ command: RoomCommand) async {
        if let driver {
            await driver(command)
        }
    }
}

actor ScriptedConnection: RoomConnection {
    let index: Int
    private var steps: [ScriptedStep]
    private let connector: ScriptedConnector
    private var left: RoomClosed?

    init(index: Int, steps: [ScriptedStep], connector: ScriptedConnector) {
        self.index = index
        self.steps = steps
        self.connector = connector
    }

    func send(_ text: String) async throws {
        if let left {
            throw left
        }
        await connector.record(text, on: index)
    }

    func receive() async throws -> String {
        while !steps.isEmpty {
            if let left {
                throw left
            }
            let step = steps.removeFirst()
            switch step {
            case let .server(text):
                return text
            case let .close(close):
                throw close
            case .client:
                // The hello is the socket's own; any other command the test sends through the socket.
                if let command = step.command {
                    await connector.command(command)
                }
            case .end:
                await connector.command(.leave)
            }
        }
        throw left ?? RoomClosed(code: 1006)
    }

    func close(code: Int, reason: String) async {
        let close = RoomClosed(code: code, reason: reason)
        left = close
        await connector.closed(close)
    }
}
