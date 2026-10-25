import CommishAPI
import Foundation

/// A run file as the app keeps it: its answer and the ETag the API gave it, sent back on the next read.
public struct Kept<Value: Codable & Sendable & Equatable>: Codable, Sendable, Equatable {
    public let value: Value
    public let tag: String?
}

/// Everything the Board draws, as read from the run's routes and kept on the phone: the manifest (the
/// run's stamp and the format), the format's board, the ADP's sources and the injury capture, each with
/// its ETag.
public struct RunBoardRead: Codable, Sendable, Equatable {
    public let manifest: Kept<RunManifest>
    public let board: Kept<RunBoardAnswer>
    public let sources: Kept<[RunAdpSource]>
    public let designations: Kept<RunDesignations?>

    /// The board's format as the manifest carries it: the reader keeps no board whose format it lacks.
    public var format: RunFormat {
        manifest.value.formats.first { $0.id == board.value.format } ?? manifest.value.formats[0]
    }
}

/// What a read of the run cannot be made of.
public enum RunReadError: Error, Equatable {
    /// The manifest names no format.
    case noFormat
    /// A 304 for a file the phone keeps no copy of.
    case unchangedWithoutCopy
    /// The board is another run's than the manifest, again after reading both afresh.
    case runTurned
}

/// The Board's read of the run's routes: the manifest first (its formats and its run), then the
/// format's board, the ADP's sources and the capture together, each naming the ETag kept for it, so an
/// unchanged file costs a 304 and keeps the copy. A board of another run than the manifest (the
/// pointer moved between the reads) is read again afresh, once.
enum RunBoardReader {
    /// `format` as the manifest names it, nil for the run's default (the first it lists).
    static func read(_ api: any RunAPI, format: String?, kept: RunBoardRead?) async throws -> RunBoardRead {
        let read = try await once(api, format: format, kept: kept)
        guard read.board.value.runId != read.manifest.value.runId else {
            return read
        }
        let again = try await once(api, format: format, kept: nil)
        guard again.board.value.runId == again.manifest.value.runId else {
            throw RunReadError.runTurned
        }
        return again
    }

    private static func once(_ api: any RunAPI, format: String?, kept: RunBoardRead?) async throws -> RunBoardRead {
        let manifest = try await resolve(api.manifest(tag: kept?.manifest.tag), kept: kept?.manifest)
        let formats = manifest.value.formats.map(\.id)
        guard let chosen = format.flatMap({ formats.contains($0) ? $0 : nil }) ?? formats.first else {
            throw RunReadError.noFormat
        }
        let keptBoard = kept?.board.value.format == chosen ? kept?.board : nil
        async let board = api.board(format: chosen, tag: keptBoard?.tag)
        async let sources = api.adpSources(tag: kept?.sources.tag)
        async let designations = api.designations(tag: kept?.designations.tag)
        return try await RunBoardRead(
            manifest: manifest,
            board: resolve(board, kept: keptBoard),
            sources: resolve(sources, kept: kept?.sources),
            designations: resolve(designations, kept: kept?.designations)
        )
    }

    /// A fresh answer with its ETag, or the kept copy a 304 says stands.
    static func resolve<Value>(_ read: RunRead<Value>, kept: Kept<Value>?) throws -> Kept<Value> {
        switch read {
        case let .fresh(value, tag):
            return Kept(value: value, tag: tag)
        case let .unchanged(tag):
            guard let kept else {
                throw RunReadError.unchangedWithoutCopy
            }
            return Kept(value: kept.value, tag: tag ?? kept.tag)
        }
    }
}
