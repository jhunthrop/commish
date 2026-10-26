import CommishAPI
import Foundation
import Observation

/// What the Rankings draw: our order, or the kickers' or defenses' week.
public enum RankingsContent: Equatable, Sendable {
    case order(RankingsModel)
    case week(WeekRankingsModel)

    /// The players the sheet may hold, by id, for its parent refresh.
    public var sheetPlayers: [SheetPlayer] {
        switch self {
        case let .order(model): model.rows.compactMap(\.player.sheetPlayer)
        case let .week(model): model.rows.compactMap(\.player.sheetPlayer)
        }
    }
}

/// The Rankings screen's view model (the web's Players page in season, OrderScreen.svelte): the order's
/// routes, the cache and the clock injected; a chip's or a search's saved read at once, dated, then the
/// API's; a failed read keeps what is shown, stale with its stamp. The chips, the search and Show more
/// are held here, so the player sheet opened from a row and closed again finds them as they were. A
/// search on our order is the API's (its matches keep their places in the order); on the kickers' and
/// defenses' week it filters the week's rows on the phone, as the web's does. The view decides nothing.
@MainActor
@Observable
public final class RankingsViewModel {
    public enum State: Equatable, Sendable {
        case loading
        /// What is drawn, when its read was made, and whether it is a saved one.
        case loaded(RankingsContent, stamp: Date, stale: Bool)
        case failed(String)
    }

    /// The rows one read asks for, how many more Show more adds, and the API's limit (OrderScreen's).
    public static let pageRows = 100
    public static let maxRows = OrderQuery.maxLimit
    /// How long a search waits after the last letter before it reads (OrderScreen's SEARCH_PAUSE_MS).
    public static let searchPause: Duration = .milliseconds(250)

    public private(set) var state: State = .loading
    public private(set) var chip: RankingsChip?
    public private(set) var query: String
    public private(set) var limit = RankingsViewModel.pageRows
    /// Letters typed on our order that its next read has not asked for yet.
    public private(set) var searchPending = false
    /// Why the chip or search asked for last could not be read while an earlier answer stays drawn,
    /// said once over the rows; nil once a read lands.
    public private(set) var problem: String?

    private let api: any RankingsAPI
    /// The order's reads, through the share every in-season screen reads it by (Lane 224 review M3).
    private let orders: OrderReader
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let inSeason: Bool
    private let onSignedOut: @MainActor () -> Void
    private var shown: Shown?
    private var latest = 0

    private enum Answer: Codable, Sendable {
        case order(OrderAdvice)
        case week(WeekOrderAdvice)
    }

    /// What is drawn: the read's route, the chip and the letters it was asked for, its answer and when.
    private struct Shown {
        let route: String
        let chip: RankingsChip?
        let query: String
        let answer: Answer
        let stamp: Date
        let stale: Bool

        func stale(_ isStale: Bool) -> Shown {
            Shown(route: route, chip: chip, query: query, answer: answer, stamp: stamp, stale: isStale)
        }
    }

    /// One read as asked: its route (the cache key), the chip and the letters, and the order's query.
    private struct Asked {
        let route: String
        let chip: RankingsChip?
        let query: String
        let order: OrderQuery
    }

    /// `inSeason` names the page "Rankings" and says the week's game beside each player; `query` is the
    /// search the shell opened the screen with; `memo` the order's reads the app's screens share.
    public init(
        api: any RankingsAPI, cache: any AnswerCache, clock: any Clock, inSeason: Bool, query: String = "",
        zone: TimeZone = .current, memo: OrderMemo = OrderMemo(), onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.api = api
        orders = OrderReader(api: api, clock: clock, memo: memo)
        self.cache = cache
        self.clock = clock
        self.inSeason = inSeason
        self.query = query
        self.zone = zone
        self.onSignedOut = onSignedOut
    }

    /// The page's name: "Rankings" in season.
    public var name: String {
        RankingsWords.name(inSeason: inSeason)
    }

    /// The sentence under the name: on our order's chips the week's game beside each player, on the
    /// week's none (its basis line says it).
    public var lead: String? {
        switch state {
        case let .loaded(.order(model), _, _): model.lead
        case .loaded(.week, _, _): RankingsWords.lead(inSeason: inSeason, onWeekChip: true, week: nil)
        case .loading, .failed:
            chip?.weekPosition == nil ? RankingsWords.lead(inSeason: inSeason, onWeekChip: false, week: nil) : nil
        }
    }

    /// "Last read Sat 12:00 pm" while what is shown is a saved read.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return AppWords.lastRead(stamp, zone: zone)
    }

    /// The read the chips and the search name: the week's for K and D/ST, our order's otherwise.
    var route: String {
        asked.route
    }

    var orderQuery: OrderQuery {
        OrderQuery(position: chip?.orderPosition, search: query, limit: limit)
    }

    /// The read the chips and the search name now, captured before any await so its request and its
    /// cache key are the same read whatever is typed or chosen meanwhile.
    private var asked: Asked {
        let order = orderQuery
        let route = chip?.weekPosition.map { "/order/week?position=\($0.rawValue)" } ?? order.route
        return Asked(route: route, chip: chip, query: query, order: order)
    }

    /// The chips' and the search's read: its saved answer at once when nothing of it is shown, then the
    /// API's; a failed read keeps what is shown, stale, with the reason said once over it (the chip put
    /// back to the one it was read for, the letters left as typed); a refused token signs out.
    public func load() async {
        searchPending = false
        latest += 1
        let mine = latest
        let asked = asked
        if shown?.route != asked.route, let saved = await cache.read(Answer.self, route: asked.route),
           mine == latest {
            show(Shown(
                route: asked.route, chip: asked.chip, query: asked.query, answer: saved.value, stamp: saved.stamp,
                stale: true
            ))
        }
        do {
            let answer: Answer = if let position = asked.chip?.weekPosition {
                try await .week(api.weekOrder(position: position))
            } else {
                try await .order(orders.read(asked.order).answer)
            }
            let stamp = clock.now
            await cache.write(answer, route: asked.route, stamp: stamp)
            guard mine == latest else {
                return
            }
            problem = nil
            show(Shown(
                route: asked.route, chip: asked.chip, query: asked.query, answer: answer, stamp: stamp, stale: false
            ))
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            guard mine == latest else {
                return
            }
            guard let shown else {
                state = .failed(LeagueHomeViewModel.sentence(for: error))
                return
            }
            if shown.route != asked.route {
                problem = LeagueHomeViewModel.sentence(for: error)
                chip = shown.chip
            }
            show(shown.stale(true))
        }
    }

    /// A chip: All, one of our order's positions, or the week's kickers or defenses.
    public func choose(chip next: RankingsChip?) async {
        guard next != chip else {
            return
        }
        chip = next
        limit = Self.pageRows
        await load()
    }

    /// The search's letters: on the week's rows a filter at once; on our order the view reads again once
    /// the letters rest (searchPause), through `load`.
    public func find(_ letters: String) {
        query = letters
        limit = Self.pageRows
        searchPending = searchReads
        if let shown, case .week = shown.answer {
            show(Shown(
                route: shown.route, chip: shown.chip, query: letters, answer: shown.answer, stamp: shown.stamp,
                stale: shown.stale
            ))
        }
    }

    /// Whether a search's letters wait for the order's read (the week filters what it holds).
    public var searchReads: Bool {
        chip?.weekPosition == nil
    }

    /// Show more: a hundred rows more, up to the API's limit.
    public func showMore() async {
        limit = min(Self.maxRows, limit + Self.pageRows)
        await load()
    }

    /// Whether Show more is offered: the API holds more rows and the limit allows them.
    public var more: Bool {
        guard case let .loaded(.order(model), _, _) = state else {
            return false
        }
        return model.more && limit < Self.maxRows
    }

    private func show(_ next: Shown) {
        shown = next
        let now = clock.now
        let content: RankingsContent = switch next.answer {
        case let .order(advice):
            .order(RankingsModel(
                advice: advice, chip: next.chip, query: next.query, inSeason: inSeason, zone: zone, now: now
            ))
        case let .week(advice):
            .week(WeekRankingsModel(
                advice: advice, position: advice.position.value1 == .def ? .def : .k, query: next.query,
                boardScoring: ValueWords.format(advice.projectionScoring.format), zone: zone, now: now
            ))
        }
        state = .loaded(content, stamp: next.stamp, stale: next.stale)
    }
}
