import CommishCore
import CommishDesign
import SwiftUI

/// The Trades with its view model: the saved finder at once, then the API's; a pull reads again; a
/// row opens its trade; the picker reads the trades holding a player; the builder opens, picks and
/// reads its check, its gains and verb pinned above the bar while it is open; a verb copies the offer
/// and opens the platform's trade page; a name opens the player sheet by his id, and the sheet keeps its
/// player when the finder reads again under it.
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
                ScrollView {
                    TradesScreen(model: model, stamp: viewModel.stampWords, shown: shown, actions: actions(model))
                }
                .refreshable { await viewModel.load(leagueID: leagueID) }
                .onChange(of: model) { _, fresh in
                    sheet.parentRefreshed(fresh.sheetPlayers)
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if let builder = viewModel.builder {
                        BuilderPin(
                            builder: builder, verb: model.verb, page: model.page, copied: viewModel.builderCopied
                        ) { press(model) }
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
        .task { await viewModel.load(leagueID: leagueID) }
    }

    private var shown: TradesShown {
        TradesShown(
            every: viewModel.every, sort: viewModel.sort, opened: viewModel.opened, copied: viewModel.copied,
            narrowing: viewModel.narrowing, problem: viewModel.problem, builder: viewModel.builder,
            checking: viewModel.checking, builderCopied: viewModel.builderCopied
        )
    }

    /// The builder's verb: the built offer copied, then the platform's trade page, as the web's verb.
    private func press(_ model: TradesModel) {
        viewModel.pressBuilder()
        if let page = model.page {
            openURL(page)
        }
    }

    private func actions(_ model: TradesModel) -> TradeActions {
        let league = leagueID
        let viewModel = viewModel
        return TradeActions(
            open: { sheet.open($0) },
            toggle: { viewModel.toggle($0) },
            press: { key in
                viewModel.press(key)
                // As the web's verb: the offer copied, then the platform's trade page.
                if let page = model.page {
                    openURL(page)
                }
            },
            showEvery: { viewModel.showEvery($0) },
            sort: { viewModel.sort(by: $0) },
            pick: { key in Task { await viewModel.pick(key, leagueID: league) } },
            builder: BuilderActions(
                new: { viewModel.buildNew() },
                from: { key in Task { await viewModel.build(from: key, leagueID: league) } },
                close: { viewModel.closeBuilder() },
                team: { team in Task { await viewModel.choose(team: team, leagueID: league) } },
                tap: { side, player in Task { await viewModel.tap(side, player: player, leagueID: league) } },
                press: { press(model) }
            )
        )
    }
}
