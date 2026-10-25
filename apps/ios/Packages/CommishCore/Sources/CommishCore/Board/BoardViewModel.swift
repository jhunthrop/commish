import CommishAPI
import Foundation
import Observation

/// The Board screen's view model (the League home's pattern): the API, the cache and the clock
/// injected; each format's saved board at once, dated, then the API's (the board is read in the
/// stadium, with no signal); the chips' choice held here, so the sheet opened from a row and closed
/// again, or a pull that reads the board again, leaves them as they were. The view decides nothing.
@MainActor
@Observable
public final class BoardViewModel {
    public enum State: Equatable, Sendable {
        case loading
        /// The board, when its answer was read, and whether that read is older than this open (the
        /// saved one, shown at once or because the latest read failed).
        case loaded(BoardModel, stamp: Date, stale: Bool)
        case failed(String)
    }

    public private(set) var state: State = .loading
    public private(set) var filter: BoardFilter

    private let api: any BoardAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let inSeason: Bool
    private let following: Bool
    private let onSignedOut: @MainActor () -> Void
    /// The answer shown and its read, so a chip redraws it without a read.
    private var shown: Shown?

    private struct Shown {
        let format: BoardFormat
        let board: RoomBoard
        let stamp: Date
        let stale: Bool
    }

    /// `inSeason` is the bar's season (the Rest of season item); `following` whether the member follows
    /// a league; `onSignedOut` runs when the API refuses the device token.
    public init(
        api: any BoardAPI, cache: any AnswerCache, clock: any Clock, inSeason: Bool, following: Bool,
        filter: BoardFilter = BoardFilter(), zone: TimeZone = .current,
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.api = api
        self.cache = cache
        self.clock = clock
        self.inSeason = inSeason
        self.following = following
        self.filter = filter
        self.zone = zone
        self.onSignedOut = onSignedOut
    }

    /// The cache key of a format's board.
    public static func route(_ format: BoardFormat) -> String {
        "/boards/\(format.rawValue)"
    }

    /// "Last read Sat 12:00 pm" while the board shown is a saved one.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return AppWords.lastRead(stamp, zone: zone)
    }

    /// The format's saved board at once when nothing of it is shown, then the API's; a failed read
    /// keeps the board shown, dated; a refused token signs out.
    public func load() async {
        let format = filter.format
        let route = Self.route(format)
        if shown == nil, let saved = await cache.read(RoomBoard.self, route: route), filter.format == format {
            show(saved.value, stamp: saved.stamp, stale: true)
        }
        do {
            let fresh = try await api.board(format: format)
            let stamp = clock.now
            await cache.write(fresh, route: route, stamp: stamp)
            guard filter.format == format else {
                return
            }
            show(fresh, stamp: stamp, stale: false)
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            guard filter.format == format else {
                return
            }
            if let shown, shown.format == format {
                show(shown.board, stamp: shown.stamp, stale: true)
            } else {
                state = .failed(LeagueHomeViewModel.sentence(for: error))
            }
        }
    }

    /// A format chip: that format's board, saved or read, in the same view.
    public func choose(format: BoardFormat) async {
        guard format != filter.format else {
            return
        }
        filter = filter.with(format: format)
        shown = nil
        state = .loading
        await load()
    }

    /// A position chip: the same board in another view, with no read.
    public func choose(position: BoardPosition?) {
        filter = filter.with(position: position)
        if let shown {
            show(shown.board, stamp: shown.stamp, stale: shown.stale)
        }
    }

    private func show(_ board: RoomBoard, stamp: Date, stale: Bool) {
        shown = Shown(format: filter.format, board: board, stamp: stamp, stale: stale)
        state = .loaded(
            BoardModel(
                board: board, filter: filter, inSeason: inSeason, following: following, now: clock.now, zone: zone
            ),
            stamp: stamp, stale: stale
        )
    }
}
