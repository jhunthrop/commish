import CommishAPI
import CommishDesign
import Foundation

/// The mock room's cache key, share links and sentences.
public extension MockRoomViewModel {
    /// The link the bar's Save and share and the report's Copy a share link copy.
    var shareURL: URL? {
        switch state {
        case let .report(_, code?, _, _): Self.shareLink(code)
        case .room: saved.map { Self.shareLink($0.room.shareCode) }
        default: nil
        }
    }

    /// The cache key of a mock.
    static func route(_ id: String) -> String {
        "/mocks/\(id)"
    }

    /// The share link of a draft by its code (actions.ts copyShareLink).
    nonisolated static func shareLink(_ code: String) -> URL {
        SiteLinks.origin.appendingPathComponent("mock/share").appendingPathComponent(code)
    }

    /// The API's own sentence where it sent one, else the app's for no connection or anything else.
    internal static func sentence(for error: any Error) -> String {
        switch error {
        case let APIError.envelope(_, message) where !message.isEmpty: message
        default: Words.Mock.unreachablePhone
        }
    }
}

/// The web's write chain (`writes` in routes/mock/[id]/+page.svelte): every write runs after the one
/// before it, so a tap while another write is on its way acts when that write lands instead of racing
/// it. `generation` counts the writes chained, so a read begun before one can tell it was overtaken.
@MainActor
final class WriteChain {
    private(set) var generation = 0
    private var last: Task<Void, Never>?

    /// Runs `job` after every job chained before it, and returns when it has run.
    func run(_ job: @escaping @MainActor () async -> Void) async {
        generation += 1
        let previous = last
        let next = Task { @MainActor in
            await previous?.value
            await job()
        }
        last = next
        await next.value
    }
}
