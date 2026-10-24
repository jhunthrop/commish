import Foundation

/// The signed-in account's reads and its sign-out: the leagues it follows, and revoking this phone.
public protocol AccountAPI: Sendable {
    /// The followed leagues' ids, newest first.
    func attachedLeagueIDs() async throws -> [String]
    func revokeDevice(id: String) async throws
}

extension APIClient: AccountAPI {
    public func attachedLeagueIDs() async throws -> [String] {
        switch try await Self.unwrapped({ try await client.listAttached() }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data).map(\.id)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func revokeDevice(id: String) async throws {
        switch try await Self.unwrapped({ try await client.revokeDevice(path: .init(id: id)) }) {
        case .ok:
            return
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
