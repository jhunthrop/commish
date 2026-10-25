import CommishAPI
import Foundation

/// The claim's bid field (MovePanel.svelte), where the league bids: its label with its basis, the bid as
/// typed, what is wrong with it, and whether it can be changed (not while the claim is on its way).
public struct BidField: Equatable, Sendable {
    public let label: String
    public let typed: String
    public let problem: String?
    public let editable: Bool
}

/// What the pin above the bar shows: the pair an open row's verb makes, the one verb and whether it can
/// be pressed, the line under it; or the claim's confirmation (with its bid) in the verb's place.
public struct WaiverPin: Equatable, Sendable {
    public let pair: String?
    public let verb: String?
    public let enabled: Bool
    public let foot: [[FootRun]]
    public let panel: MovePanel?
    public let bid: BidField?

    public var isEmpty: Bool {
        verb == nil && foot.isEmpty && panel == nil
    }
}
