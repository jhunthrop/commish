import CommishAPI
import Foundation
import Observation

/// The signed-out screen's state: whether a sign-in is under way (its one verb disabled, said as
/// "Signing in") and the sentence a failed one left. Every way a sheet ends comes back here, so the
/// verb never stays disabled: the return link, a closed or failed sheet, a sheet that did not open.
@MainActor
@Observable
public final class SignInModel {
    public private(set) var working = false
    public private(set) var problem: String?

    public init() {}

    /// The verb was tapped and the sheet is opening.
    public func began() {
        problem = nil
        working = true
    }

    /// The sheet ended with no return link: the member closed it, it failed, or it never opened. The
    /// member is back where they were, with nothing to read.
    public func ended() {
        working = false
    }

    /// The return link was paired, or pairing failed: the API's sentence where it sent one.
    public func finished(_ error: (any Error)?) {
        working = false
        switch error {
        case nil:
            problem = nil
        case let APIError.envelope(_, message)?:
            problem = message
        default:
            problem = AppWords.Failure.signInFailed
        }
    }
}
