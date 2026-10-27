import CommishAPI
import CommishCore
import Sheet
import SwiftUI

/// The Cheat sheet tab: owns its view model, which keeps an unsaved edit and the open row while the
/// player sheet is over it. An empty sheet starts in the selected league's format, else the account's,
/// else PPR (the web's DEFAULT_FORMAT); its pinned verb opens a mock draft's setup.
struct SheetTab: View {
    @State private var viewModel: CheatSheetViewModel
    private let openMock: () -> Void

    init(
        environment: AppEnvironment, format: Components.Schemas.BoardFormatKnown?,
        expired: @escaping @MainActor () -> Void, openMock: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: CheatSheetViewModel(
            api: environment.api, run: environment.api, cache: environment.cache, clock: environment.clock,
            format: format ?? .ppr, onSignedOut: expired
        ))
        self.openMock = openMock
    }

    var body: some View {
        CheatSheetView(viewModel: viewModel, openMock: openMock)
    }
}
