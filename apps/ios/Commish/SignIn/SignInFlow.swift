import AuthenticationServices
import CommishCore
import UIKit

/// Sign-in in the system browser sheet (ASWebAuthenticationSession): the API's login with the PKCE
/// challenge, AuthKit, then the API's callback sends the sheet to the app link with the pairing code,
/// which the sheet catches as its https return (iOS 17.4, the app holding web credentials for
/// trycommish.app). A universal link to the same address arriving through `onOpenURL` ends it the
/// same way. Every end calls back: the return link, or `ended` when the sheet closes, fails or never
/// opens, so the screen's verb is never left disabled.
@MainActor
final class SignInFlow: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let signIn: SignIn
    private let base: URL
    private var started: SignIn.Started?
    private var sheet: ASWebAuthenticationSession?

    init(signIn: SignIn, base: URL) {
        self.signIn = signIn
        self.base = base
    }

    func begin(
        returned: @escaping @MainActor @Sendable (URL) -> Void,
        ended: @escaping @MainActor @Sendable () -> Void
    ) {
        let started = signIn.start(base: base)
        self.started = started
        // Nonisolated: the system may call it off the main thread; it hops back.
        let completion: ASWebAuthenticationSession.CompletionHandler = { @Sendable url, _ in
            Task { @MainActor in
                if let url {
                    returned(url)
                } else {
                    ended()
                }
            }
        }
        let session = ASWebAuthenticationSession(
            url: started.url,
            callback: .https(host: SignInRoute.returnTo.host() ?? "", path: SignInRoute.returnTo.path()),
            completionHandler: completion
        )
        session.presentationContextProvider = self
        sheet = session
        if !session.start() {
            self.started = nil
            sheet = nil
            ended()
        }
    }

    /// Whether the link is this flow's return; when it is, pairs with the verifier held since `begin`.
    func finish(_ link: URL) async throws -> Bool {
        guard let started, SignInRoute.code(from: link) != nil else {
            return false
        }
        sheet?.cancel()
        sheet = nil
        self.started = nil
        try await signIn.finish(started, link: link)
        return true
    }

    nonisolated func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.compactMap(\.keyWindow).first ?? ASPresentationAnchor()
        }
    }
}
