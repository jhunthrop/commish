import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The Waivers screen's view model (the Start screen's pattern): the API, the cache and the clock
/// injected; the saved answer at once, then the API's; the card or open row the one verb acts on; the
/// claim planned (and planned again for a typed bid) and made once with its token, or the platform's
/// page with his name copied. The view decides nothing.
@MainActor
@Observable
public final class WaiverViewModel {
    public enum State: Equatable, Sendable {
        case loading
        case loaded(WaiverModel, stamp: Date, stale: Bool)
        case failed(String)
    }

    public private(set) var state: State = .loading
    public private(set) var step: MoveStep = .closed
    /// The card the pinned verb acts on, by key; the first card until another is chosen.
    public private(set) var chosenCard: String?
    /// The row whose drop panel is open, and the drop chosen there.
    public internal(set) var openRow: String?
    public private(set) var chosenDrop: String?
    /// The line under the verb once his name is copied for the platform's page.
    public private(set) var copied: [[FootRun]]?
    /// The bid as typed, the claim's bid terms and whether it is being planned again.
    public private(set) var typed = ""
    public private(set) var bid: HostBid?
    public private(set) var replanning = false
    /// The position chosen (nil: every position), whether its read is on its way, and why it failed.
    public internal(set) var position: WaiverPosition?
    public internal(set) var reading = false
    public internal(set) var problem: String?
    /// The table's sort and search.
    public internal(set) var sort: WaiverSort = .initial
    public internal(set) var query = ""
    /// The toggle: the cards and the list read for the rest of the season or this week.
    public internal(set) var panelMode: PanelMode = .season
    /// The answer the last top-up was for (WaiverScreen.svelte toppedFor): an unchanged answer reads the
    /// chosen position no second time; nil once a top-up failed, so the next answer tries again.
    var toppedFor: String?
    /// The opening card: whether a fresh answer has set it yet, and whether the member has chosen a card since.
    var openedFresh = false
    var userChose = false
    /// The chosen position's own read and its instant, which its rows draw at (WaiverScreen's narrowedAt).
    var narrowed: (advice: WaiverAdvice, at: Date)?
    /// Which position read is the latest: an earlier one's answer is overtaken (state.ts Narrowing).
    var latestNarrowing = 0
    /// The page's answer and the instant it was read, which the strip and the cards are drawn from.
    private var answer: (advice: WaiverAdvice, at: Date)?

    let api: any WaiversAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let host: Components.Schemas.LeagueHost
    private let copy: @MainActor (String) -> Void
    private let openPage: @MainActor (URL) -> Void
    private let onSignedOut: @MainActor () -> Void
    /// The claim as last planned: the one the token makes, whatever is typed meanwhile.
    private var planned: HostMoveInput?
    private var claiming: WaiverRow?

    /// `copy` puts a name on the clipboard (the phone's always takes it); `openPage` opens the platform's page;
    /// `onSignedOut` runs when the API refuses the device token.
    public init(
        api: any WaiversAPI, cache: any AnswerCache, clock: any Clock, host: Components.Schemas.LeagueHost,
        zone: TimeZone, copy: @escaping @MainActor (String) -> Void,
        openPage: @escaping @MainActor (URL) -> Void = { _ in }, onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.api = api
        self.cache = cache
        self.clock = clock
        self.host = host
        self.zone = zone
        self.copy = copy
        self.openPage = openPage
        self.onSignedOut = onSignedOut
    }

    /// The cache key of a league's waivers.
    public static func route(_ leagueID: String) -> String {
        "/leagues/attached/\(leagueID)/waivers"
    }

    public var platform: String {
        ValueWords.platform(host)
    }

    /// "Last read Sat 12:00 pm" while the answer shown is a saved one.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return "\(AppWords.lastRead) \(Formatting.weekdayTime(stamp, zone: zone))"
    }

    // MARK: what the verb acts on

    var model: WaiverModel? {
        if case let .loaded(model, _, _) = state {
            return model
        }
        return nil
    }

    /// The open row, if any.
    public var opened: PoolRow? {
        model?.rows.first { $0.key == openRow }
    }

    /// The open row's drops, the advice's first.
    public var drops: [DropRow] {
        guard let model, let opened else {
            return []
        }
        return model.drops(opened)
    }

    /// The drop chosen in the open panel: the one tapped, else the advice's.
    public var drop: DropRow? {
        drops.first { $0.key == chosenDrop } ?? drops.first
    }

    /// The card the verb acts on with no row open: the one chosen, else the first.
    public var card: PickupCard? {
        model.flatMap { model in model.cards.first { $0.key == chosenCard } ?? model.cards.first }
    }

    /// What the verb acts on: the open row with the drop chosen, else the chosen card's move.
    var target: WaiverRow? {
        if let opened {
            return WaiverRows.with(opened.source, drop: drop)
        }
        return card?.source
    }

    /// The pin: the claim's confirmation while it is open; else the verb for the open pair or the card,
    /// disabled with the stamp's reason while the answer shown is a saved one (a claim made from it may be
    /// for a player already taken).
    public var pin: WaiverPin {
        let kind = MoveKind.claim(zone: zone)
        if let panel = MovePanel(step: step, platform: platform, kind: kind) {
            return WaiverPin(pair: nil, verb: nil, enabled: false, foot: [], panel: panel.waiting(waits), bid: bidField)
        }
        guard case let .loaded(model, _, stale) = state, let target else {
            return WaiverPin(pair: nil, verb: nil, enabled: false, foot: [], panel: nil, bid: nil)
        }
        let pair = opened.map { model.pairWords($0.source, drop: drop) }
        if stale, let stamp = stampWords {
            let reason = [[FootRun(text: AppWords.Waivers.stale(stamp), url: nil)]]
            return WaiverPin(pair: pair, verb: model.verb(target), enabled: false, foot: reason, panel: nil, bid: nil)
        }
        let line = model.line.isEmpty ? [] : [[FootRun(text: model.line, url: nil)]]
        return WaiverPin(
            pair: pair, verb: model.verb(target), enabled: true, foot: copied ?? line, panel: nil, bid: nil
        )
    }

    // MARK: reads

    /// The saved answer at once on the first open, then the API's; a failed read keeps the answer shown,
    /// dated; a refused token signs out.
    public func load(leagueID: String) async {
        let route = Self.route(leagueID)
        if state == .loading, let saved = await cache.read(WaiverAdvice.self, route: route) {
            show(saved.value, stamp: saved.stamp, stale: true)
        }
        do {
            let fresh = try await api.waivers(id: leagueID, position: nil)
            let stamp = clock.now
            await cache.write(fresh, route: route, stamp: stamp)
            show(fresh, stamp: stamp, stale: false)
            await topUp(leagueID: leagueID)
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            if case let .loaded(model, stamp, _) = state {
                state = .loaded(model, stamp: stamp, stale: true)
            } else {
                state = .failed(LeagueHomeViewModel.sentence(for: error))
            }
        }
    }

    // MARK: choices

    /// A card chosen: the pinned verb acts on it.
    public func choose(card key: String) {
        chosenCard = key
        openRow = nil
        copied = nil
    }

    /// A row's button: its drop panel opened or closed; a stash an open IR slot takes with no drop opens
    /// the platform's page with his name.
    public func tap(row key: String) {
        guard let row = model?.rows.first(where: { $0.key == key }) else {
            return
        }
        if row.opensPage {
            // The platform's page is held on a saved read, as the verb is (review L1).
            if case .loaded(_, _, false) = state {
                openPlatform(row.source)
            }
            return
        }
        openRow = openRow == key ? nil : key
        chosenDrop = nil
        copied = nil
    }

    /// A drop chosen in the open panel.
    public func choose(drop key: String) {
        chosenDrop = key
        copied = nil
    }

    // MARK: the verb

    /// The verb: the claim planned where it is made from here, else his name copied and the platform's page
    /// opened. Nothing while the answer shown is a saved one or a claim is open.
    public func press(leagueID: String) async {
        guard let target else {
            return
        }
        await act(on: target, leagueID: leagueID)
    }

    /// The one verb on an add (WaiverScreen.svelte act): the claim planned where it is made from here,
    /// else his name copied and the platform's page opened. Nothing on a saved read or with a claim open.
    func act(on target: WaiverRow, leagueID: String) async {
        guard case let .loaded(model, _, false) = state, step == .closed else {
            return
        }
        if model.claimsHere(target) {
            claiming = target
            typed = ""
            bid = nil
            await plan(leagueID: leagueID, source: target, bid: nil)
        } else {
            openPlatform(target)
        }
    }

    /// A typed bid. It is planned again once it rests (the view's pause), when the league takes it.
    public func type(bid typed: String) {
        self.typed = typed
    }

    /// The typed bid planned again, when it is one the league takes and not the one planned.
    public func replanBid(leagueID: String) async {
        guard case .confirm = step, let bid, let claiming,
              WaiverWords.bidProblem(platform, typed: typed, bid: bid) == nil,
              let value = WaiverWords.bidValue(typed.trimmingCharacters(in: .whitespacesAndNewlines)),
              value != planned?.claim?.value1.bid
        else {
            return
        }
        await plan(leagueID: leagueID, source: claiming, bid: value)
    }

    /// Makes the planned claim once with its token, then reads the waivers again.
    public func confirm(leagueID: String) async {
        guard case let .confirm(sentence, token) = step, let move = planned, !waits else {
            return
        }
        step = .sending(sentence: sentence)
        do {
            step = try await .made(api.makeMove(id: leagueID, move: move, confirm: token))
            await load(leagueID: leagueID)
        } catch where APIError.signsOut(error) {
            step = .closed
            onSignedOut()
        } catch {
            step = .failed(error, stage: .make, platform: platform, page: model?.page, kind: .claim(zone: zone))
        }
    }

    /// Closes the confirmation (Not now, Done); never while the claim is on its way.
    public func close() {
        if case .sending = step {
            return
        }
        step = .closed
        planned = nil
        claiming = nil
        bid = nil
        typed = ""
        replanning = false
    }

    /// Plans the claim with the bid (nil: none typed yet, the plan says the league's least where it bids,
    /// and is planned again as that number so the token makes the bid the member sees). Only the latest
    /// plan is kept.
    private func plan(leagueID: String, source: WaiverRow, bid amount: Int?) async {
        guard let model else {
            return
        }
        let move = model.claim(source, bid: amount)
        planned = move
        if amount == nil {
            step = .planning
        } else {
            replanning = true
        }
        do {
            let answer = try await api.planMove(id: leagueID, move: move)
            guard planned == move else {
                return
            }
            step = .planned(answer)
            bid = answer.bid?.value1
            replanning = false
            if amount == nil, let least = answer.bid?.value1 {
                typed = String(least.amount)
                await plan(leagueID: leagueID, source: source, bid: least.amount)
            }
        } catch where APIError.signsOut(error) {
            step = .closed
            onSignedOut()
        } catch {
            guard planned == move else {
                return
            }
            replanning = false
            step = .failed(error, stage: .plan, platform: platform, page: model.page, kind: .claim(zone: zone))
        }
    }

    /// The platform verb: his name on the clipboard and the platform's waiver page opened, the line under
    /// the verb saying which.
    private func openPlatform(_ source: WaiverRow) {
        guard let model else {
            return
        }
        copy(source.add.player.name)
        if let page = model.page {
            openPage(page)
        }
        let words = WaiverWords.copied(platform, name: model.shortName(source), didCopy: true)
        copied = [[
            FootRun(text: "\(words.said) ", url: nil),
            FootRun(text: words.page, url: model.page),
            FootRun(text: ".", url: nil),
        ]]
    }

    /// An answer on screen; the first one, and the first fresh one after a saved one, set the card the screen
    /// opens on (the weakest Need, else All) until the member chooses a card.
    private func show(_ advice: WaiverAdvice, stamp: Date, stale: Bool) {
        let opens = answer == nil || (!stale && !openedFresh)
        answer = (advice, clock.now)
        openedFresh = openedFresh || !stale
        if opens, !userChose {
            open(on: advice)
        }
        redraw(stamp: stamp, stale: stale)
    }

    /// The model again from the page's answer and the position's own read, keeping the stamp.
    func redraw() {
        if case let .loaded(_, stamp, stale) = state {
            redraw(stamp: stamp, stale: stale)
        }
    }

    private func redraw(stamp: Date, stale: Bool) {
        guard let answer else {
            return
        }
        let model = WaiverModel(
            advice: answer.advice, shown: shownAnswer(answer.advice), host: host, now: narrowed?.at ?? answer.at,
            zone: zone,
            pageNow: answer.at
        )
        state = .loaded(model, stamp: stamp, stale: stale)
    }

    /// The page's answer, for the top-up's mark.
    var pageAdvice: WaiverAdvice? {
        answer?.advice
    }

    /// A refused token: the screen signs out.
    func signedOut() {
        state = .failed(AppWords.Failure.signedOut)
        onSignedOut()
    }

    var now: Date {
        clock.now
    }
}
