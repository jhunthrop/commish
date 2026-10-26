import Foundation

/// The site's own season (the season GET /me carries, the same object GET /season answers), which sets
/// the bar for a member with no league followed.
public typealias SitePhase = Components.Schemas.SiteSeason.PhasePayload.Value1Payload

/// A followed league as the app's shell needs it: which league, what the league switch calls it (its
/// name, its platform and scoring for the line under it, its draft time for the phase word), and where
/// it is in its season, which sets the phone's five tabs as it sets the web's bar. Kept on the phone,
/// so the switch lists the leagues with no signal.
public struct FollowedLeague: Equatable, Sendable, Codable, Identifiable {
    public let id: String
    public let name: String
    public let host: Components.Schemas.LeagueHost
    /// The preset the league scores as; nil for one this build does not know.
    public let scoring: Components.Schemas.ScoringPresetKnown?
    /// The board the league reads on; nil for one this build does not know.
    public let format: Components.Schemas.BoardFormatKnown?
    public let phase: Components.Schemas.LeaguePhaseKnown?
    public let draftAt: Date?
    public let waiversOpen: Bool
    /// The member's team at the league's last read (ContextLeague.team_name), the Trades' own side;
    /// nil on a league saved before the app kept it.
    public let teamName: String?
    /// Where the member's team stands (ContextLeague.standing), the builder's line beside its name; nil
    /// before a read, or on a league saved before the app kept it.
    public let standing: Components.Schemas.LeagueStanding?
    /// The saved league a mock reruns from (ContextLeague.settings_league_id); nil when a mock room cannot
    /// draft this league, or on a league saved before the app kept it.
    public let settingsLeagueID: String?

    public init(
        id: String,
        name: String,
        host: Components.Schemas.LeagueHost,
        scoring: Components.Schemas.ScoringPresetKnown?,
        format: Components.Schemas.BoardFormatKnown?,
        phase: Components.Schemas.LeaguePhaseKnown?,
        draftAt: Date?,
        waiversOpen: Bool,
        teamName: String? = nil,
        standing: Components.Schemas.LeagueStanding? = nil,
        settingsLeagueID: String? = nil
    ) {
        self.id = id
        self.name = name
        self.host = host
        self.scoring = scoring
        self.format = format
        self.phase = phase
        self.draftAt = draftAt
        self.waiversOpen = waiversOpen
        self.teamName = teamName
        self.standing = standing
        self.settingsLeagueID = settingsLeagueID
    }
}

/// The account as the shell reads it from GET /me: every followed league newest first (the web's
/// switcher list), the site's selected league (Account.league, chosen on the web or in the app), and
/// the site's season.
public struct AccountContext: Equatable, Sendable, Codable {
    public let leagues: [FollowedLeague]
    /// The selected league's id; nil with none followed or a format chosen alone.
    public let selected: String?
    /// The site's season phase; nil for a phase this build does not know.
    public let season: SitePhase?
    /// The context's format (Account.format): the selected league's, else the one chosen with no league;
    /// nil with neither, or one this build does not know.
    public let format: Components.Schemas.BoardFormatKnown?
    /// The account's features (Account.features): custom_scoring drafts a saved league's own rules.
    public let features: [String]?

    public init(
        leagues: [FollowedLeague], selected: String?, season: SitePhase?,
        format: Components.Schemas.BoardFormatKnown? = nil, features: [String]? = nil
    ) {
        self.leagues = leagues
        self.selected = selected
        self.season = season
        self.format = format
        self.features = features
    }
}

/// The signed-in account's reads and writes: the account's context, the league it selects, and
/// revoking this phone.
public protocol AccountAPI: Sendable {
    func account() async throws -> AccountContext
    /// Selects a followed league as the site's context (PUT /me/league), so the web opens on it too.
    /// A league the API no longer lists, or an API without the route, is no change; a refused token
    /// throws.
    func selectLeague(id: String) async throws
    func revokeDevice(id: String) async throws
}

extension APIClient: AccountAPI {
    public func account() async throws -> AccountContext {
        switch try await Self.unwrapped({ try await client.getMe() }) {
        case let .ok(answer):
            return try Self.context(Self.payload(answer.body.json.value2.data))
        case let .unauthorized(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func selectLeague(id: String) async throws {
        let choice = Components.Schemas.LeagueChoice(leagueId: id)
        switch try await Self.unwrapped({ try await client.selectLeague(body: .json(choice)) }) {
        case .ok, .notFound, .badRequest:
            return
        case .undocumented(401, _):
            throw APIError.status(401)
        case .undocumented:
            return
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

    static func context(_ account: Components.Schemas.Account) -> AccountContext {
        AccountContext(
            leagues: account.leagues.map(followed),
            selected: account.league?.value1.id,
            season: account.season.phase.value1,
            format: account.format?.value1.value1,
            features: account.features.compactMap { $0.value1?.rawValue ?? $0.value2 }
        )
    }

    static func followed(_ league: Components.Schemas.ContextLeague) -> FollowedLeague {
        FollowedLeague(
            id: league.id, name: league.name, host: league.host, scoring: league.scoring.value1.value1,
            format: league.format.value1.value1, phase: league.phase.value1, draftAt: league.draftAt,
            waiversOpen: league.waiversOpen, teamName: league.teamName,
            standing: league.standing?.value1, settingsLeagueID: league.settingsLeagueId
        )
    }
}
