import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The player page's view model (web/src/routes/(run)/players/[slug]): pushed from the sheet's Full page
/// and from the site's link /players/<slug>. It finds his page in the run by his slug, as the site's
/// page does; reads the run's manifest, ADP sources, capture, clubs and schedule and the leading board
/// (its size, and a held page's figures), each naming the ETag kept; and his week, the league's with
/// one followed, for the verb and the read's projection. A held page shows its copy with that run's
/// stamp, or the board's figures and the held words; never the document the API holds back. With no
/// answer the saved reads stand with their stamp. The view decides nothing.
@MainActor
@Observable
public final class PlayerPageViewModel {
    public enum State: Equatable, Sendable {
        case loading
        case loaded(PlayerPageModel, Freshness)
        case failed(String)
    }

    public let slug: String
    public private(set) var state: State = .loading

    private let lookup: PlayerLookup
    private let files: RunFiles
    private let run: any RunAPI
    private let pages: any RunPagesAPI
    private let weeks: WeekReader
    private let clock: any Clock
    private let league: FollowedLeague?
    private let zone: TimeZone
    private let onSignedOut: @MainActor () -> Void

    public init(
        slug: String, run: any RunAPI, pages: any RunPagesAPI, weeks: any PlayerWeekAPI, cache: any AnswerCache,
        clock: any Clock, league: FollowedLeague?, zone: TimeZone = .current,
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.slug = slug
        files = RunFiles(cache: cache, clock: clock)
        lookup = PlayerLookup(files: files, run: run, pages: pages)
        self.run = run
        self.pages = pages
        self.weeks = WeekReader(weeks: weeks, cache: cache, clock: clock)
        self.clock = clock
        self.league = league
        self.zone = zone
        self.onSignedOut = onSignedOut
    }

    /// "Last read Sun 3:05 pm" over a page drawn from saved reads; nil for this open's.
    public var stampWords: String? {
        guard case let .loaded(_, freshness) = state, freshness.saved != nil else {
            return nil
        }
        return AppWords.lastRead(freshness.stamp, zone: zone)
    }

    public func load() async {
        do {
            let (index, entry) = try await lookup.entry(slug: slug)
            guard let entry else {
                state = .failed(Words.InSeason.notFoundLine)
                return
            }
            let manifest = try await lookup.manifest()
            async let source = lookup.source(entry, manifest: manifest.value)
            async let reads = runReads(format: manifest.value.formats.first?.id)
            async let week = try? weeks.read(player: entry.id, league: league)
            let (found, sourceReads) = try await source
            let files = try await reads
            let answer = await week
            guard let found, let model = PlayerPages.page(PageInput(
                source: found, manifest: manifest.value, sources: files.sources.value,
                capture: files.capture.flatMap(\.value),
                clubs: files.clubs.value, schedule: files.schedule.value,
                boardSize: files.board.map { $0.value.rows.count + $0.value.market.count },
                week: answer?.0.value, host: answer?.1 == true ? league?.host : nil, zone: zone, now: clock.now
            )) else {
                state = .failed(Words.InSeason.notFoundLine)
                return
            }
            state = .loaded(model, Freshness.of(
                [(index.stamp, index.saved), (manifest.stamp, manifest.saved)] + sourceReads + files.reads
            ) ?? Freshness(stamp: clock.now, saved: nil))
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            state = .failed(LeagueHomeViewModel.sentence(for: error))
        }
    }

    /// The run's files beside his page: the ADP's sources, the capture, the clubs, the schedule and the
    /// leading board (its size), the capture and the board standing without where they cannot be read.
    struct Reads: Sendable {
        let sources: FileRead<[RunAdpSource]>
        let capture: FileRead<RunDesignations?>?
        let clubs: FileRead<[RunClub]>
        let schedule: FileRead<RunSchedule>
        let board: FileRead<RunBoardAnswer>?

        var reads: [(stamp: Date, saved: SavedReason?)] {
            [(sources.stamp, sources.saved), (clubs.stamp, clubs.saved), (schedule.stamp, schedule.saved)]
                + [capture.map { ($0.stamp, $0.saved) }, board.map { ($0.stamp, $0.saved) }].compactMap(\.self)
        }
    }

    private func runReads(format: String?) async throws -> Reads {
        let files = files
        let run = run
        let pages = pages
        async let sources = files.read("/run/adp") { tag in try await run.adpSources(tag: tag) }
        async let capture = try? lookup.designations()
        async let clubs = files.read("/run/clubs") { tag in try await run.clubs(tag: tag) }
        async let schedule = files.read("/run/schedule") { tag in try await pages.schedule(tag: tag) }
        async let board = boardRead(format: format)
        return try await Reads(sources: sources, capture: capture, clubs: clubs, schedule: schedule, board: board)
    }

    /// The leading format's board, nil where the run names none or it cannot be read.
    private func boardRead(format: String?) async -> FileRead<RunBoardAnswer>? {
        guard let format else {
            return nil
        }
        let run = run
        return try? await files.read("/run/boards/\(format)") { tag in try await run.board(format: format, tag: tag) }
    }
}
