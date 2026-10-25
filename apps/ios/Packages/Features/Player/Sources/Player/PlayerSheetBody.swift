import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// The player sheet's body for the player the sheet opened on: the shelf's words while his week is
/// read, his card once it is, the shelf's words for a week that could not be read. It owns its view
/// model for his id, so the list under the sheet reading again never changes the player it shows.
public struct PlayerSheetBody: View {
    @State private var viewModel: PlayerSheetViewModel

    public init(viewModel: PlayerSheetViewModel) {
        _viewModel = State(initialValue: viewModel)
    }

    public var body: some View {
        ScrollView {
            PlayerSheetState(state: viewModel.state, stamp: viewModel.stampWords)
                .padding(.bottom, Tokens.Space.s5)
        }
        .scrollIndicators(.hidden)
        .task(id: viewModel.player.id) { await viewModel.load() }
    }
}

/// The body at a state, as the mock draws it too.
public struct PlayerSheetState: View {
    private let state: PlayerSheetViewModel.State
    private let stamp: String?

    public init(state: PlayerSheetViewModel.State, stamp: String?) {
        self.state = state
        self.stamp = stamp
    }

    public var body: some View {
        switch state {
        case .loading:
            BasisText(PlayerSheetWords.unreadBasis(failed: false, weekTile: Words.Card.proj))
        case let .loaded(card, _):
            PlayerCardView(card: card, stamp: stamp)
        case let .failed(words):
            BasisText(words)
        }
    }
}
