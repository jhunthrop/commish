import Foundation
import OpenAPIRuntime

public typealias PlayerWeek = Components.Schemas.PlayerWeek
public typealias PlayerVerb = Components.Schemas.PlayerVerb
public typealias RunPlayer = Components.Schemas.RunPlayer
public typealias RunPlayerAnswer = Components.Schemas.RunPlayerAnswer
public typealias RunPlayerFormat = Components.Schemas.RunPlayerFormat
public typealias RunWeekRead = Components.Schemas.RunWeekRead
public typealias RunReadsDue = Components.Schemas.RunReadsDue
public typealias RunCapsule = Components.Schemas.RunCapsule
public typealias RunPullFigure = Components.Schemas.RunPullFigure
public typealias RunIndexEntry = Components.Schemas.RunIndexEntry
public typealias RunHeldPage = Components.Schemas.RunHeldPage
public typealias RunHeldCopy = Components.Schemas.RunHeldCopy
public typealias RunSchedule = Components.Schemas.RunSchedule

/// A player's week as his card reads it (web/src/lib/player/live.ts readWeek): the Lineup row's figures
/// in the league's scoring with the one verb its screens give him, or with no league in PPR. The seam
/// the view models' tests replace with a stub.
public protocol PlayerWeekAPI: Sendable {
    /// GET /leagues/attached/{id}/players/{player}: his week in the member's league, the verb with it.
    func leagueWeek(league: String, player: String) async throws -> PlayerWeek
    /// GET /players/{player}/week: his week with no league, in PPR, no verb.
    func publicWeek(player: String) async throws -> PlayerWeek
}

/// The run's player pages as the API serves them (Lane 188's routes, the files the site's player page
/// is built from): the index that names each page by its slug, a player's page, the pages the nightly
/// held and an earlier run's copy of one, and the schedule. Each read names the ETag the app kept, and
/// a 304 says the kept copy stands. The seam the view models' tests replace with a stub.
public protocol RunPagesAPI: Sendable {
    /// Every page the run has, each by his id and slug.
    func index(tag: String?) async throws -> RunRead<[RunIndexEntry]>
    /// His page with the run it is from; a held page, a kicker or a defense is refused (not_found), as
    /// the API holds a refused document back.
    func page(id: String, tag: String?) async throws -> RunRead<RunPlayerAnswer>
    /// The pages the nightly held this run, nil when it held none.
    func held(tag: String?) async throws -> RunRead<[RunHeldPage]?>
    /// An earlier run's copy of a held page, the same shape as a page.
    func heldCopy(id: String, tag: String?) async throws -> RunRead<RunPlayer>
    /// The run's schedule: every club's games with their kickoffs.
    func schedule(tag: String?) async throws -> RunRead<RunSchedule>
}

extension APIClient: PlayerWeekAPI {
    public func leagueWeek(league: String, player: String) async throws -> PlayerWeek {
        let input = Operations.LeaguePlayerWeek.Input(path: .init(id: league, player: player))
        switch try await Self.unwrapped({ try await client.leaguePlayerWeek(input) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .conflict(answer):
            throw try Self.problem(answer.body.json)
        case let .unprocessableContent(answer):
            throw try Self.problem(answer.body.json)
        case let .tooManyRequests(answer):
            throw try Self.problem(answer.body.json)
        case let .badGateway(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func publicWeek(player: String) async throws -> PlayerWeek {
        let input = Operations.PlayerWeek.Input(path: .init(player: player))
        switch try await Self.unwrapped({ try await client.playerWeek(input) }) {
        case let .ok(answer):
            return try Self.payload(answer.body.json.value2.data)
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .tooManyRequests(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}

extension APIClient: RunPagesAPI {
    public func index(tag: String?) async throws -> RunRead<[RunIndexEntry]> {
        let input = Operations.RunIndex.Input(headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runIndex(input) }) {
        case let .ok(answer):
            return try .fresh(Self.payload(answer.body.json.value2.data).pages, tag: answer.headers.eTag)
        case let .notModified(answer):
            return .unchanged(tag: answer.headers.eTag ?? tag)
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func page(id: String, tag: String?) async throws -> RunRead<RunPlayerAnswer> {
        let input = Operations.RunPlayer.Input(path: .init(id: id), headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runPlayer(input) }) {
        case let .ok(answer):
            return try .fresh(Self.payload(answer.body.json.value2.data), tag: answer.headers.eTag)
        case let .notModified(answer):
            return .unchanged(tag: answer.headers.eTag ?? tag)
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func held(tag: String?) async throws -> RunRead<[RunHeldPage]?> {
        let input = Operations.RunHeld.Input(headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runHeld(input) }) {
        case let .ok(answer):
            let data = try Self.payload(answer.body.json.value2.data)
            return .fresh(data.held?.value1.pages, tag: answer.headers.eTag)
        case let .notModified(answer):
            return .unchanged(tag: answer.headers.eTag ?? tag)
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func heldCopy(id: String, tag: String?) async throws -> RunRead<RunPlayer> {
        let input = Operations.RunHeldCopy.Input(path: .init(id: id), headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runHeldCopy(input) }) {
        case let .ok(answer):
            return try .fresh(Self.payload(answer.body.json.value2.data).player, tag: answer.headers.eTag)
        case let .notModified(answer):
            return .unchanged(tag: answer.headers.eTag ?? tag)
        case let .badRequest(answer):
            throw try Self.problem(answer.body.json)
        case let .notFound(answer):
            throw try Self.problem(answer.body.json)
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func schedule(tag: String?) async throws -> RunRead<RunSchedule> {
        let input = Operations.RunSchedule.Input(headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runSchedule(input) }) {
        case let .ok(answer):
            return try .fresh(Self.payload(answer.body.json.value2.data).schedule, tag: answer.headers.eTag)
        case let .notModified(answer):
            return .unchanged(tag: answer.headers.eTag ?? tag)
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
