import CommishAPI
import Foundation

/// When a run file was read and why it is a saved one, if it is.
typealias ReadMark = (stamp: Date, saved: SavedReason?)

extension FileRead {
    var mark: ReadMark {
        (stamp, saved)
    }
}

/// A screen built from the run's files: the screen's model, the manifest it is of (its stamp and the
/// offline words), and every read it took.
public struct BuiltScreen<Model: Sendable>: Sendable {
    let model: Model
    let manifest: RunManifest
    let reads: [ReadMark]
}

/// The run's files the reference screens read (ADP, compare, the clubs, a club, the schedule), each
/// kept on the phone with the ETag the API gave it under its own key (RunFiles), so the screens, the
/// sheet and the player page share one copy of each whoever reads it first.
struct RunReads: Sendable {
    let files: RunFiles
    let run: any RunAPI
    let pages: any RunPagesAPI

    init(run: any RunAPI, pages: any RunPagesAPI, cache: any AnswerCache, clock: any Clock) {
        files = RunFiles(cache: cache, clock: clock)
        self.run = run
        self.pages = pages
    }

    var lookup: PlayerLookup {
        PlayerLookup(files: files, run: run, pages: pages)
    }

    func manifest() async throws -> FileRead<RunManifest> {
        try await lookup.manifest()
    }

    /// A format's board as the manifest names it ("ppr-12"); a board of another run than the manifest
    /// (the pointer moved between the reads) is read again afresh, once.
    func board(_ format: String, manifest: RunManifest) async throws -> FileRead<RunBoardAnswer> {
        let route = "/run/boards/\(format)"
        let run = run
        let read = try await files.read(route) { tag in try await run.board(format: format, tag: tag) }
        guard read.saved == nil, read.value.runId != manifest.runId else {
            return read
        }
        let again = try await files.read(route) { _ in try await run.board(format: format, tag: nil) }
        guard again.value.runId == manifest.runId else {
            throw RunReadError.runTurned
        }
        return again
    }

    func sources() async throws -> FileRead<[RunAdpSource]> {
        let run = run
        return try await files.read("/run/adp") { tag in try await run.adpSources(tag: tag) }
    }

    /// The capture beside the run; nil where it cannot be read, so the screen stands without statuses.
    func designations() async -> FileRead<RunDesignations?>? {
        try? await lookup.designations()
    }

    func clubs() async throws -> FileRead<[RunClub]> {
        let run = run
        return try await files.read("/run/clubs") { tag in try await run.clubs(tag: tag) }
    }

    func schedule() async throws -> FileRead<RunSchedule> {
        let pages = pages
        return try await files.read("/run/schedule") { tag in try await pages.schedule(tag: tag) }
    }

    func index() async throws -> FileRead<[RunIndexEntry]> {
        let pages = pages
        return try await files.read("/run/index") { tag in try await pages.index(tag: tag) }
    }

    /// The run's complete week (server/run.ts seasonReach's complete): the season block's through week
    /// on the run's first own page, which every page of the run shares; nil where no page answers.
    func complete(_ index: [RunIndexEntry], manifest: RunManifest) async throws -> (Int?, [ReadMark]) {
        for entry in index.prefix(Self.completeTries) {
            let (source, reads) = try await lookup.source(entry, manifest: manifest)
            if case let .page(player)? = source {
                return (player.season.through, reads)
            }
        }
        return (nil, [])
    }

    /// How many index entries are tried for an own page (a held page has another run's season).
    static let completeTries = 8
}
