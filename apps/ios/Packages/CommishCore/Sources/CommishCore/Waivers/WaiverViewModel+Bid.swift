import CommishAPI
import Foundation

/// The claim's bid (MovePanel.svelte), where the league bids: the field while the claim is confirmed or
/// sent, and whether the verb waits for the bid typed to be planned.
extension WaiverViewModel {
    /// The bid field while the claim is confirmed or sent, where the league bids.
    var bidField: BidField? {
        let showing = switch step {
        case .confirm, .sending: true
        default: false
        }
        guard showing, let bid else {
            return nil
        }
        let sending = if case .sending = step {
            true
        } else {
            false
        }
        return BidField(
            label: WaiverWords.bidLabel(bid), typed: typed,
            problem: WaiverWords.bidProblem(platform, typed: typed, bid: bid), editable: !sending
        )
    }

    /// The verb makes only the claim the sentence names: it waits while the claim is planned again, and
    /// while the bid typed is not the one planned or is one the league does not take.
    var waits: Bool {
        guard let bid else {
            return replanning
        }
        return replanning || WaiverWords.bidProblem(platform, typed: typed, bid: bid) != nil
            || WaiverWords.bidValue(typed.trimmingCharacters(in: .whitespacesAndNewlines)) != bid.amount
    }
}
