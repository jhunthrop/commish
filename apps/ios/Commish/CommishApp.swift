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
    @State private var working = false
    @State private var problem: String?

    init() {
        let environment = AppEnvironment.live()
        self.environment = environment
        _session = State(initialValue: AppSession(
            account: environment.api, store: environment.session, cache: environment.cache
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
            SignInView(working: working, problem: problem) {
                problem = nil
                working = true
                flow.begin { link in Task { await finish(link) } }
            }
        case let .signedIn(leagueID):
            RootTabs(environment: environment, leagueID: leagueID) {
                Task { await session.signOut() }
            }
        }
    }

    /// The return link, from the sheet or as a universal link: pair, then read the account.
    private func finish(_ link: URL) async {
        defer { working = false }
        do {
            if try await flow.finish(link) {
                await session.restore()
            }
        } catch let APIError.envelope(_, message) {
            problem = message
        } catch {
            problem = AppWords.Failure.signInFailed
        }
    }
}
