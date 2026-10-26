import CommishCore
import Rankings
import Record
import SwiftUI

/// The Rankings: owns its view model, which holds the chips and the search while the sheet is open.
struct RankingsTab: View {
    @State private var viewModel: RankingsViewModel

    init(environment: AppEnvironment, inSeason: Bool, query: String, expired: @escaping @MainActor () -> Void) {
        _viewModel = State(initialValue: RankingsViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, inSeason: inSeason,
            query: query, onSignedOut: expired
        ))
    }

    var body: some View {
        RankingsView(viewModel: viewModel)
    }
}

/// Our record: owns its view model, which holds the chips.
struct RecordTab: View {
    @State private var viewModel: RecordViewModel

    init(environment: AppEnvironment, expired: @escaping @MainActor () -> Void) {
        _viewModel = State(initialValue: RecordViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, onSignedOut: expired
        ))
    }

    var body: some View {
        RecordView(viewModel: viewModel)
    }
}
