import CommishAPI
import CommishCore
import MockRoom
import SwiftUI

/// A mock room the app opens full screen, by its id.
struct OpenMock: Identifiable, Hashable {
    let id: String
}

/// A lobby room the setup opens full screen, by its id; `report` once the member reads its report.
struct OpenLobby: Identifiable, Hashable {
    let id: String
    var report = false
}

/// The setup in a tab or pushed: owns its view model and the open house drafts under it (the web's
/// /lobby is this page); starting opens the mock room full screen, a lobby's Join opens the lobby room
/// full screen over it.
struct MockSetupTab: View {
    @State private var viewModel: MockSetupViewModel
    @State private var lobbies: LobbyLandingViewModel
    @State private var lobby: OpenLobby?
    /// A mock started from a lobby's report, opened once the lobby's cover has gone.
    @State private var startAfter: String?
    private let environment: AppEnvironment
    private let expired: @MainActor () -> Void
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
        _lobbies = State(initialValue: LobbyLandingViewModel(api: environment.api, onSignedOut: expired))
        self.environment = environment
        self.expired = expired
        self.start = start
    }

    var body: some View {
        MockSetupScreen(
            viewModel: viewModel, started: start, lobbies: lobbies, joined: { lobby = OpenLobby(id: $0) }
        )
        .task { await viewModel.load() }
        .task { await lobbies.load() }
        .refreshable { await lobbies.load() }
        .fullScreenCover(item: $lobby, onDismiss: dismissed) { open in
            LobbyCover(
                environment: environment, open: open, expired: expired,
                close: { lobby = nil },
                left: {
                    lobbies.forget(room: open.id)
                    lobby = nil
                },
                show: { lobby = $0 },
                solo: { id in
                    startAfter = id
                    lobby = nil
                }
            )
        }
    }

    /// The landing read again when a lobby closes; a mock its report started opens now.
    private func dismissed() {
        Task { await lobbies.load() }
        if let id = startAfter {
            startAfter = nil
            start(id)
        }
    }
}

/// The lobby full screen: the room, or its report once the member reads it; owns the view model of
/// whichever it shows, built anew for each room.
struct LobbyCover: View {
    let environment: AppEnvironment
    let open: OpenLobby
    let expired: @MainActor () -> Void
    let close: () -> Void
    let left: () -> Void
    let show: (OpenLobby) -> Void
    let solo: (String) -> Void

    var body: some View {
        if open.report {
            LobbyReportCover(environment: environment, id: open.id, expired: expired, lobbies: close, solo: solo)
        } else {
            LobbyRoomCover(
                environment: environment, id: open.id, expired: expired, close: close, left: left,
                report: { show(OpenLobby(id: open.id, report: true)) },
                opened: { show(OpenLobby(id: $0)) }
            )
            .id(open.id)
        }
    }
}

struct LobbyRoomCover: View {
    @State private var viewModel: LobbyViewModel
    private let close: () -> Void
    private let left: () -> Void
    private let report: () -> Void
    private let opened: (String) -> Void

    init(
        environment: AppEnvironment, id: String, expired: @escaping @MainActor () -> Void,
        close: @escaping () -> Void, left: @escaping () -> Void, report: @escaping () -> Void,
        opened: @escaping (String) -> Void
    ) {
        _viewModel = State(initialValue: LobbyViewModel(
            id: id, api: environment.api, connector: URLSessionRoomConnector(), tokens: environment.session,
            clock: environment.clock, onSignedOut: expired
        ))
        self.close = close
        self.left = left
        self.report = report
        self.opened = opened
    }

    var body: some View {
        LobbyRoomView(viewModel: viewModel, close: close, left: left, report: report, opened: opened)
    }
}

struct LobbyReportCover: View {
    @State private var viewModel: LobbyReportViewModel
    private let lobbies: () -> Void
    private let solo: (String) -> Void

    init(
        environment: AppEnvironment, id: String, expired: @escaping @MainActor () -> Void,
        lobbies: @escaping () -> Void, solo: @escaping (String) -> Void
    ) {
        _viewModel = State(initialValue: LobbyReportViewModel(
            id: id, api: environment.api, mocks: environment.api, onSignedOut: expired
        ))
        self.lobbies = lobbies
        self.solo = solo
    }

    var body: some View {
        LobbyReportView(viewModel: viewModel, lobbies: lobbies, opened: solo)
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
