import CommishCore
import CommishDesign
import SwiftUI

/// The League home as its model says it, in the web's order (LeaguePage.svelte): the league's head,
/// the week's scoreboard, the standings, the member's lineup, the moves, the basis once at the foot.
/// Pure of state, so a snapshot draws it from the fixture at the fixture's clock. A score bug opens its
/// game: `openGame` with nil for the member's, else the roster of the game's first side. On draft day
/// the draft's word and the Advisor's verb sit under the league's head.
public struct LeagueHomeScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: LeagueHomeModel
    let stamp: String?
    let openLineup: () -> Void
    let openGame: (Int?) -> Void
    let still: Bool
    let draftDay: DraftDayEntry?
    let openAdvisor: () -> Void

    /// `still` draws the scoreboard's hand at rest, for a render with no scrolling (the snapshot).
    public init(
        model: LeagueHomeModel, stamp: String?, still: Bool = false, openLineup: @escaping () -> Void,
        openGame: @escaping (Int?) -> Void = { _ in }, draftDay: DraftDayEntry? = nil,
        openAdvisor: @escaping () -> Void = {}
    ) {
        self.model = model
        self.stamp = stamp
        self.still = still
        self.openLineup = openLineup
        self.openGame = openGame
        self.draftDay = draftDay
        self.openAdvisor = openAdvisor
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s5) {
            ForEach(LeagueHomePart.allCases, id: \.self) { part in
                LeagueHomePartView(
                    part: part, model: model, stamp: stamp, still: still, openLineup: openLineup, openGame: openGame,
                    draftDay: draftDay, openAdvisor: openAdvisor
                )
            }
        }
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// The screen's three runs, top to bottom: each a snapshot of its own, so no reference grows past what
/// a repository keeps, and a change shows in the run it touched.
enum LeagueHomePart: CaseIterable {
    /// The league's head, the week's scoreboard and the standings.
    case top
    /// The member's lineup.
    case lineup
    /// The moves and the basis.
    case foot
}

struct LeagueHomePartView: View {
    @Environment(\.colorScheme) private var colorScheme
    let part: LeagueHomePart
    let model: LeagueHomeModel
    let stamp: String?
    let still: Bool
    let openLineup: () -> Void
    var openGame: (Int?) -> Void = { _ in }
    var draftDay: DraftDayEntry?
    var openAdvisor: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s5) {
            switch part {
            case .top:
                head
                if let draftDay {
                    DraftDayPanel(entry: draftDay, openAdvisor: openAdvisor)
                }
                if !model.bugs.isEmpty {
                    ScoreBoardView(
                        title: model.weekTitle, aside: model.scoreboardAside, stamp: stamp, bugs: model.bugs,
                        openGame: openGame, scrolls: !still
                    )
                }
                StandingsView(section: model.standings)
            case .lineup:
                if let lineup = model.lineup {
                    LineupSummaryView(section: lineup, openLineup: openLineup)
                }
            case .foot:
                MovesFeedView(section: model.moves)
                BasisText(model.basis)
                    .padding(.horizontal, Tokens.Space.s4)
            }
        }
    }

    private var head: some View {
        let theme = Theme(colorScheme)
        return VStack(alignment: .leading, spacing: 2) {
            Text(model.platform)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.accentText))
            Text(model.leagueName)
                .font(Faces.font(.num, size: Tokens.TypeScale.head, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        }
        .padding(.horizontal, Tokens.Space.s4)
    }
}

/// The League home with its view model: the saved home at once, then the API's; a pull reads again.
/// The caller owns the view model (it is @Observable, so the view follows its state as it reads it).
/// A score bug opens its game through `openGame`.
public struct LeagueHomeView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let viewModel: LeagueHomeViewModel
    private let leagueID: String
    private let openLineup: () -> Void
    private let openGame: (Int?) -> Void
    private let draftDay: DraftDayEntry?
    private let openAdvisor: () -> Void

    public init(
        viewModel: LeagueHomeViewModel, leagueID: String, openLineup: @escaping () -> Void,
        openGame: @escaping (Int?) -> Void = { _ in }, draftDay: DraftDayEntry? = nil,
        openAdvisor: @escaping () -> Void = {}
    ) {
        self.viewModel = viewModel
        self.leagueID = leagueID
        self.openLineup = openLineup
        self.openGame = openGame
        self.draftDay = draftDay
        self.openAdvisor = openAdvisor
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(model, _, _):
                ScrollView {
                    LeagueHomeScreen(
                        model: model, stamp: viewModel.stampWords, openLineup: openLineup, openGame: openGame,
                        draftDay: draftDay, openAdvisor: openAdvisor
                    )
                }
                .refreshable { await viewModel.load(leagueID: leagueID) }
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
        .task(id: leagueID) { await viewModel.load(leagueID: leagueID) }
    }
}
