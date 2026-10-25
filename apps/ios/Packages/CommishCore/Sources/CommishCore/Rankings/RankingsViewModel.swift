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
    public static let maxRows = 400
    /// How long a search waits after the last letter before it reads (OrderScreen's SEARCH_PAUSE_MS).
    public static let searchPause: Duration = .milliseconds(250)

    public private(set) var state: State = .loading
    public private(set) var chip: RankingsChip?
    public private(set) var query: String
    public private(set) var limit = RankingsViewModel.pageRows

    private let api: any RankingsAPI
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

    private struct Shown {
        let route: String
        let answer: Answer
        let stamp: Date
        let stale: Bool
    }

    /// `inSeason` names the page "Rankings" and says the week's game beside each player; `query` is the
    /// search the shell opened the screen with.
    public init(
        api: any RankingsAPI, cache: any AnswerCache, clock: any Clock, inSeason: Bool, query: String = "",
        zone: TimeZone = .current, onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.api = api
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
        if let position = chip?.weekPosition {
            return "/order/week?position=\(position.rawValue)"
        }
        return orderQuery.route
    }

    var orderQuery: OrderQuery {
        OrderQuery(position: chip?.orderPosition, search: query, limit: limit)
    }

    /// The chips' and the search's read: its saved answer at once when nothing of it is shown, then the
    /// API's; a failed read keeps what is shown, stale; a refused token signs out.
    public func load() async {
        latest += 1
        let mine = latest
        let route = route
        let chip = chip
        if shown?.route != route, let saved = await cache.read(Answer.self, route: route), mine == latest {
            show(Shown(route: route, answer: saved.value, stamp: saved.stamp, stale: true))
        }
        do {
            let answer: Answer = if let position = chip?.weekPosition {
                try await .week(api.weekOrder(position: position))
            } else {
                try await .order(api.order(orderQuery))
            }
            let stamp = clock.now
            await cache.write(answer, route: route, stamp: stamp)
            guard mine == latest else {
                return
            }
            show(Shown(route: route, answer: answer, stamp: stamp, stale: false))
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            guard mine == latest else {
                return
            }
            if let shown, shown.route == route {
                show(Shown(route: route, answer: shown.answer, stamp: shown.stamp, stale: true))
            } else {
                state = .failed(LeagueHomeViewModel.sentence(for: error))
            }
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
        if let shown, case .week = shown.answer {
            show(shown)
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
                advice: advice, chip: chip, query: query, inSeason: inSeason, zone: zone, now: now
            ))
        case let .week(advice):
            .week(WeekRankingsModel(
                advice: advice, position: advice.position.value1 == .def ? .def : .k, query: query,
                boardScoring: ValueWords.format(advice.projectionScoring.format), zone: zone, now: now
            ))
        }
        state = .loaded(content, stamp: next.stamp, stale: next.stale)
    }
}
