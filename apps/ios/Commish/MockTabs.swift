import CommishAPI
import CommishCore
import MockRoom
import SwiftUI

/// A mock room the app opens full screen, by its id.
struct OpenMock: Identifiable, Hashable {
    let id: String
}

/// The setup in a tab or pushed: owns its view model; starting opens the room full screen.
struct MockSetupTab: View {
    @State private var viewModel: MockSetupViewModel
    private let start: (String) -> Void

    init(
        environment: AppEnvironment,
        from: RoomSettings?,
        seed: MockSetupSeed,
        expired: @escaping @MainActor () -> Void,
        start: @escaping (String) -> Void
    ) {
        _viewModel = State(initialValue: MockSetupViewModel(
            api: environment.api, from: from, seed: seed, onSignedOut: expired
        ))
        self.start = start
    }

    var body: some View {
        MockSetupScreen(viewModel: viewModel, started: start)
            .task { await viewModel.load() }
    }
}

/// The room full screen: owns its view model for the mock it shows; leaving closes it, a new mock from
/// the report opens in its place, Try another slot opens the setup from the draft's settings.
struct MockRoomCover: View {
    @State private var viewModel: MockRoomViewModel
    private let close: () -> Void
    private let opened: (String) -> Void
    private let anotherSlot: (RoomSettings) -> Void

    init(
        environment: AppEnvironment, id: String, expired: @escaping @MainActor () -> Void,
        close: @escaping () -> Void, opened: @escaping (String) -> Void, anotherSlot: @escaping (RoomSettings) -> Void
    ) {
        _viewModel = State(initialValue: MockRoomViewModel(
            id: id, api: environment.api, cache: environment.cache, clock: environment.clock, onSignedOut: expired
        ))
        self.close = close
        self.opened = opened
        self.anotherSlot = anotherSlot
    }

    var body: some View {
        MockRoomView(viewModel: viewModel, close: close, opened: opened, anotherSlot: anotherSlot)
    }
}

/// A shared draft pushed where its link was opened; running it opens the reader's own room.
struct SharedMockTab: View {
    @State private var viewModel: SharedMockViewModel
    private let opened: (String) -> Void

    init(environment: AppEnvironment, code: String, opened: @escaping (String) -> Void) {
        _viewModel = State(initialValue: SharedMockViewModel(code: code, api: environment.api))
        self.opened = opened
    }

    var body: some View {
        SharedMockView(viewModel: viewModel, opened: opened)
    }
}
