import CommishAPI
import CommishCore
import CommishDesign
import Shell
import SwiftUI
import UIKit

@main
struct CommishApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    private let environment: AppEnvironment
    @State private var session: AppSession
    @State private var flow: SignInFlow
    @State private var signIn = SignInModel()
    @State private var linked: ShellRoute?
    /// A tapped push's screen, opened by the shell once signed in.
    @State private var pushed: PushTap?

    init() {
        let environment = AppEnvironment.live()
        self.environment = environment
        _session = State(initialValue: AppSession(
            account: environment.api, store: environment.session, cache: environment.cache,
            clock: environment.clock, signingOut: { await environment.push.signingOut() }
        ))
        let signIn = SignIn(pairing: environment.pairing, store: environment.session, deviceName: UIDevice.current.name)
        _flow = State(initialValue: SignInFlow(signIn: signIn, base: environment.baseURL))
    }

    var body: some Scene {
        WindowGroup {
            content
                .task {
                    delegate.registrar = environment.push
                    delegate.opened = { pushed = $0 }
                    await restore()
                }
                .onOpenURL { link in route(link) }
        }
    }

    @ViewBuilder
    private var content: some View {
        if session.state == .restoring {
            ProgressView()
        } else {
            // Signed out too: the public tabs stay, the League tab is the sign-in (B155). Built anew at
            // each sign-in and sign-out, so no tab's state passes from one account to the next.
            RootTabs(
                environment: environment,
                session: session,
                signIn: SignInView(
                    working: signIn.working, problem: signIn.problem ?? session.notice, signIn: beginSignIn
                ),
                linked: $linked,
                pushed: $pushed,
                expired: { Task { await session.expire() } }
            )
            .id(session.generation)
        }
    }

    private func beginSignIn() {
        signIn.began()
        flow.begin(
            returned: { link in Task { await finish(link) } },
            ended: { signIn.ended() }
        )
    }

    /// A site link the app opened with: the sign-in return to the sign-in flow, a player's page to his
    /// screen once signed in; anything else is the browser's.
    private func route(_ link: URL) {
        switch AppLink.of(link) {
        case .signIn:
            Task { await finish(link) }
        case let .player(slug):
            linked = .player(slug: slug)
        case let .reference(route), let .companion(route), let .mock(route):
            linked = route
        case nil:
            break
        }
    }

    /// Reads the account; signed in, a phone that allows push asks Apple for its token, which registers
    /// on this phone's device (never the permission prompt: only the Account's switch asks).
    private func restore() async {
        await environment.push.launched()
        await session.restore()
        if session.isSignedIn {
            await environment.push.start()
        }
    }

    /// The return link, from the sheet or as a universal link: pair, then read the account.
    private func finish(_ link: URL) async {
        do {
            if try await flow.finish(link) {
                signIn.finished(nil)
                await restore()
            } else {
                // Not this flow's return (or no flow under way): the verb comes back.
                signIn.ended()
            }
        } catch {
            signIn.finished(error)
        }
    }
}
