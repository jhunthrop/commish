import Account
import CommishCore
import SwiftUI

/// The Account: owns its view model; sign out is the session's (it revokes this phone and returns to
/// sign-in), a detach reads the account again for the league switch once its undo has passed (or the
/// member leaves), a league opens its home as the switch's choice does, and a site link opens in the
/// browser.
struct AccountTab: View {
    @Environment(\.openURL) private var openURL
    @State private var viewModel: AccountViewModel
    private let openLeague: (String) -> Void

    init(
        environment: AppEnvironment, session: AppSession, expired: @escaping @MainActor () -> Void,
        openLeague: @escaping (String) -> Void
    ) {
        let store = environment.session
        _viewModel = State(initialValue: AccountViewModel(
            api: environment.api, cache: environment.cache, clock: environment.clock, zone: .current,
            push: environment.push, deviceID: { await store.deviceID() },
            signOut: { await session.signOut() }, onSignedOut: expired, deleted: { await session.deleted() },
            leaguesChanged: { Task { await session.restore() } }
        ))
        self.openLeague = openLeague
    }

    var body: some View {
        AccountView(viewModel: viewModel, openLeague: openLeague, openLink: { openURL($0) })
    }
}
