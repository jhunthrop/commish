import CommishAPI
import CommishDesign
import Foundation
import Observation

/// A followed draft as the start page lists it (model.ts recentLine).
public struct RecentDraft: Equatable, Sendable, Identifiable {
    public let id: String
    public let lead: String
    public let text: String
}

/// The companion's start page (NewCompanion.svelte): paste the Sleeper draft link, say which seat is
/// yours by slot or by your Sleeper username, one verb; the drafts followed before, a tap back to each.
/// The username used last comes first. A development build that opened the page with the replay asks
/// the API's recorded draft, whatever the link says (COMPANION_REPLAY, refused by any other API).
@MainActor
@Observable
public final class NewCompanionViewModel {
    public enum Seat: Equatable, Sendable {
        case slot
        case username
    }

    /// setup.ts MAX_TEAMS: every slot a league can have, one chip each.
    public static let slots = Array(1 ... 14)

    public var link: String
    public var seat: Seat = .slot
    public var slot = 1
    public var username = ""
    public let replay: Bool
    public private(set) var busy = false
    public private(set) var problem: String?
    public private(set) var recent: [RecentDraft] = []
    public private(set) var recentFailed = false

    private let api: any CompanionAPI
    private let onSignedOut: @MainActor () -> Void

    public init(api: any CompanionAPI, replay: Bool = false, onSignedOut: @escaping @MainActor () -> Void = {}) {
        self.api = api
        self.replay = replay
        self.onSignedOut = onSignedOut
        link = replay ? Words.CompanionNew.replay : ""
    }

    /// The verb is ready with a link and, by username, a name.
    public var ready: Bool {
        !link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (seat == .slot || !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) && !busy
    }

    /// The drafts followed before; a failure leaves the form working and says the list is missing.
    public func load() async {
        do {
            let summaries = try await api.recentCompanions()
            recent = summaries.map { summary in
                let line = CompanionWords.recentLine(summary)
                return RecentDraft(id: summary.id, lead: line.lead, text: line.text)
            }
            recentFailed = false
            if let used = summaries.lazy.compactMap(\.hostUsername).first, username.isEmpty {
                seat = .username
                username = used
            }
        } catch where APIError.signsOut(error) {
            onSignedOut()
        } catch {
            recentFailed = true
        }
    }

    /// Follows the draft from the seat chosen: the companion's id to open, nil with the API's sentence
    /// (or the web's own) said under the verb.
    public func follow() async -> String? {
        guard ready else {
            return nil
        }
        busy = true
        problem = nil
        defer { busy = false }
        let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = CompanionCreate(
            host: .init(value1: .sleeper),
            draft: link.trimmingCharacters(in: .whitespacesAndNewlines),
            seat: seat == .slot ? .init(slot: slot) : .init(username: trimmed),
            replay: replay ? true : nil
        )
        do {
            return try await api.followDraft(body).id
        } catch let refused as CompanionRefused {
            problem = refused.sentence
        } catch where APIError.signsOut(error) {
            onSignedOut()
        } catch let APIError.envelope(_, message) where !message.isEmpty {
            problem = message
        } catch {
            problem = Words.CompanionNew.failed
        }
        return nil
    }
}
