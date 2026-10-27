import Board
import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// The setup (web/src/routes/mock/new at 390) for a mock against bots: the title, the clocks, the
/// scoring, the teams, your slot, the lineup, and the one verb pinned at the foot. Starting answers the
/// room's id, which the app opens full screen.
public struct MockSetupScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    private let viewModel: MockSetupViewModel
    private let started: (String) -> Void
    private let lobbies: LobbyLandingViewModel?
    private let joined: (String) -> Void
    var live = true

    /// `lobbies` draws the open house drafts under the form and the quiet "Join a lobby with people"
    /// beside the verb, as the web's setup does; `joined` opens a lobby room by its id.
    public init(
        viewModel: MockSetupViewModel, started: @escaping (String) -> Void, live: Bool = true,
        lobbies: LobbyLandingViewModel? = nil, joined: @escaping (String) -> Void = { _ in }
    ) {
        self.viewModel = viewModel
        self.started = started
        self.live = live
        self.lobbies = lobbies
        self.joined = joined
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            if live {
                // A join asking for a handle scrolls its question into view, wherever the tap was.
                ScrollViewReader { reader in
                    ScrollView { form(theme) }
                        .onChange(of: lobbies?.handleFor != nil) { _, asking in
                            if asking {
                                withAnimation { reader.scrollTo(Self.handleID, anchor: .top) }
                            }
                        }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) { pin(theme) }
            } else {
                VStack(spacing: 0) {
                    form(theme)
                    pin(theme)
                }
            }
        }
        .background(theme.color(Tokens.Color.bg))
    }

    private func form(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            if let lobbies, lobbies.handleFor != nil {
                LobbyHandleView(problem: lobbies.handleProblem, busy: lobbies.busy) { handle in
                    Task {
                        if let id = await lobbies.saveHandle(handle) {
                            joined(id)
                        }
                    }
                }
                .id(Self.handleID)
            }
            Text(Words.Mock.setupTitle)
                .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, Tokens.Space.s3)
            Cells(cells: viewModel.cells).padding(.horizontal, Tokens.Space.s3)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Words.MockClocks.label)
            row(Words.Mock.scoring, chips: viewModel.scoringChips) { viewModel.choose(scoring: $0) }
            row(Words.Mock.teams, chips: viewModel.teamChips) { viewModel.choose(teamsChip: $0) }
            slots
            row(Words.Mock.lineup, chips: viewModel.lineupChips) { viewModel.choose(lineup: $0) }
            if let lobbies, lobbies.read {
                LobbyListView(
                    head: lobbies.head, cards: lobbies.cards, problem: lobbies.problem, enabled: !lobbies.busy
                ) { card in join(card.format) }
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }

    /// Your slot: one chip per team and Random, wrapping as the web's loose group does.
    private var slots: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            Head(text: Words.Mock.slot, alignment: .leading).padding(.horizontal, Tokens.Space.s3)
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: Tokens.Space.s2), count: 7),
                alignment: .leading,
                spacing: Tokens.Space.s2
            ) {
                ForEach(viewModel.slots.compactMap(\.self), id: \.self) { slot in
                    ChoiceChip(String(slot), pressed: slot == viewModel.settings.slot) { viewModel.choose(slot: slot) }
                }
            }
            .padding(.horizontal, Tokens.Space.s3)
            ChoiceChip(Words.Mock.random, pressed: viewModel.settings.slot == nil) { viewModel.choose(slot: nil) }
                .fixedSize()
                .padding(.horizontal, Tokens.Space.s3)
        }
    }

    /// The handle question's place in the scroll.
    static let handleID = "lobby-handle"

    private func join(_ format: LobbyFormat) {
        guard let lobbies else {
            return
        }
        Task {
            if let id = await lobbies.join(format) {
                joined(id)
            }
        }
    }

    private func row(_ label: String, chips: [BoardChip<String>], choose: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            Head(text: label, alignment: .leading).padding(.horizontal, Tokens.Space.s3)
            ChipRow(chips: chips, choose: choose, live: live)
        }
    }

    private func pin(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            if let problem = viewModel.problem {
                Note(text: problem)
            }
            Verb(Words.Mock.start, enabled: !viewModel.busy) {
                Task {
                    if let id = await viewModel.start() {
                        started(id)
                    }
                }
            }
            if let lobbies {
                QuietButton(Words.Lobby.joinWithPeople) {
                    join(LobbyLandingViewModel.nearest(viewModel.settings))
                }
                .disabled(lobbies.busy || viewModel.busy)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
        .frame(maxWidth: .infinity)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .top) { Hairline() }
    }
}

/// A shared draft read by its code (web/src/routes/mock/share/[code] at 390): its head and the room as
/// it stood, read and never drafted in; once finished its report. Its one verb runs the draft as the
/// reader's own and the app opens that room.
public struct SharedMockView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let viewModel: SharedMockViewModel
    private let opened: (String) -> Void
    @State private var shown = PoolModel.firstRows

    public init(viewModel: SharedMockViewModel, opened: @escaping (String) -> Void) {
        self.viewModel = viewModel
        self.opened = opened
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .room(model):
                ScrollView {
                    MockRoomScreen(
                        model: model, stale: nil, refusal: viewModel.problem, enabled: false,
                        actions: MockRoomActions(
                            draft: { _ in }, undo: {}, autopick: {}, finish: {}, share: {}, queue: { _ in },
                            mark: { _ in }, filter: { viewModel.choose(filter: $0) }
                        )
                    )
                    .with(shown: shown, more: { shown += PoolModel.moreRows }, run: run, starting: viewModel.starting)
                }
            case let .report(report, verb):
                ScrollView {
                    MockReportScreen(
                        report: report,
                        verbs: MockReportVerbs(lead: verb, run: run, another: nil, copied: false, copy: nil)
                    )
                }
            case let .failed(sentence):
                BasisText(sentence).padding(Tokens.Space.s5).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .task { await viewModel.load() }
    }

    private func run() {
        Task {
            if let id = await viewModel.run() {
                opened(id)
            }
        }
    }
}
