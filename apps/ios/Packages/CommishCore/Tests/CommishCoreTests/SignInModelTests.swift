import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// Every way a sign-in ends gives the verb back (review H1).
@MainActor
struct SignInModelTests {
    @Test func aClosedSheetGivesTheVerbBack() {
        let model = SignInModel()
        model.began()
        #expect(model.working)
        model.ended()
        #expect(model.working == false)
        #expect(model.problem == nil)
    }

    @Test func aRefusedPairingSaysTheAPIsWordsAndGivesTheVerbBack() {
        let model = SignInModel()
        model.began()
        model.finished(APIError.envelope(code: "invalid", message: "That code has expired."))
        #expect(model.working == false)
        #expect(model.problem == "That code has expired.")
    }

    @Test func anyOtherFailureSaysTryAgain() {
        let model = SignInModel()
        model.began()
        model.finished(URLError(.timedOut))
        #expect(model.problem == AppWords.Failure.signInFailed)
    }

    @Test func aNewAttemptClearsTheLastProblem() {
        let model = SignInModel()
        model.finished(URLError(.timedOut))
        model.began()
        #expect(model.problem == nil)
        model.finished(nil)
        #expect(model.working == false)
        #expect(model.problem == nil)
    }
}
