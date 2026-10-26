import Board
import CommishCore
import SwiftUI

/// The board's tab: owns its view model, which holds the chips while the player sheet is open over it.
struct BoardTab: View {
    @State private var viewModel: BoardViewModel

    init(environment: AppEnvironment, inSeason: Bool, following: Bool, expired: @escaping @MainActor () -> Void) {
        _viewModel = State(initialValue: BoardViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, inSeason: inSeason,
            following: following, orders: environment.orders, onSignedOut: expired
        ))
    }

    var body: some View {
        BoardView(viewModel: viewModel)
    }
}
