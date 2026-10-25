import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// The player page pushed on a tab: owns its view model for the slug it shows, the page while it is
/// read, the page once it is, and the reason when it cannot be.
public struct PlayerPageView: View {
    @State private var viewModel: PlayerPageViewModel
    private let act: (CardVerb, String) -> (() -> Void)?

    public init(viewModel: PlayerPageViewModel, act: @escaping (CardVerb, String) -> (() -> Void)?) {
        _viewModel = State(initialValue: viewModel)
        self.act = act
    }

    public var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(model, _):
                PlayerPageScreen(model: model, stamp: viewModel.stampWords, act: act)
            case let .failed(words):
                BasisText(words).padding(Tokens.Space.s5)
            }
        }
        .task(id: viewModel.slug) { await viewModel.load() }
        .refreshable { await viewModel.load() }
    }
}
