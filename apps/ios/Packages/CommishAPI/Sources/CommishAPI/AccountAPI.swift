import Foundation

/// The site's own season (GET /season's phase), for a member with no league followed.
public typealias SitePhase = Components.Schemas.SiteSeason.PhasePayload.Value1Payload

/// A followed league as the app's shell needs it: which league, what the league switch calls it (its
/// name, its platform, and its draft time for the phase word), and where it is in its season, which
/// sets the phone's five tabs as it sets the web's bar. Kept on the phone, so the switch lists the
/// leagues with no signal.
public struct FollowedLeague: Equatable, Sendable, Codable, Identifiable {
    public let id: String
    public let name: String
    public let host: Components.Schemas.LeagueHost
    public let phase: Components.Schemas.LeaguePhaseKnown?
    public let draftAt: Date?
    public let waiversOpen: Bool

    public init(
        id: String,
        name: String,
        host: Components.Schemas.LeagueHost,
        phase: Components.Schemas.LeaguePhaseKnown?,
        draftAt: Date?,
        waiversOpen: Bool
    ) {
        self.id = id
        self.name = name
        self.host = host
        self.phase = phase
        self.draftAt = draftAt
        self.waiversOpen = waiversOpen
    }
}

/// The signed-in account's reads and its sign-out: the leagues it follows, the site's season, and
/// revoking this phone.
public protocol AccountAPI: Sendable {
    /// The followed leagues, newest first.
    func followedLeagues() async throws -> [FollowedLeague]
    /// The site's season phase; nil for a phase this build does not know or an API with no season
    /// route (the shell reads either as in season).
    func siteSeason() async throws -> SitePhase?
    func revokeDevice(id: String) async throws
}

extension APIClient: AccountAPI {
    public func followedLeagues() async throws -> [FollowedLeague] {
        switch try await Self.unwrapped({ try await client.listAttached() }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data).map {
                FollowedLeague(
                    id: $0.id, name: $0.name, host: $0.host, phase: $0.phase.value1, draftAt: $0.draftAt,
                    waiversOpen: $0.waiversOpen
                )
            }
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func siteSeason() async throws -> SitePhase? {
        switch try await Self.unwrapped({ try await client.getSeason() }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data).phase.value1
        case .undocumented(404, _):
            return nil
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
