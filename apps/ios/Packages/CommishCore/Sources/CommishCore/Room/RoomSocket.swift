import CommishAPI
import Foundation
import Observation
import os

/// The room's WebSocket (docs/superpowers/specs/2026-10-24-room-protocol.md, web/src/lib/room/
/// lobby-socket.ts): a hello with the last seq applied, the welcome with every row since and the
/// server's clock, each update after it in seq order, commands sent only while open, and a reconnect
/// on the retry ladder that picks up exactly where it left off. A 1008 close stops for good with the
/// room's sentence (a "signed out" one signs the app out); a refusal before the upgrade (401, 403,
/// 404) stops for good; anything else retries. The connector, the token, the clock and the waits are
/// injected, so a recorded exchange drives it in a test.
///
/// `run()` is the one way in, from the owner's structured task (`.task { await socket.run() }`): when
/// that task is cancelled, the open socket is closed with 1000 at once and no retry follows, so the
/// socket never outlives the screen that opened it. `close()` leaves the room the same way.
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
    /// A socket gone without a close frame (reserved: seen, never sent).
    public nonisolated static let abnormal = 1006
    /// The client's close for a frame it cannot read at all.
    public nonisolated static let protocolError = 1002
    /// The 1008 reason for a revoked device token.
    public nonisolated static let signedOutReason = "signed out"
    /// The upgrade statuses no retry gets past (lobby api.ts isFinalRefusal).
    public nonisolated static let finalStatuses: Set<Int> = [401, 403, 404]
    nonisolated static let leftReason = "left the page"
    nonisolated static let unreadableReason = "unreadable frame"
    /// The client's close when rows went missing and it resyncs from the welcome.
    nonisolated static let resyncReason = "resync"
    nonisolated static let log = Logger(subsystem: "app.trycommish.ios", category: "room-socket")

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
    private let onGap: (@MainActor () async -> Bool)?
    private var connection: (any RoomConnection)?
    /// A frame skipped past the last seq applied: the socket was closed to resync from the welcome.
    private var gapped = false
    /// The open socket where a cancellation, which runs off the main actor, can close it.
    private let live = LiveConnection()
    private var attempt = 0
    private var tries = 0
    private var leaving = false

    public init(
        url: URL, connector: any RoomConnector, tokens: any TokenSource, clock: any Clock,
        timer: any PollTimer = SystemPollTimer(), lastSeq: Int64 = 0,
        onRows: @escaping @MainActor ([RoomRow]) -> Void, onSignedOut: @escaping @MainActor () -> Void = {},
        onGap: (@MainActor () async -> Bool)? = nil
    ) {
        self.onGap = onGap
        self.url = url
        self.connector = connector
        self.tokens = tokens
        self.clock = clock
        self.timer = timer
        self.lastSeq = lastSeq
        self.onRows = onRows
        self.onSignedOut = onSignedOut
    }

    /// Runs the socket to its end: connect, read until it drops, wait a step, again; until `close`, a
    /// final refusal, or the calling task's cancellation.
    public func run() async {
        await withTaskCancellationHandler {
            await loop()
        } onCancel: { [live] in
            live.cancel()
        }
        connection = nil
        status = .closed
    }

    private func loop() async {
        while !ended {
            status = tries == 0 ? .connecting : .reconnecting
            tries += 1
            let session = await session()
            connection = nil
            live.clear()
            if ended || stop(session) {
                break
            }
            status = .reconnecting
            if gapped {
                // B219: rows went missing, so the owner reads the room again and the log replays whole
                // from the welcome on the next socket, at once; a refused read ends it for good.
                gapped = false
                guard await resync() else {
                    break
                }
                continue
            }
            let wait = Self.retryLadder[min(attempt, Self.retryLadder.count - 1)]
            attempt += 1
            do {
                try await timer.sleep(for: wait)
            } catch {
                break
            }
        }
    }

    /// The owner left (`close`) or its task was cancelled.
    private var ended: Bool {
        leaving || Task.isCancelled || live.isShut
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
        connection = nil
        await live.shut()?.close(code: Self.normal, reason: Self.leftReason)
        status = .closed
    }

    /// One socket from open to its end, with whether it reached its welcome. A socket that opens after
    /// the owner left is closed at once, before its hello.
    private func session() async -> (closed: RoomClosed, welcomed: Bool) {
        var welcomed = false
        do {
            let opened = try await connector.open(url, token: tokens.token())
            guard !ended, live.hold(opened) else {
                await opened.close(code: Self.normal, reason: Self.leftReason)
                return (RoomClosed(code: Self.normal, reason: Self.leftReason), false)
            }
            connection = opened
            try await opened.send(RoomCommand.hello(lastSeq: lastSeq))
            while true {
                let text = try await opened.receive()
                do {
                    guard let frame = try RoomFrame.decode(text) else {
                        continue
                    }
                    if case .welcome = frame {
                        welcomed = true
                    }
                    if !receive(frame) {
                        gapped = true
                        await opened.close(code: Self.normal, reason: Self.resyncReason)
                        return (RoomClosed(code: Self.normal, reason: Self.resyncReason), welcomed)
                    }
                } catch {
                    // Not JSON the room writes at all: closed as a protocol error and retried.
                    Self.log.error("room socket: unreadable frame, closing")
                    await opened.close(code: Self.protocolError, reason: Self.unreadableReason)
                    return (RoomClosed(code: Self.protocolError, reason: Self.unreadableReason), welcomed)
                }
            }
        } catch let closed as RoomClosed {
            return (closed, welcomed)
        } catch {
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

    /// Applies a frame; false when its rows skip past the last seq applied (a gap), which applies none.
    private func receive(_ frame: RoomFrame) -> Bool {
        switch frame {
        case let .error(_, message):
            refusal = message
            return true
        case let .welcome(_, now, rows):
            attempt = 0
            status = .open
            refusal = nil
            offset = now.timeIntervalSince(clock.now)
            return apply(rows)
        case let .update(_, rows):
            return apply(rows)
        }
    }

    /// The rows past the last applied, in seq order; one already applied is never applied twice. With
    /// an owner that resyncs, rows that skip past the next seq (`rows.first.seq > lastSeq + 1`) are a
    /// gap and apply nothing (B219); without one they apply as the web's client does.
    private func apply(_ rows: [RoomRow]) -> Bool {
        let fresh = rows.filter { $0.seq > lastSeq }.sorted { $0.seq < $1.seq }
        guard let first = fresh.first, let last = fresh.last else {
            return true
        }
        if onGap != nil, first.seq > lastSeq + 1 {
            Self.log.notice("room socket: seq gap after \(self.lastSeq), resyncing")
            return false
        }
        lastSeq = last.seq
        onRows(fresh)
        return true
    }

    /// The owner reads the room again (false when the read is refused for good) and the next socket
    /// says hello from nothing, so its welcome carries the whole log.
    private func resync() async -> Bool {
        guard let onGap, await onGap() else {
            stopped = stopped ?? refusal
            return false
        }
        lastSeq = 0
        return !ended
    }
}

/// The open connection, where the cancellation handler (off the main actor) can reach it: `shut` closes
/// it with 1000 and refuses any later one, so a socket that finishes opening after it is closed too.
final class LiveConnection: Sendable {
    private struct Held {
        var connection: (any RoomConnection)?
        var shut = false
    }

    private let held = OSAllocatedUnfairLock(initialState: Held())

    var isShut: Bool {
        held.withLock(\.shut)
    }

    /// Keeps the connection; false once shut, and the caller closes it.
    func hold(_ connection: any RoomConnection) -> Bool {
        held.withLock { state in
            guard !state.shut else {
                return false
            }
            state.connection = connection
            return true
        }
    }

    func clear() {
        held.withLock { $0.connection = nil }
    }

    /// Refuses every later connection and hands back the held one for the caller to close.
    func shut() -> (any RoomConnection)? {
        held.withLock { state in
            state.shut = true
            defer { state.connection = nil }
            return state.connection
        }
    }

    /// From a cancellation handler, which cannot wait: shut, and the held connection closed with 1000.
    func cancel() {
        guard let connection = shut() else {
            return
        }
        Task { await connection.close(code: RoomSocket.normal, reason: RoomSocket.leftReason) }
    }
}
