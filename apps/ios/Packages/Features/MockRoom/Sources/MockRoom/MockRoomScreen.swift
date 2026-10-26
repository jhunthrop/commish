import CommishAPI
import CommishCore
import CommishDesign
import Companion
import SwiftUI

/// A part of the room, so a snapshot can frame the one it is of.
public enum MockRoomPart: CaseIterable, Sendable {
    case call
    case pool
    case wall
    case team
}

/// The room as its model says it, in the web's order at 390 (SoloRoom.svelte): a shared draft's head,
/// the saved room's line, the undo's line, the strip since your pick, our call, the pool, the wall and
/// your team. Pure of state, so a snapshot draws it from the fixture.
public struct MockRoomScreen: View {
    let model: MockRoomModel
    let stale: String?
    let refusal: String?
    let enabled: Bool
    let actions: MockRoomActions
    var parts = Set(MockRoomPart.allCases)
    var shown = PoolModel.firstRows
    var more: () -> Void = {}
    var run: () -> Void = {}
    var starting = false
    var live = true

    public init(
        model: MockRoomModel, stale: String?, refusal: String?, enabled: Bool, actions: MockRoomActions,
        parts: Set<MockRoomPart> = Set(MockRoomPart.allCases), live: Bool = true
    ) {
        self.model = model
        self.stale = stale
        self.refusal = refusal
        self.enabled = enabled
        self.actions = actions
        self.parts = parts
        self.live = live
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            if let shared = model.shared {
                MockSharedHeadView(head: shared, starting: starting, run: run)
            }
            ForEach([stale, refusal, model.notice].compactMap(\.self), id: \.self) { line in
                RoomPanel { Note(text: line) }
            }
            if parts.contains(.call) {
                SinceView(strip: model.since, straight: model.straight, live: live)
                if let call = model.call {
                    MockCallView(state: call, enabled: enabled, draft: actions.draft)
                }
            }
            if parts.contains(.pool), let pool = model.pool {
                MockPoolView(pool: pool, shown: shown, enabled: enabled, actions: actions, more: more, live: live)
            }
            if parts.contains(.wall) {
                // The companion's wall, one for both rooms; the mock room opens no player sheet yet.
                WallView(wall: model.wall, open: { _ in }, live: live)
            }
            if parts.contains(.team) {
                MockTeamView(title: model.teamTitle, team: model.team)
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }

    func with(shown: Int, more: @escaping () -> Void, run: @escaping () -> Void, starting: Bool) -> MockRoomScreen {
        var screen = self
        screen.shown = shown
        screen.more = more
        screen.run = run
        screen.starting = starting
        return screen
    }
}

/// The room full screen with its view model (web/src/routes/mock/[id] at 390): a close that asks first
/// at the top, the room scrolling under it, the web's bar at the bottom while the draft is on; the
/// report in its place once it is over. Every verb goes to the API and the room is redrawn from its
/// answer; a saved room shows stale with its verbs held until it reads again.
public struct MockRoomView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let viewModel: MockRoomViewModel
    private let close: () -> Void
    private let opened: (String) -> Void
    private let anotherSlot: (RoomSettings) -> Void
    @State private var shown = PoolModel.firstRows
    @State private var leaving = false

    /// `opened` is a new mock the report's verb started; `anotherSlot` opens the setup from its settings.
    public init(
        viewModel: MockRoomViewModel, close: @escaping () -> Void, opened: @escaping (String) -> Void,
        anotherSlot: @escaping (RoomSettings) -> Void
    ) {
        self.viewModel = viewModel
        self.close = close
        self.opened = opened
        self.anotherSlot = anotherSlot
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            top(theme)
            content
        }
        .background(theme.color(Tokens.Color.bg))
        .task { await viewModel.load() }
        .confirmationDialog(AppWords.Mock.leaveTitle, isPresented: $leaving, titleVisibility: .visible) {
            Button(AppWords.Mock.leave, role: .destructive, action: close)
            Button(AppWords.Mock.stay, role: .cancel) {}
        } message: {
            Text(AppWords.Mock.leaveMessage)
        }
    }

    private func top(_ theme: Theme) -> some View {
        HStack {
            Button {
                if case .room = viewModel.state {
                    leaving = true
                } else {
                    close()
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(AppWords.Mock.close)
            Text(AppWords.Tab.mock)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
            Spacer()
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
        .padding(.horizontal, Tokens.Space.s2)
        .overlay(alignment: .bottom) { Hairline() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case let .room(model, stale):
            ScrollView {
                MockRoomScreen(
                    model: model, stale: stale ? viewModel.staleWords : nil, refusal: viewModel.refusal,
                    enabled: viewModel.canWrite, actions: actions
                )
                .with(shown: shown, more: { shown += PoolModel.moreRows }, run: {}, starting: false)
            }
            .refreshable { await viewModel.refresh() }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let bar = model.bar {
                    MockBarView(bar: bar, enabled: viewModel.canWrite, copied: viewModel.copied, actions: actions)
                }
            }
        case let .report(report, _, settings, slot):
            ScrollView {
                MockReportScreen(
                    report: report,
                    verbs: MockReportVerbs(
                        lead: MockWords.runAgain(slot),
                        run: { Task {
                            if let id = await viewModel.runAgain() {
                                opened(id)
                            }
                        } },
                        another: { anotherSlot(settings) },
                        copied: viewModel.copied, copy: share
                    )
                )
            }
        case let .failed(sentence):
            VStack(spacing: Tokens.Space.s4) {
                BasisText(sentence)
                QuietButton(AppWords.Failure.tryAgain) { Task { await viewModel.load() } }
            }
            .padding(Tokens.Space.s5)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var actions: MockRoomActions {
        MockRoomActions(
            draft: { player in Task { await viewModel.draft(player) } },
            undo: { Task { await viewModel.undo() } },
            autopick: { Task { await viewModel.autopick() } },
            finish: { Task { await viewModel.finish() } },
            share: share,
            queue: { player in Task { await viewModel.toggleQueue(player) } },
            mark: { viewModel.mark($0) },
            filter: { filter in
                shown = PoolModel.firstRows
                viewModel.choose(filter: filter)
            }
        )
    }

    private func share() {
        guard let url = viewModel.shareURL else {
            return
        }
        UIPasteboardBridge.copy(url.absoluteString)
        Task { await viewModel.linkCopied() }
    }
}
