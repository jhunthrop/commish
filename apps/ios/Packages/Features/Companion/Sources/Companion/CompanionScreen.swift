import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// What the screen's controls do: a row opens the player sheet, the verb and the bar's link open the
/// platform's draft room, a chip chooses, another draft is followed from the start page.
public struct CompanionActions {
    let open: (SheetPlayer) -> Void
    let openDraft: () -> Void
    let filter: (String) -> Void
    let followAnother: () -> Void

    public init(
        open: @escaping (SheetPlayer) -> Void, openDraft: @escaping () -> Void, filter: @escaping (String) -> Void,
        followAnother: @escaping () -> Void
    ) {
        self.open = open
        self.openDraft = openDraft
        self.filter = filter
        self.followAnother = followAnother
    }

    /// Controls that do nothing: a snapshot's.
    public static var none: CompanionActions {
        CompanionActions(open: { _ in }, openDraft: {}, filter: { _ in }, followAnother: {})
    }
}

/// A part of the followed draft's screen, so a snapshot can frame the one it is of.
public enum CompanionPart: CaseIterable, Sendable {
    case head
    case strips
    case call
    case pool
    case wall
    case team
}

/// The followed draft as its model says it, in the web's order at 390 (CompanionRoom.svelte): the
/// reconnecting line over picks that are not the latest, the bar, the notes, the picks as they land
/// (or at your turn the picks since your last), our call and who we would take next, the pool, the
/// wall, your team. Pure of state, so a snapshot draws it from the fixture.
public struct CompanionScreen: View {
    let model: CompanionModel
    let stale: String?
    let actions: CompanionActions
    var parts = Set(CompanionPart.allCases)
    /// The pool rows drawn: the first, then more on a tap.
    var shown = PoolModel.firstRows
    var more: () -> Void = {}
    /// The screen's: strips and chips that scroll; a snapshot's draws them still.
    var live = true

    public init(
        model: CompanionModel, stale: String?, actions: CompanionActions, shown: Int = PoolModel.firstRows,
        more: @escaping () -> Void = {}, live: Bool = true, parts: Set<CompanionPart> = Set(CompanionPart.allCases)
    ) {
        self.model = model
        self.parts = parts
        self.stale = stale
        self.actions = actions
        self.shown = shown
        self.more = more
        self.live = live
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            if parts.contains(.head) {
                head
            }
            if parts.contains(.strips) {
                strips
            }
            if parts.contains(.call) {
                calls
            }
            if parts.contains(.pool), let pool = model.pool {
                PoolView(pool: pool, shown: shown, choose: actions.filter, more: more, open: actions.open, live: live)
            }
            if parts.contains(.wall) {
                WallView(wall: model.wall, open: actions.open, live: live)
            }
            if parts.contains(.team) {
                TeamView(team: model.team, open: actions.open)
            }
        }
        .padding(.vertical, Tokens.Space.s3)
    }

    /// The reconnecting line, the bar, the line when our draft stops following, the notes.
    @ViewBuilder
    private var head: some View {
        if let stale {
            Panel(edge: .quiet) {
                VStack(alignment: .leading, spacing: 2) {
                    NoteText(text: Words.Companion.reconnecting)
                    NoteText(text: stale, ink: Tokens.Color.accentText)
                }
            }
            .accessibilityAddTraits(.updatesFrequently)
        }
        CompanionBarView(bar: model.bar, openDraft: actions.openDraft)
        if let lost = model.lost {
            Panel(edge: .loss) { NoteText(text: lost) }
        }
        ForEach(model.notes, id: \.self) { note in
            NoteText(text: note).padding(.horizontal, Tokens.Space.s3)
        }
    }

    /// The picks as they land, or at your turn the picks since your last.
    @ViewBuilder
    private var strips: some View {
        if let strip = model.strip {
            PickStripView(strip: strip, open: actions.open, live: live)
        }
        if let since = model.since {
            PickStripView(strip: since, open: actions.open, live: live)
        }
    }

    /// Our call and who we would take next.
    @ViewBuilder
    private var calls: some View {
        if let call = model.call {
            CallPanelView(call: call, open: actions.open, press: actions.openDraft)
        }
        if let shortlist = model.shortlist, !shortlist.isEmpty {
            ShortlistView(lines: shortlist, open: actions.open)
        }
    }
}

/// A followed draft with its view model: the saved picks at once, then the API's every three seconds
/// while the screen is on screen with the app in the foreground; the report once the draft is over; the
/// verb opens the platform's draft room (Sleeper's app where it is installed); a row opens the player
/// sheet, which keeps him as the picks land under it.
public struct CompanionView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @Environment(PlayerSheetHost.self) private var sheet
    @State private var shown = PoolModel.firstRows
    @State private var onScreen = false
    private let viewModel: CompanionViewModel
    private let followAnother: () -> Void

    public init(viewModel: CompanionViewModel, followAnother: @escaping () -> Void) {
        self.viewModel = viewModel
        self.followAnother = followAnother
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .room(model, _):
                ScrollView {
                    CompanionScreen(
                        model: model, stale: viewModel.stampWords, actions: actions, shown: shown,
                        more: { shown += PoolModel.moreRows }
                    )
                }
                .refreshable { await viewModel.refresh() }
                .onChange(of: model.pool?.filter) { shown = PoolModel.firstRows }
            case let .report(report, _):
                ScrollView {
                    DraftReportScreen(report: report, actions: actions)
                }
            case let .failed(failure):
                CompanionFailureView(failure: failure, followAnother: followAnother) {
                    // A fresh poll: it reads at once, and goes on once the draft reads.
                    viewModel.setVisible(false)
                    viewModel.setVisible(true)
                }
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .onAppear {
            onScreen = true
            viewModel.setVisible(scenePhase == .active)
        }
        .onDisappear {
            onScreen = false
            viewModel.setVisible(false)
        }
        .onChange(of: scenePhase) { _, phase in
            viewModel.setVisible(onScreen && phase == .active)
        }
    }

    private var actions: CompanionActions {
        let openURL = openURL
        let url = { () -> URL? in
            switch viewModel.state {
            case let .room(model, _): model.bar.openURL
            case let .report(_, bar): bar.openURL
            case .loading, .failed: nil
            }
        }
        return CompanionActions(
            open: { sheet.open($0) },
            openDraft: {
                if let target = url() {
                    openURL(target)
                }
            },
            filter: { viewModel.choose(filter: $0) },
            followAnother: followAnother
        )
    }
}

/// The page's words when the draft cannot be shown (CompanionPage.svelte): signed out, not on this
/// account, or never read.
struct CompanionFailureView: View {
    let failure: CompanionViewModel.Failure
    let followAnother: () -> Void
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            switch failure {
            case .signedOut:
                SectionHead(Words.Companion.signedOutTitle)
                NoteText(text: Words.Companion.signedOutLine)
            case .missing:
                SectionHead(Words.Companion.missingTitle)
                NoteText(text: Words.Companion.missingLine)
                Verb(Words.Companion.followADraft, action: followAnother)
            case .unreachable:
                SectionHead(Words.Companion.unreachableTitle)
                NoteText(text: Words.Companion.reloadLine)
                QuietButton(AppWords.Failure.tryAgain, action: retry)
            }
        }
        .padding(Tokens.Space.s5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
