import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI
import UIKit

@main
struct CommishApp: App {
    private let environment: AppEnvironment
    @State private var session: AppSession
    @State private var flow: SignInFlow
    @State private var signIn = SignInModel()

    init() {
        let environment = AppEnvironment.live()
        self.environment = environment
        _session = State(initialValue: AppSession(
            account: environment.api, store: environment.session, cache: environment.cache,
            clock: environment.clock
        ))
        let signIn = SignIn(pairing: environment.pairing, store: environment.session, deviceName: UIDevice.current.name)
        _flow = State(initialValue: SignInFlow(signIn: signIn, base: environment.baseURL))
    }

    var body: some Scene {
        WindowGroup {
            content
                .task { await session.restore() }
                .onOpenURL { link in Task { await finish(link) } }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch session.state {
        case .restoring:
            ProgressView()
        case .signedOut:
            SignInView(working: signIn.working, problem: signIn.problem) {
                signIn.began()
                flow.begin(
                    returned: { link in Task { await finish(link) } },
                    ended: { signIn.ended() }
                )
            }
        case .signedIn:
            RootTabs(
                environment: environment,
                session: session,
                signOut: { Task { await session.signOut() } },
                expired: { Task { await session.expire() } }
            )
        }
    }

    /// The return link, from the sheet or as a universal link: pair, then read the account.
    private func finish(_ link: URL) async {
        do {
            if try await flow.finish(link) {
                signIn.finished(nil)
                await session.restore()
            } else {
                // Not this flow's return (or no flow under way): the verb comes back.
                signIn.ended()
            }
        } catch {
            signIn.finished(error)
        }
    }
}
