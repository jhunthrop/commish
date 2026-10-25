import CommishAPI
import Foundation
import Observation

/// The room's WebSocket (docs/superpowers/specs/2026-10-24-room-protocol.md, web/src/lib/room/
/// lobby-socket.ts): a hello with the last seq applied, the welcome with every row since and the
/// server's clock, each update after it in seq order, commands sent only while open, and a reconnect
/// on the retry ladder that picks up exactly where it left off. A 1008 close stops for good with the
/// room's sentence (a "signed out" one signs the app out); a refusal before the upgrade (401, 403,
/// 404) stops for good; anything else retries. The connector, the token, the clock and the waits are
/// injected, so a recorded exchange drives it in a test.
@MainActor
@Observable
public final class RoomSocket {
    public enum Status: Equatable, Sendable {
        case connecting, open, reconnecting, closed
    }

    /// RETRY_MS: the waits before each retry, staying at the last.
    public nonisolated static let retryLadder: [Duration] = [
        .milliseconds(250),
        .milliseconds(500),
        .seconds(1),
        .seconds(2),
        .seconds(5),
    ]
    /// The close the room ends a socket with when it refuses it on purpose.
    public nonisolated static let policyViolation = 1008
    /// The client's own close on leaving the room.
    public nonisolated static let normal = 1000
    /// A socket gone without a close frame.
    public nonisolated static let abnormal = 1006
    /// The 1008 reason for a revoked device token.
    public nonisolated static let signedOutReason = "signed out"
    /// The upgrade statuses no retry gets past (lobby api.ts isFinalRefusal).
    public nonisolated static let finalStatuses: Set<Int> = [401, 403, 404]
    nonisolated static let leftReason = "left the page"

    public private(set) var status: Status = .connecting
    /// The server's clock less the phone's, from the latest welcome: a deadline is drawn at
    /// `clock.now + offset`.
    public private(set) var offset: TimeInterval = 0
    /// The last command the room refused, in its words.
    public private(set) var refusal: String?
    /// Why the retries stopped for good: the room's sentence before a 1008 close.
    public private(set) var stopped: String?
    /// The upgrade's status when the room refused the socket for good before it opened (401, 403, 404).
    public private(set) var refusedStatus: Int?
    /// The highest seq applied.
    public private(set) var lastSeq: Int64 = 0

    private let url: URL
    private let connector: any RoomConnector
    private let tokens: any TokenSource
    private let clock: any Clock
    private let timer: any PollTimer
    private let onRows: @MainActor ([RoomRow]) -> Void
    private let onSignedOut: @MainActor () -> Void
    private var connection: (any RoomConnection)?
    private var attempt = 0
    private var tries = 0
    private var leaving = false
    private var running: Task<Void, Never>?

    public init(
        url: URL, connector: any RoomConnector, tokens: any TokenSource, clock: any Clock,
        timer: any PollTimer = SystemPollTimer(), lastSeq: Int64 = 0,
        onRows: @escaping @MainActor ([RoomRow]) -> Void, onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.url = url
        self.connector = connector
        self.tokens = tokens
        self.clock = clock
        self.timer = timer
        self.lastSeq = lastSeq
        self.onRows = onRows
        self.onSignedOut = onSignedOut
    }

    /// Opens the socket and keeps it open until `close` or a final refusal.
    public func start() {
        guard running == nil else {
            return
        }
        running = Task { await self.run() }
    }

    /// Runs the socket to its end: connect, read until it drops, wait a step, again.
    public func run() async {
        while !leaving {
            status = tries == 0 ? .connecting : .reconnecting
            tries += 1
            let ended = await session()
            connection = nil
            if leaving || stop(ended) {
                break
            }
            status = .reconnecting
            let wait = Self.retryLadder[min(attempt, Self.retryLadder.count - 1)]
            attempt += 1
            do {
                try await timer.sleep(for: wait)
            } catch {
                break
            }
        }
        status = .closed
    }

    /// Sends a command while the socket is open; false, and nothing queued, when it is not.
    @discardableResult
    public func send(_ command: RoomCommand) async -> Bool {
        guard status == .open, let connection else {
            return false
        }
        refusal = nil
        do {
            try await connection.send(command.text)
            return true
        } catch {
            return false
        }
    }

    /// Leaves the room: closes with 1000 and stops retrying.
    public func close() async {
        leaving = true
        await connection?.close(code: Self.normal, reason: Self.leftReason)
        running?.cancel()
        status = .closed
    }

    /// One socket from open to its end, with whether it reached its welcome.
    private func session() async -> (closed: RoomClosed, welcomed: Bool) {
        var welcomed = false
        do {
            let opened = try await connector.open(url, token: tokens.token())
            connection = opened
            try await opened.send(RoomCommand.hello(lastSeq: lastSeq))
            while true {
                let frame = try await RoomFrame.decode(opened.receive())
                if case .welcome = frame {
                    welcomed = true
                }
                receive(frame)
            }
        } catch let closed as RoomClosed {
            return (closed, welcomed)
        } catch {
            await connection?.close(code: Self.abnormal, reason: "")
            return (RoomClosed(code: Self.abnormal), welcomed)
        }
    }

    /// Whether this end is final: a 1008 close, or a final refusal before the welcome.
    private func stop(_ ended: (closed: RoomClosed, welcomed: Bool)) -> Bool {
        let closed = ended.closed
        if closed.code == Self.policyViolation {
            stopped = refusal ?? closed.reason
            if closed.reason == Self.signedOutReason {
                onSignedOut()
            }
            return true
        }
        guard !ended.welcomed, let status = closed.status, Self.finalStatuses.contains(status) else {
            return false
        }
        refusedStatus = status
        if status == 401 {
            onSignedOut()
        }
        return true
    }

    private func receive(_ frame: RoomFrame) {
        switch frame {
        case let .error(_, message):
            refusal = message
        case let .welcome(_, now, rows):
            attempt = 0
            status = .open
            offset = now.timeIntervalSince(clock.now)
            apply(rows)
        case let .update(_, rows):
            apply(rows)
        }
    }

    /// The rows past the last applied, in seq order; one already applied is never applied twice.
    private func apply(_ rows: [RoomRow]) {
        let fresh = rows.filter { $0.seq > lastSeq }.sorted { $0.seq < $1.seq }
        guard let last = fresh.last else {
            return
        }
        lastSeq = last.seq
        onRows(fresh)
    }
}
