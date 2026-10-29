import CommishCore
import CommishDesign
import SwiftUI

/// The Trades with its view model: the saved read at once, then the API's; a pull reads again; the
/// builder is the screen, an idea loading its ticks and every tick reading its check, the gains, Share
/// and the verb pinned above the bar; the verb copies the offer and opens the platform's trade page; a
/// name opens the player sheet by his id, and the sheet keeps its player when the trades read again
/// under it.
public struct TradesView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: TradesViewModel
    private let leagueID: String

    public init(viewModel: TradesViewModel, leagueID: String) {
        self.viewModel = viewModel
        self.leagueID = leagueID
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(model, _, _):
                if let builder = viewModel.builder {
                    loaded(model, builder: builder)
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
        .task { await viewModel.load(leagueID: leagueID) }
    }

    private func loaded(_ model: TradesModel, builder: TradeBuilderModel) -> some View {
        let shown = TradesShown(
            builder: builder, drawn: viewModel.drawn, checking: viewModel.checking, copied: viewModel.builderCopied,
            shared: viewModel.shared
        )
        let actions = actions(model)
        return ScrollView {
            TradesScreen(model: model, stamp: viewModel.stampWords, shown: shown, actions: actions)
        }
        .refreshable { await viewModel.load(leagueID: leagueID) }
        .onChange(of: builder.sheetPlayers) { _, fresh in
            sheet.parentRefreshed(fresh)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            BuilderPin(
                builder: builder, verb: model.verb, page: model.page, checking: viewModel.checking,
                copied: viewModel.builderCopied, shared: viewModel.shared, actions: actions
            )
        }
    }

    private func actions(_ model: TradesModel) -> TradeActions {
        let league = leagueID
        let viewModel = viewModel
        return TradeActions(
            open: { sheet.open($0) },
            idea: { key in Task { await viewModel.load(idea: key, leagueID: league) } },
            more: { viewModel.showAllIdeas() },
            show: { viewModel.show($0) },
            team: { team in Task { await viewModel.choose(team: team, leagueID: league) } },
            tap: { side, player in Task { await viewModel.tap(side, player: player, leagueID: league) } },
            press: {
                // As the web's verb: the offer copied, then the platform's trade page.
                viewModel.pressBuilder()
                if let page = model.page {
                    openURL(page)
                }
            },
            share: { viewModel.share() }
        )
    }
}
