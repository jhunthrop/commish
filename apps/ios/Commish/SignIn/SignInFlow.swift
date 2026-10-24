import AuthenticationServices
import CommishCore
import UIKit

/// Sign-in in the system browser sheet (ASWebAuthenticationSession): the API's login with the PKCE
/// challenge, AuthKit, then the API's callback sends the sheet to the app link with the pairing code.
/// On iOS 17.4 and later the sheet itself takes the https return (it needs the app associated with
/// trycommish.app for web credentials); before it, the sheet's callback scheme is left empty and the
/// return arrives as a universal link through `onOpenURL`. Either way it ends in `finish`.
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

    /// Opens the sheet; `returned` gets the return link when the sheet itself catches it.
    func begin(returned: @escaping @MainActor @Sendable (URL) -> Void) {
        let started = signIn.start(base: base)
        self.started = started
        // Nonisolated: the system may call it off the main thread; it hops back with the link.
        let completion: ASWebAuthenticationSession.CompletionHandler = { @Sendable url, _ in
            // A cancelled sheet sends no link and nothing is said: the member is back where they were.
            guard let url else {
                return
            }
            Task { @MainActor in returned(url) }
        }
        let session = if #available(iOS 17.4, *) {
            ASWebAuthenticationSession(
                url: started.url,
                callback: .https(host: SignInRoute.returnTo.host() ?? "", path: SignInRoute.returnTo.path()),
                completionHandler: completion
            )
        } else {
            ASWebAuthenticationSession(url: started.url, callbackURLScheme: nil, completionHandler: completion)
        }
        session.presentationContextProvider = self
        session.start()
        sheet = session
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
