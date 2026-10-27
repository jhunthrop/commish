import CommishAPI
import Foundation
import Observation

/// What the Board's chips have chosen: the run's format and the view. Held by the screen's view model,
/// so a sheet opened over the board and closed again finds the same chips pressed.
public struct BoardFilter: Equatable, Hashable, Sendable {
    /// The format as the run's manifest names it ("ppr-12"); nil for the run's default, its first.
    public let format: String?
    /// nil is the All view.
    public let position: BoardPosition?

    public init(format: String? = nil, position: BoardPosition? = nil) {
        self.format = format
        self.position = position
    }

    public func with(format: String?) -> BoardFilter {
        BoardFilter(format: format, position: position)
    }

    public func with(position: BoardPosition?) -> BoardFilter {
        BoardFilter(format: format, position: position)
    }
}

/// Why a board shown is a saved one: no connection, or the latest read failed another way.
public enum BoardStale: Equatable, Sendable {
    case offline
    case failed
}

/// The Board screen's view model (the League home's pattern): the run's routes, the cache and the
/// clock injected; each format's saved read at once, dated, then the run read again naming the ETags
/// kept, so an unchanged run costs four 304s and only refreshes the read's stamp. A failed read keeps
/// the saved board, stale with its reason. The chips' choice is held here, so the sheet opened from a
/// row and closed again, or a pull that reads the board again, leaves them as they were. In season,
/// once the run's board is shown, the order the Rankings read is read at the screen's clock (Lane 224,
/// `orders`) and the board drawn again on it; with no answer the run's rows stand. The view decides
/// nothing.
@MainActor
@Observable
public final class BoardViewModel {
    public enum State: Equatable, Sendable {
        case loading
        /// The board, when its read was made, and why it is a saved one, nil for this open's read.
        case loaded(BoardModel, stamp: Date, stale: BoardStale?)
        case failed(String)
    }

    public private(set) var state: State = .loading
    public private(set) var filter: BoardFilter
    /// The run's formats as last read, for the format chips over a board that could not be read.
    public private(set) var formats: [RunFormat] = []

    private let api: any RunAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let inSeason: Bool
    private let following: Bool
    private let onSignedOut: @MainActor () -> Void
    /// The in-season screens' shared read of the order; nil reads none.
    private let orders: OrderReader?
    /// The read shown, so a position chip redraws it without a read.
    private var shown: Shown?
    /// The order as last read at the screen's clock, so a chip redraws on it.
    private var order: OrderAtClock?
    /// A chip's read of the order, past the share's window.
    private var reread: Task<Void, Never>?

    private struct Shown {
        let format: String?
        let read: RunBoardRead
        let stamp: Date
        let stale: BoardStale?
    }

    /// `inSeason` is the bar's season (the Rest of season item); `following` whether the member follows
    /// a league; `orders` the order's read in season; `onSignedOut` runs when the API refuses the device
    /// token.
    public init(
        api: any RunAPI, cache: any AnswerCache, clock: any Clock, inSeason: Bool, following: Bool,
        filter: BoardFilter = BoardFilter(), zone: TimeZone = .current, orders: OrderReader? = nil,
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.orders = orders
        self.api = api
        self.cache = cache
        self.clock = clock
        self.inSeason = inSeason
        self.following = following
        self.filter = filter
        self.zone = zone
        self.onSignedOut = onSignedOut
    }

    /// The cache key of a format's read, the run's default under its own.
    public static func route(_ format: String?) -> String {
        format.map { "/run/boards/\($0)" } ?? "/run/boards"
    }

    /// Said over a saved board: "You're offline, so this is the last board this device saved, updated
    /// Oct 21." with no connection, "Last read Sat 12:00 pm" when the read failed another way.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, stale?) = state, let read = shown?.read else {
            return nil
        }
        switch stale {
        case .offline: return RunWords.offline(read.manifest.value)
        case .failed: return AppWords.lastRead(stamp, zone: zone)
        }
    }

    /// The format's saved read at once when nothing of it is shown, then the run's routes, each naming
    /// its kept ETag; a failed read keeps the board shown, stale with its reason; a refused token signs
    /// out.
    public func load() async {
        let format = filter.format
        let route = Self.route(format)
        let saved = await cache.read(RunBoardRead.self, route: route)
        if shown == nil, let saved, filter.format == format {
            show(saved.value, stamp: saved.stamp, stale: .failed)
        }
        do {
            let fresh = try await RunBoardReader.read(api, format: format, kept: shown?.read ?? saved?.value)
            let stamp = clock.now
            await cache.write(fresh, route: route, stamp: stamp)
            guard filter.format == format else {
                return
            }
            // A fresh run is drawn on its own clock; the order is read for it below (review H2).
            order = nil
            show(fresh, stamp: stamp, stale: nil)
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            guard filter.format == format else {
                return
            }
            if let shown, shown.format == format {
                show(shown.read, stamp: shown.stamp, stale: error is URLError ? .offline : .failed)
            } else {
                state = .failed(LeagueHomeViewModel.sentence(for: error))
            }
        }
        await readOrder(format: format)
    }

    /// In season the order at the screen's clock, the board drawn again on it; a read that fails drops
    /// any order held, so the run's rows stand with the run's stamp (review H2), and one that lands after
    /// another format was chosen is not drawn (the screen is never held for it: the run's board is drawn
    /// first).
    private func readOrder(format: String?) async {
        guard inSeason, let orders, shown != nil else {
            return
        }
        let read = try? await orders.read()
        guard filter.format == format, let shown else {
            return
        }
        order = read
        show(shown.read, stamp: shown.stamp, stale: shown.stale)
    }

    /// A format chip: that format's board, saved or read, in the same view.
    public func choose(format: String) async {
        guard format != (filter.format ?? formats.first?.id) else {
            return
        }
        filter = filter.with(format: format)
        shown = nil
        state = .loading
        await load()
    }

    /// A position chip: the same board in another view, with no read of the run. The order held redraws
    /// it only inside the share's window by the screen's clock (Lane 243, B251); one older is dropped,
    /// the run's view drawn, and the order read again through the share, so a board left open never
    /// draws an order of any age. The re-read's task, nil where none is made.
    @discardableResult
    public func choose(position: BoardPosition?) -> Task<Void, Never>? {
        filter = filter.with(position: position)
        let stale = order.map { clock.now.timeIntervalSince($0.landed) >= OrderReader.window } == true
        if stale {
            order = nil
        }
        if let shown {
            show(shown.read, stamp: shown.stamp, stale: shown.stale)
        }
        guard stale else {
            return nil
        }
        reread?.cancel()
        let format = filter.format
        let task = Task { await self.readOrder(format: format) }
        reread = task
        return task
    }

    private func show(_ read: RunBoardRead, stamp: Date, stale: BoardStale?) {
        shown = Shown(format: filter.format, read: read, stamp: stamp, stale: stale)
        formats = read.manifest.value.formats
        state = .loaded(
            BoardModel(
                read: read, position: filter.position, inSeason: inSeason, following: following, now: clock.now,
                zone: zone, order: order
            ),
            stamp: stamp, stale: stale
        )
    }
}
