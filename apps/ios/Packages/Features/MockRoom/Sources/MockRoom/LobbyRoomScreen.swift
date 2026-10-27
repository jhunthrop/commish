import CommishAPI
import CommishCore
import CommishDesign
import Companion
import SwiftUI

/// What the lobby's controls do: the call's verb (draft on your clock, queue him first off it), a pool
/// row's mark, queue and draft, a chip, and the notices' verbs.
public struct LobbyActions {
    let draft: (String?) -> Void
    let queueFirst: (String) -> Void
    let queue: (String) -> Void
    let mark: (String) -> Void
    let filter: (String) -> Void
    let report: () -> Void
    let another: () -> Void

    public init(
        draft: @escaping (String?) -> Void, queueFirst: @escaping (String) -> Void, queue: @escaping (String) -> Void,
        mark: @escaping (String) -> Void, filter: @escaping (String) -> Void, report: @escaping () -> Void,
        another: @escaping () -> Void
    ) {
        self.draft = draft
        self.queueFirst = queueFirst
        self.queue = queue
        self.mark = mark
        self.filter = filter
        self.report = report
        self.another = another
    }

    /// Controls that do nothing: a snapshot's.
    public static var none: LobbyActions {
        LobbyActions(
            draft: { _ in }, queueFirst: { _ in }, queue: { _ in }, mark: { _ in }, filter: { _ in }, report: {},
            another: {}
        )
    }

    /// The mock room's controls for the parts the lobby shares with it: the pool's and the call's.
    var room: MockRoomActions {
        MockRoomActions(
            draft: draft, undo: {}, autopick: {}, finish: {}, share: {}, queue: queue, mark: mark, filter: filter
        )
    }
}

/// The lobby as its model says it, in the web's order at 390 (LobbyRoomView.svelte with the room page's
/// notices): the notices, the score bug, the seats, the filling line, the picks as they land, our call,
/// the pool, the wall, the dock's line and your team. Pure of state, so a snapshot draws it from the
/// fixture.
public struct LobbyRoomScreen: View {
    let model: LobbyRoomModel
    let notices: [String]
    let complete: Bool
    let abandoned: Bool
    let actions: LobbyActions
    var shown = PoolModel.firstRows
    var more: () -> Void = {}
    var live = true
    /// The room's clock from the phone's; nil draws the model's own moment (a snapshot).
    var roomNow: ((Date) -> Date)?

    public init(
        model: LobbyRoomModel, notices: [String], complete: Bool, abandoned: Bool, actions: LobbyActions,
        live: Bool = true
    ) {
        self.model = model
        self.notices = notices
        self.complete = complete
        self.abandoned = abandoned
        self.actions = actions
        self.live = live
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            ForEach(notices, id: \.self) { line in
                LobbyNoticeView(line: line)
            }
            if complete {
                LobbyNoticeView(line: Words.Lobby.over, verb: (Words.Lobby.readReport, actions.report))
            }
            if abandoned {
                LobbyNoticeView(line: Words.Lobby.abandoned, verb: (Words.Lobby.joinAnother, actions.another))
            } else {
                room
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }

    @ViewBuilder
    private var room: some View {
        if let bug = model.bug {
            if let roomNow {
                TimelineView(.periodic(from: .now, by: LobbyRoomView.tick)) { context in
                    LobbyScoreBugView(bug: bug.at(roomNow(context.date)))
                }
            } else {
                LobbyScoreBugView(bug: bug)
            }
        }
        LobbySeatsView(seats: model.seats, live: live)
        if let wait = model.wait {
            if let roomNow {
                TimelineView(.periodic(from: .now, by: LobbyRoomView.tick)) { context in
                    LobbyWaitView(wait: wait.at(roomNow(context.date)))
                }
            } else {
                LobbyWaitView(wait: wait)
            }
        }
        SinceView(strip: model.landing, straight: nil, live: live)
        if let call = model.call {
            MockCallView(
                state: .call(call.model, playerID: call.playerID), enabled: true,
                draft: { player in
                    guard let player else {
                        return
                    }
                    if call.drafts {
                        actions.draft(player)
                    } else {
                        actions.queueFirst(player)
                    }
                }
            )
        }
        if let pool = model.pool {
            MockPoolView(
                pool: pool,
                shown: shown,
                enabled: model.yourTurn,
                actions: actions.room,
                more: more,
                live: live
            )
        }
        WallView(wall: model.wall, open: { _ in }, live: live)
        LobbyAboutView(head: model.aboutHead, about: model.about)
        MockTeamView(title: Words.Room.yourTeam, team: model.team)
    }

    /// The live room: the pool's rows shown, its Show more, and the room's clock the score bug and the
    /// filling line tick on (the rest of the room redraws only when its model changes).
    func with(shown: Int, more: @escaping () -> Void, roomNow: @escaping (Date) -> Date) -> LobbyRoomScreen {
        var screen = self
        screen.shown = shown
        screen.more = more
        screen.roomNow = roomNow
        return screen
    }
}

/// The lobby full screen with its view model (web/src/routes/lobby/[id] at 390): the close (the seat
/// stays, its queue drafting until the member comes back) and the quiet Leave at the top, which asks
/// the web's question with Stay beside it; the room scrolling under it, its score bug and filling line redrawn four
/// times a second on the room's
/// clock;
/// the report in its place once the member reads it. The socket lives as long as this screen.
public struct LobbyRoomView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let viewModel: LobbyViewModel
    private let close: () -> Void
    private let left: () -> Void
    private let report: () -> Void
    private let opened: (String) -> Void
    @State private var shown = PoolModel.firstRows
    @State private var asking = false
    /// Try again's count: a new one runs the room again (a read that did not go is read afresh).
    @State private var attempt = 0

    /// `left` is the seat given up; `report` opens the report; `opened` is another lobby joined from a
    /// closed one.
    public init(
        viewModel: LobbyViewModel, close: @escaping () -> Void, left: @escaping () -> Void,
        report: @escaping () -> Void, opened: @escaping (String) -> Void
    ) {
        self.viewModel = viewModel
        self.close = close
        self.left = left
        self.report = report
        self.opened = opened
    }

    /// LobbyRoomView TICK_MS: a second clock read four times a second never shows a stale second.
    static let tick: TimeInterval = 0.25

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            LobbyTopBar(open: viewModel.open, close: close, leave: { asking = true })
            content
        }
        .background(theme.color(Tokens.Color.bg))
        .task(id: attempt) { await viewModel.run() }
        .alert(viewModel.leaveQuestion, isPresented: $asking) {
            Button(Words.Lobby.leaveVerb, role: .destructive) {
                Task {
                    if await viewModel.leave() {
                        left()
                    }
                }
            }
            Button(Words.Lobby.stay, role: .cancel) {}
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .room:
            ScrollView {
                if let model = viewModel.drawn {
                    LobbyRoomScreen(
                        model: model, notices: notices, complete: viewModel.lobby?.complete == true,
                        abandoned: viewModel.lobby?.abandoned == true, actions: actions
                    )
                    .with(shown: shown, more: { shown += PoolModel.moreRows }, roomNow: viewModel.roomNow)
                }
            }
        case let .failed(sentence, final):
            LobbyFailedView(sentence: sentence, retry: final ? nil : { attempt += 1 }, back: close)
        }
    }

    private var notices: [String] {
        [viewModel.stopped, viewModel.notice].compactMap(\.self)
    }

    private var actions: LobbyActions {
        LobbyActions(
            draft: { player in Task { await viewModel.draft(player) } },
            queueFirst: { player in Task { await viewModel.queueFirst(player) } },
            queue: { player in Task { await viewModel.toggleQueue(player) } },
            mark: { viewModel.mark($0) },
            filter: { filter in
                shown = PoolModel.firstRows
                viewModel.choose(filter: filter)
            },
            report: report,
            another: {
                Task {
                    if let id = await viewModel.joinAnother() {
                        opened(id)
                    }
                }
            }
        )
    }
}

/// A room or a report that cannot be read: why, Try again when the read did not go (no signal, the API's
/// own fault), and the quiet way back to the lobbies; a refusal for good keeps only the way back (B252,
/// the Android lobby's Failed).
struct LobbyFailedView: View {
    let sentence: String
    var retry: (() -> Void)?
    let back: () -> Void

    var body: some View {
        VStack(spacing: Tokens.Space.s4) {
            BasisText(sentence)
            if let retry {
                QuietButton(Words.Lobby.tryAgain, action: retry)
            }
            QuietButton(Words.Lobby.joinLobby, action: back)
        }
        .padding(Tokens.Space.s5)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The room's top: the close, the section's name, and while the room still takes people the quiet
/// Leave (the web's bar tail).
struct LobbyTopBar: View {
    @Environment(\.colorScheme) private var colorScheme
    let open: Bool
    let close: () -> Void
    let leave: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack {
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(AppWords.Lobby.close)
            Text(AppWords.Tab.mock)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
            Spacer()
            if open {
                QuietButton(Words.Lobby.leave, action: leave)
            }
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
        .padding(.horizontal, Tokens.Space.s2)
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// The lobby's report (web/src/routes/lobby/[id]/report at 390): the mock report's box score with the
/// people's names, its solid verb back to the lobbies and its quiet one against bots from the slot.
public struct LobbyReportView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let viewModel: LobbyReportViewModel
    private let lobbies: () -> Void
    private let opened: (String) -> Void

    public init(viewModel: LobbyReportViewModel, lobbies: @escaping () -> Void, opened: @escaping (String) -> Void) {
        self.viewModel = viewModel
        self.lobbies = lobbies
        self.opened = opened
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            LobbyTopBar(open: false, close: lobbies, leave: {})
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .report(report):
                ScrollView {
                    if let problem = viewModel.problem {
                        LobbyNoticeView(line: problem).padding(.top, Tokens.Space.s4)
                    }
                    MockReportScreen(report: report, verbs: Self.verbs(viewModel, lobbies: lobbies, opened: opened))
                }
            case let .failed(sentence):
                LobbyFailedView(sentence: sentence, back: lobbies)
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .task { await viewModel.load() }
    }

    /// The report page's verbs: Join another lobby solid, the same draft against bots quiet.
    static func verbs(
        _ viewModel: LobbyReportViewModel, lobbies: @escaping () -> Void, opened: @escaping (String) -> Void
    ) -> MockReportVerbs {
        MockReportVerbs(
            lead: Words.Lobby.joinAnother, run: lobbies,
            another: {
                Task {
                    if let id = await viewModel.runSolo() {
                        opened(id)
                    }
                }
            },
            anotherLabel: viewModel.soloVerb ?? "", copied: false, copy: nil
        )
    }
}
