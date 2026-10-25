import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// The Matchup as its model says it, in the web's order (MatchupPanel.svelte at 390): over another
/// team's game the line saying whose it is with the way to the member's own, the week and both teams,
/// the score bug, its notes, the first side's box, the second's, the basis once at the foot. Pure of
/// state, so a snapshot draws it from the fixture at the fixture's clock.
public struct MatchupScreen: View {
    let model: MatchupModel
    let stamp: String?
    let actions: RowActions
    let yourGame: () -> Void

    public init(
        model: MatchupModel, stamp: String?, open: @escaping (SheetPlayer) -> Void = { _ in },
        yourGame: @escaping () -> Void = {}
    ) {
        self.model = model
        self.stamp = stamp
        actions = RowActions(open: open)
        self.yourGame = yourGame
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            switch model {
            case let .week(week):
                ForEach(MatchupPart.allCases, id: \.self) { part in
                    MatchupPartView(part: part, week: week, stamp: stamp, actions: actions, yourGame: yourGame)
                }
            case let .gap(sentence):
                BasisText(sentence).padding(.horizontal, Tokens.Space.s3)
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// The screen's two runs, top to bottom: each a snapshot of its own, so no reference grows past what a
/// repository keeps.
enum MatchupPart: CaseIterable {
    /// The title, the bug, its notes and the first side's box (the member's on the member's game).
    case mine
    /// The second side's box and the basis.
    case theirs
}

struct MatchupPartView: View {
    let part: MatchupPart
    let week: MatchupWeek
    let stamp: String?
    let actions: RowActions
    var yourGame: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            switch part {
            case .mine:
                if let whose = week.whose {
                    WhoseLine(whose: whose, yourGame: yourGame)
                }
                MatchupTitle(week: week, stamp: stamp)
                MatchupBugView(bug: week.bug)
                ForEach(week.notes, id: \.self) { BasisText($0) }
                if let mine = week.boxes.first {
                    TeamBoxView(box: mine, actions: actions)
                }
            case .theirs:
                ForEach(week.boxes.dropFirst()) { box in
                    TeamBoxView(box: box, actions: actions)
                }
                if let none = week.noOpponent {
                    BasisText(none)
                }
                BasisText(week.basis)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
    }
}

/// Over another team's game (MatchupPanel.svelte's whose line): "Their game" in the quiet ink, and at
/// the far end "Your game", the way to the member's own on the Matchup tab.
struct WhoseLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let whose: GameWhose
    let yourGame: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .firstTextBaseline) {
            Text(whose.head)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
            Spacer(minLength: Tokens.Space.s3)
            Button(whose.link, action: yourGame)
                .buttonStyle(.plain)
                .foregroundStyle(theme.color(Tokens.Color.accentText))
        }
        .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
        .textCase(.uppercase)
        .tracking(Tokens.TypeScale.md * 0.04)
    }
}

/// "Week 6" over both teams' names, "vs" between them in the quiet ink; a saved read's stamp under.
struct MatchupTitle: View {
    @Environment(\.colorScheme) private var colorScheme
    let week: MatchupWeek
    let stamp: String?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            Text(week.week)
                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                .textCase(.uppercase)
                .tracking(Tokens.TypeScale.md * 0.04)
                .foregroundStyle(theme.color(Tokens.Color.accentText))
            (Text(week.mine) + versus(theme) + Text(week.opponent ?? ""))
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .textCase(.uppercase)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            if let stamp {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
            }
        }
    }

    private func versus(_ theme: Theme) -> Text {
        guard week.opponent != nil else {
            return Text(verbatim: "")
        }
        return Text(verbatim: " ") + Text(Words.Matchup.vs).foregroundStyle(theme.color(Tokens.Color.ink3))
            + Text(verbatim: " ")
    }
}

/// The Matchup with its view model: the saved week at once, then the API's; while on screen with the
/// app in the foreground it reads again on the web's cadence, and stops when hidden or backgrounded; a
/// pull reads again; a row's name opens the player sheet by his id, and the sheet keeps its player when
/// the week reads again under it. Another team's game (a view model with a roster) carries none of the
/// member's verbs; its whose line's link opens the member's own.
public struct MatchupView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @Environment(PlayerSheetHost.self) private var sheet
    @State private var onScreen = false
    private let viewModel: MatchupViewModel
    private let leagueID: String
    /// The way to the member's lineup, the sheet's verb on his own rows.
    private let openLineup: @MainActor @Sendable () -> Void
    /// The way from another team's game to the member's own.
    private let yourGame: @MainActor () -> Void

    public init(
        viewModel: MatchupViewModel, leagueID: String, openLineup: @escaping @MainActor @Sendable () -> Void = {},
        yourGame: @escaping @MainActor () -> Void = {}
    ) {
        self.viewModel = viewModel
        self.leagueID = leagueID
        self.openLineup = openLineup
        self.yourGame = yourGame
    }

    /// The sheet's verb on the Matchup (MatchupPanel.svelte's lineupOffer): the way to his lineup on the
    /// member's own rows, none on the opponent's.
    func offer(_ model: MatchupModel, _ player: SheetPlayer) -> SheetOffer? {
        guard case let .week(week) = model, week.isMine(player) else {
            return nil
        }
        return SheetOffer(label: Words.Card.openLineup, line: nil, lineup: true, act: openLineup)
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(model, _, _):
                ScrollView {
                    MatchupScreen(
                        model: model, stamp: viewModel.stampWords, open: { sheet.open($0, offer: offer(model, $0)) },
                        yourGame: yourGame
                    )
                }
                .refreshable { await viewModel.load(leagueID: leagueID) }
                .onChange(of: model) { _, fresh in
                    if case let .week(week) = fresh {
                        sheet.parentRefreshed(week.sheetPlayers)
                    }
                }
            case let .failed(sentence):
                VStack(spacing: Tokens.Space.s4) {
                    BasisText(sentence)
                    QuietButton(AppWords.Failure.tryAgain) {
                        Task { await viewModel.load(leagueID: leagueID) }
                    }
                }
                .padding(Tokens.Space.s5)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .onAppear { onScreen = true }
        .onDisappear {
            // Said here, not through onChange, which a screen being torn down may never run.
            onScreen = false
            viewModel.setVisible(false, leagueID: leagueID)
        }
        .onChange(of: onScreen && scenePhase == .active, initial: true) { _, visible in
            viewModel.setVisible(visible, leagueID: leagueID)
        }
    }
}
