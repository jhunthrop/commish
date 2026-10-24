import Foundation

/// A followed league as the app's shell needs it: which league, and where it is in its season, which
/// sets the phone's five tabs as it sets the web's bar.
public struct FollowedLeague: Equatable, Sendable {
    public let id: String
    public let phase: Components.Schemas.LeaguePhaseKnown?
    public let waiversOpen: Bool

    public init(id: String, phase: Components.Schemas.LeaguePhaseKnown?, waiversOpen: Bool) {
        self.id = id
        self.phase = phase
        self.waiversOpen = waiversOpen
    }
}

/// The signed-in account's reads and its sign-out: the leagues it follows, and revoking this phone.
public protocol AccountAPI: Sendable {
    /// The followed leagues, newest first.
    func followedLeagues() async throws -> [FollowedLeague]
    func revokeDevice(id: String) async throws
}

extension APIClient: AccountAPI {
    public func followedLeagues() async throws -> [FollowedLeague] {
        switch try await Self.unwrapped({ try await client.listAttached() }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data).map {
                FollowedLeague(id: $0.id, phase: $0.phase.value1, waiversOpen: $0.waiversOpen)
            }
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
