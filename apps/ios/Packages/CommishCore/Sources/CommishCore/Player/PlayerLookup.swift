import CommishAPI
import Foundation

/// When the reads behind a screen were made: the oldest read's stamp, and why any was a saved one.
public struct Freshness: Equatable, Sendable {
    public let stamp: Date
    public let saved: SavedReason?

    static func of(_ reads: [(stamp: Date, saved: SavedReason?)]) -> Freshness? {
        guard let oldest = reads.map(\.stamp).min() else {
            return nil
        }
        let saved = reads.contains { $0.saved == .offline } ? SavedReason.offline : reads.compactMap(\.saved).first
        return Freshness(stamp: oldest, saved: saved)
    }
}

/// A player's page in the run, found as the web's reader finds it (server/run.ts playerRead): the run's
/// index names him by his slug; his own page; for a page the nightly held, an earlier run's copy, or with
/// none his figures from the leading format's board; nil for a player the run gives no page.
struct PlayerLookup: Sendable {
    let files: RunFiles
    let run: any RunAPI
    let pages: any RunPagesAPI

    /// His index entry by his page's slug.
    func entry(slug: String) async throws -> (FileRead<[RunIndexEntry]>, RunIndexEntry?) {
        let index = try await files.read("/run/index") { [pages] tag in try await pages.index(tag: tag) }
        return (index, index.value.first { $0.slug == slug })
    }

    /// His page as the run serves it, and the reads it took.
    func source(
        _ entry: RunIndexEntry, manifest: RunManifest
    ) async throws -> (PageSource?, [(stamp: Date, saved: SavedReason?)]) {
        let id = entry.id
        do {
            let page = try await files
                .read("/run/players/\(id)") { [pages] tag in try await pages.page(id: id, tag: tag) }
            return (.page(page.value), [(page.stamp, page.saved)])
        } catch where RunFiles.refused(error) {
            return try await held(entry, manifest: manifest)
        }
    }

    /// A page the run held: an earlier run's copy, or the leading board's figures alone.
    private func held(
        _ entry: RunIndexEntry, manifest: RunManifest
    ) async throws -> (PageSource?, [(stamp: Date, saved: SavedReason?)]) {
        let id = entry.id
        let held = try await files.read("/run/held") { [pages] tag in try await pages.held(tag: tag) }
        guard let page = held.value?.first(where: { $0.id == id }) else {
            return (nil, [(held.stamp, held.saved)])
        }
        if let copy = page.copy?.value1 {
            let read = try await files.read("/run/held/\(id)") { [pages] tag in try await pages.heldCopy(
                id: id,
                tag: tag
            ) }
            return (.copy(read.value, from: copy), [(held.stamp, held.saved), (read.stamp, read.saved)])
        }
        guard let format = manifest.formats.first?.id else {
            return (nil, [(held.stamp, held.saved)])
        }
        let board = try await files.read("/run/boards/\(format)") { [run] tag in try await run.board(
            format: format,
            tag: tag
        ) }
        let reads = [(held.stamp, held.saved), (board.stamp, board.saved)]
        return (board.value.rows.first { $0.id == id }.map { .facts(entry, $0) }, reads)
    }

    func manifest() async throws -> FileRead<RunManifest> {
        try await files.read("/run/manifest") { [run] tag in try await run.manifest(tag: tag) }
    }

    func designations() async throws -> FileRead<RunDesignations?> {
        try await files.read("/run/designations") { [run] tag in try await run.designations(tag: tag) }
    }
}

/// His week as his card reads it (live.ts readWeek): the member's league's read with a league, the
/// public read without one or when the league's cannot answer for him; a refused token signs out.
struct WeekReader: Sendable {
    let weeks: any PlayerWeekAPI
    let cache: any AnswerCache
    let clock: any Clock

    /// His week and whether it was read in the league.
    func read(player: String, league: FollowedLeague?) async throws -> (AnswerRead<PlayerWeek>, Bool) {
        if let league {
            do {
                let route = "/leagues/attached/\(league.id)/players/\(player)"
                let week = try await AnswerRead.read(route, cache: cache, clock: clock) { [weeks] in
                    try await weeks.leagueWeek(league: league.id, player: player)
                }
                return (week, true)
            } catch where !APIError.signsOut(error) {
                // The public read stands in, as the web's card does.
            }
        }
        let week = try await AnswerRead.read("/players/\(player)/week", cache: cache, clock: clock) { [weeks] in
            try await weeks.publicWeek(player: player)
        }
        return (week, false)
    }
}
