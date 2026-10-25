import CommishAPI
import Foundation

/// How a socket ended: its close code and reason, and the upgrade's HTTP status when the room refused
/// it before any frame (401, 403, 404, 429; nil once the socket had opened).
public struct RoomClosed: Error, Equatable, Sendable {
    public let code: Int
    public let reason: String
    public let status: Int?

    public init(code: Int, reason: String = "", status: Int? = nil) {
        self.code = code
        self.reason = reason
        self.status = status
    }
}

/// One open socket on the room: text frames in and out, and a close. `receive` throws `RoomClosed`
/// when the socket ends, however it ended.
public protocol RoomConnection: Sendable {
    func send(_ text: String) async throws
    func receive() async throws -> String
    func close(code: Int, reason: String) async
}

/// Opens a socket on the room's `socket_url` (never one the client builds), signed in by the token.
public protocol RoomConnector: Sendable {
    func open(_ url: URL, token: String?) async throws -> any RoomConnection
}

/// The phone's socket: `URLSessionWebSocketTask` over a request carrying the device token as
/// `Authorization: Bearer` (never in the query string), on a session that keeps the front end's
/// affinity cookie for the reconnects. The platform answers the room's pings by itself.
public struct URLSessionRoomConnector: RoomConnector {
    private let session: URLSession

    public init(session: URLSession = URLSession(configuration: .default)) {
        self.session = session
    }

    public func open(_ url: URL, token: String?) async throws -> any RoomConnection {
        var request = URLRequest(url: url)
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let task = session.webSocketTask(with: request)
        task.resume()
        return URLSessionRoomConnection(task: task)
    }
}

struct URLSessionRoomConnection: RoomConnection {
    let task: URLSessionWebSocketTask

    func send(_ text: String) async throws {
        do {
            try await task.send(.string(text))
        } catch {
            throw closed()
        }
    }

    func receive() async throws -> String {
        do {
            switch try await task.receive() {
            case let .string(text): return text
            case let .data(data): return String(bytes: data, encoding: .utf8) ?? ""
            @unknown default: return ""
            }
        } catch {
            throw closed()
        }
    }

    func close(code: Int, reason: String) async {
        task.cancel(
            with: URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure,
            reason: Data(reason.utf8)
        )
    }

    /// The socket's end as the task saw it: the room's close code and reason, or the upgrade's status
    /// when it never switched protocols; 1006 (gone without a close) when there is neither.
    private func closed() -> RoomClosed {
        let status = (task.response as? HTTPURLResponse)?.statusCode
        let code = task.closeCode == .invalid ? RoomSocket.abnormal : task.closeCode.rawValue
        let reason = task.closeReason.flatMap { String(bytes: $0, encoding: .utf8) } ?? ""
        return RoomClosed(code: code, reason: reason, status: status == 101 ? nil : status)
    }
}
