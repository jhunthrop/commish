import CommishCore
import Companion
import SwiftUI

/// The live-draft companion's start page, the Advisor's screen (nav.ts ADVISOR links COMPANION_START):
/// owns its view model; following a draft, or tapping one followed before, pushes it.
struct CompanionStartScreen: View {
    @State private var viewModel: NewCompanionViewModel
    private let open: (String) -> Void

    init(
        environment: AppEnvironment, replay: Bool, expired: @escaping @MainActor () -> Void,
        open: @escaping (String) -> Void
    ) {
        _viewModel = State(initialValue: NewCompanionViewModel(
            api: environment.api, replay: replay || environment.companionReplay, onSignedOut: expired
        ))
        self.open = open
    }

    var body: some View {
        NewCompanionView(viewModel: viewModel, opened: open)
    }
}

/// A followed draft: owns its view model for the draft it shows; the view polls while on screen.
struct CompanionDraftScreen: View {
    @State private var viewModel: CompanionViewModel
    private let followAnother: () -> Void

    init(
        environment: AppEnvironment, id: String, expired: @escaping @MainActor () -> Void,
        followAnother: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: CompanionViewModel(
            id: id, api: environment.api, cache: environment.cache, clock: environment.clock, onSignedOut: expired
        ))
        self.followAnother = followAnother
    }

    var body: some View {
        CompanionView(viewModel: viewModel, followAnother: followAnother)
    }
}
