import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The Account's confirmation sheet (web/src/lib/account/DeleteView.svelte): what goes and what stays,
/// the email typed by hand, and one verb that waits for it to be the account's (delete-api.ts
/// `confirmed`, the API's deletion.Confirmed). The call runs with the device token; a 204 hands the
/// phone to `deleted` (the session forgets it as a sign-out does), a refusal says the API's sentence,
/// a refused token signs out.
@MainActor
@Observable
public final class DeleteAccountViewModel {
    /// The account's email, the one the typed email must be.
    public let email: String
    /// The email typed so far.
    public var typed = ""
    /// The delete is under way.
    public private(set) var busy = false
    /// The API's sentence for a delete that did not go through, else the web's.
    public private(set) var problem: String?

    private let api: any AccountScreenAPI
    private let deleted: @MainActor () async -> Void
    private let onSignedOut: @MainActor () -> Void

    public init(
        email: String, api: any AccountScreenAPI, deleted: @escaping @MainActor () async -> Void,
        onSignedOut: @escaping @MainActor () -> Void
    ) {
        self.email = email
        self.api = api
        self.deleted = deleted
        self.onSignedOut = onSignedOut
    }

    /// "Signed in as <email>", the line above the field.
    public var signedIn: String {
        "\(Words.DeleteAccount.signedInAs) \(email)"
    }

    /// Whether the verb may run: the typed email is the account's and no delete is under way.
    public var canDelete: Bool {
        !busy && Self.confirmed(typed, email: email)
    }

    /// The web's rule: the typed email is the account's, without regard to case or the spaces around it.
    public nonisolated static func confirmed(_ typed: String, email: String) -> Bool {
        let typed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        let email = email.trimmingCharacters(in: .whitespacesAndNewlines)
        return !typed.isEmpty && typed.lowercased() == email.lowercased()
    }

    /// Deletes the account with the typed email, once it matches.
    public func delete() async {
        guard canDelete else {
            return
        }
        busy = true
        problem = nil
        defer { busy = false }
        do {
            try await api.deleteAccount(email: typed)
        } catch where APIError.signsOut(error) {
            problem = AppWords.Failure.signedOut
            onSignedOut()
            return
        } catch let APIError.envelope(_, message) where !message.isEmpty {
            problem = message
            return
        } catch {
            problem = Words.DeleteAccount.failed
            return
        }
        await deleted()
    }
}
