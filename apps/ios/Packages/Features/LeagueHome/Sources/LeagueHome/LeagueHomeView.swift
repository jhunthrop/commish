import CommishCore
import CommishDesign
import SwiftUI

/// The League home as its model says it, in the web's order (LeaguePage.svelte): the league's head,
/// the week's scoreboard, the standings, the member's lineup, the moves, the basis once at the foot.
/// Pure of state, so a snapshot draws it from the fixture at the fixture's clock.
public struct LeagueHomeScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: LeagueHomeModel
    let stamp: String?
    let openLineup: () -> Void
    let still: Bool

    /// `still` draws the scoreboard's hand at rest, for a render with no scrolling (the snapshot).
    public init(model: LeagueHomeModel, stamp: String?, still: Bool = false, openLineup: @escaping () -> Void) {
        self.model = model
        self.stamp = stamp
        self.still = still
        self.openLineup = openLineup
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s5) {
            VStack(alignment: .leading, spacing: 2) {
                Text(model.platform)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
                Text(model.leagueName)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xl, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            .padding(.horizontal, Tokens.Space.s4)
            if !model.bugs.isEmpty {
                ScoreBoardView(
                    title: model.weekTitle, aside: model.scoreboardAside, stamp: stamp, bugs: model.bugs,
                    scrolls: !still
                )
            }
            StandingsView(section: model.standings)
            if let lineup = model.lineup {
                LineupSummaryView(section: lineup, openLineup: openLineup)
            }
            MovesFeedView(section: model.moves)
            BasisText(model.basis)
                .padding(.horizontal, Tokens.Space.s4)
        }
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// The League home with its view model: the saved home at once, then the API's; a pull reads again.
/// The caller owns the view model (it is @Observable, so the view follows its state as it reads it).
public struct LeagueHomeView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let viewModel: LeagueHomeViewModel
    private let leagueID: String
    private let openLineup: () -> Void

    public init(viewModel: LeagueHomeViewModel, leagueID: String, openLineup: @escaping () -> Void) {
        self.viewModel = viewModel
        self.leagueID = leagueID
        self.openLineup = openLineup
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(model, _, _):
                ScrollView {
                    LeagueHomeScreen(model: model, stamp: viewModel.stampWords, openLineup: openLineup)
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
