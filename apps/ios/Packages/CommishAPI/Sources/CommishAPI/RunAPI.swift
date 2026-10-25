import Foundation
import HTTPTypes
import OpenAPIRuntime

public typealias RunManifest = Components.Schemas.RunManifest
public typealias RunFormat = Components.Schemas.RunFormat
public typealias RunBoardAnswer = Components.Schemas.RunBoardAnswer
public typealias RunBoardRow = Components.Schemas.RunBoardRow
public typealias RunMarketRow = Components.Schemas.RunMarketRow
public typealias RunAdpSource = Components.Schemas.RunAdpSource
public typealias RunDesignations = Components.Schemas.RunDesignations
public typealias RunPlayerStatus = Components.Schemas.RunPlayerStatus
public typealias RunClub = Components.Schemas.RunClub

/// A run route's answer to a read that named the ETag it kept: the file read again with its own ETag,
/// or unchanged (304), the kept copy still the run's.
public enum RunRead<Value: Sendable>: Sendable {
    case fresh(Value, tag: String?)
    case unchanged(tag: String?)
}

/// The published run as the API serves it to the apps (Lanes 185 and 188's /run routes, the files the
/// site is built from): the manifest, a format's board, the ADP's sources, the injury capture and the
/// clubs' byes. Each read
/// sends the ETag the app kept for that file, if any, and a 304 says the kept copy stands. The seam
/// the view model's tests replace with a stub.
public protocol RunAPI: Sendable {
    func manifest(tag: String?) async throws -> RunRead<RunManifest>
    /// `format` as the manifest names it: "ppr-12".
    func board(format: String, tag: String?) async throws -> RunRead<RunBoardAnswer>
    /// The ADP's sources: the drafts behind each format's ADP and their window.
    func adpSources(tag: String?) async throws -> RunRead<[RunAdpSource]>
    /// The newest capture beside the run; nil when the run carries none.
    func designations(tag: String?) async throws -> RunRead<RunDesignations?>
    /// The 32 clubs with their byes (Lane 188's /run/clubs).
    func clubs(tag: String?) async throws -> RunRead<[RunClub]>
}

extension APIClient: RunAPI {
    public func manifest(tag: String?) async throws -> RunRead<RunManifest> {
        let input = Operations.RunManifest.Input(headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runManifest(input) }) {
        case let .ok(answer):
            return try .fresh(Self.payload(answer.body.json.value2.data).manifest, tag: answer.headers.eTag)
        case let .notModified(answer):
            return .unchanged(tag: answer.headers.eTag ?? tag)
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func board(format: String, tag: String?) async throws -> RunRead<RunBoardAnswer> {
        let input = Operations.RunBoard.Input(path: .init(format: format), headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runBoard(input) }) {
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

    public func adpSources(tag: String?) async throws -> RunRead<[RunAdpSource]> {
        let input = Operations.RunAdp.Input(headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runAdp(input) }) {
        case let .ok(answer):
            return try .fresh(Self.payload(answer.body.json.value2.data).adp.sources, tag: answer.headers.eTag)
        case let .notModified(answer):
            return .unchanged(tag: answer.headers.eTag ?? tag)
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func designations(tag: String?) async throws -> RunRead<RunDesignations?> {
        let input = Operations.RunDesignations.Input(headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runDesignations(input) }) {
        case let .ok(answer):
            let data = try Self.payload(answer.body.json.value2.data)
            return .fresh(data.designations?.value1, tag: answer.headers.eTag)
        case let .notModified(answer):
            return .unchanged(tag: answer.headers.eTag ?? tag)
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }

    public func clubs(tag: String?) async throws -> RunRead<[RunClub]> {
        let input = Operations.RunClubs.Input(headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runClubs(input) }) {
        case let .ok(answer):
            return try .fresh(Self.payload(answer.body.json.value2.data).clubs, tag: answer.headers.eTag)
        case let .notModified(answer):
            return .unchanged(tag: answer.headers.eTag ?? tag)
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}
