import CommishAPI
import CommishDesign
import Foundation
import Observation

/// What the pin above the bar shows: the one verb and whether it can be pressed, the line under it,
/// or the move's confirmation in the verb's place (one verb on screen).
public struct StartPin: Equatable, Sendable {
    public let verb: String?
    public let enabled: Bool
    public let foot: [[FootRun]]
    public let panel: MovePanel?

    /// Nothing to pin: no verb, no line, no confirmation.
    public var isEmpty: Bool {
        verb == nil && foot.isEmpty && panel == nil
    }
}

/// The Start screen's view model (the League home's pattern): the API, the cache and the clock
/// injected; the saved lineup at once, then the API's; the verb that copies the lineup or plans and
/// makes the move on the platform; the evidence lines a member opens. The view decides nothing.
@MainActor
@Observable
public final class StartViewModel {
    public enum State: Equatable, Sendable {
        case loading
        /// The lineup, when its answer was read, and whether that read is older than this open (the
        /// saved one, shown at once or because the latest read failed).
        case loaded(StartModel, stamp: Date, stale: Bool)
        case failed(String)
    }

    public private(set) var state: State = .loading
    public private(set) var step: MoveStep = .closed
    /// The line under the verb once the lineup is copied.
    public private(set) var copied: [[FootRun]]?
    /// The rows whose evidence line is open, by player id.
    public private(set) var opened: Set<String> = []

    private let api: any LineupAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let host: Components.Schemas.LeagueHost
    /// The platform's words: the league's own, or the store graphics' neutral one (Lane 310).
    private let words: HostWords
    private let copy: @MainActor (String) -> Bool
    private let onSignedOut: @MainActor () -> Void
    /// The answer shown, so a press reads it again at the clock it is pressed at.
    private var answer: LineupAdvice?
    /// The move as planned: the one the token makes, whatever the screen reads meanwhile.
    private var planned: HostMoveInput?

    /// `copy` puts the lineup on the clipboard and says whether it took; `onSignedOut` runs when the
    /// API refuses the device token.
    public init(
        api: any LineupAPI, cache: any AnswerCache, clock: any Clock, host: Components.Schemas.LeagueHost,
        zone: TimeZone = .current, copy: @escaping @MainActor (String) -> Bool,
        onSignedOut: @escaping @MainActor () -> Void = {}, words: HostWords? = nil
    ) {
        self.api = api
        self.cache = cache
        self.clock = clock
        self.host = host
        self.words = words ?? .of(host)
        self.zone = zone
        self.copy = copy
        self.onSignedOut = onSignedOut
    }

    /// The cache key of a league's lineup.
    public static func route(_ leagueID: String) -> String {
        "/leagues/attached/\(leagueID)/lineup"
    }

    public var platform: String {
        words.name
    }

    /// "Last read Sat 12:00 pm" while the lineup shown is a saved one.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return AppWords.lastRead(stamp, zone: zone)
    }

    /// The pin: the confirmation while it is open; else the verb, disabled with the stamp's reason
    /// while the lineup shown is a saved one (a move made from it would not be the platform's lineup).
    public var pin: StartPin {
        if let panel = MovePanel(step: step, platform: platform) {
            return StartPin(verb: nil, enabled: false, foot: [], panel: panel)
        }
        guard case let .loaded(model, _, stale) = state else {
            return StartPin(verb: nil, enabled: false, foot: [], panel: nil)
        }
        if stale, model.verb != nil, let stamp = stampWords {
            let reason = [[FootRun(text: AppWords.Start.stale(stamp), url: nil)]]
            return StartPin(verb: model.verb?.title, enabled: false, foot: reason, panel: nil)
        }
        return StartPin(verb: model.verb?.title, enabled: model.verb != nil, foot: copied ?? model.foot, panel: nil)
    }

    /// The saved lineup at once on the first open, then the API's; a failed read keeps the lineup
    /// shown, dated; a refused token signs out.
    public func load(leagueID: String) async {
        let route = Self.route(leagueID)
        if state == .loading, let saved = await cache.read(LineupAdvice.self, route: route) {
            show(saved.value, stamp: saved.stamp, stale: true)
        }
        do {
            let fresh = try await api.lineup(id: leagueID)
            let stamp = clock.now
            await cache.write(fresh, route: route, stamp: stamp)
            show(fresh, stamp: stamp, stale: false)
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

    /// The verb: the lineup read again at the clock it is pressed at (a game that kicked off since the
    /// read takes its change back, and with nothing left to change nothing is sent), then the move
    /// planned on the platform, or the lineup copied. Nothing while the lineup shown is a saved one.
    public func press(leagueID: String) async {
        guard case let .loaded(_, stamp, false) = state, let answer, step == .closed else {
            return
        }
        let model = StartModel(advice: answer, host: host, now: clock.now, zone: zone, words: words)
        state = .loaded(model, stamp: stamp, stale: false)
        switch model.verb {
        case .make?:
            planned = model.move
            step = .planning
            do {
                step = try await .planned(api.planMove(id: leagueID, move: model.move))
            } catch where APIError.signsOut(error) {
                step = .closed
                onSignedOut()
            } catch {
                step = .failed(error, stage: .plan, platform: platform, page: model.page)
            }
        case .copy?:
            copied = model.copied(copy(model.copyText))
        case nil:
            return
        }
    }

    /// Makes the planned move once with its token, then reads the lineup again.
    public func confirm(leagueID: String) async {
        guard case let .confirm(sentence, token) = step, let move = planned else {
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
            let page: URL? = if case let .loaded(model, _, _) = state {
                model.page
            } else {
                nil
            }
            step = .failed(error, stage: .make, platform: platform, page: page)
        }
    }

    /// Closes the confirmation (Not now, Done); never while the move is on its way.
    public func close() {
        if case .sending = step {
            return
        }
        step = .closed
        planned = nil
    }

    /// Opens or closes a swap's evidence line.
    public func toggleWhy(_ id: String) {
        if opened.contains(id) {
            opened.remove(id)
        } else {
            opened.insert(id)
        }
    }

    private func show(_ advice: LineupAdvice, stamp: Date, stale: Bool) {
        answer = advice
        state = .loaded(
            StartModel(advice: advice, host: host, now: clock.now, zone: zone, words: words), stamp: stamp, stale: stale
        )
    }
}
