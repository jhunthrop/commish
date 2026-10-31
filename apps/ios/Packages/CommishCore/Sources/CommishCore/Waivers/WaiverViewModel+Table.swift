import CommishAPI
import CommishDesign
import Foundation

/// The table's controls (WaiverScreen.svelte): the position cards, each a read of its own past the page's
/// first 60 rows; the name search; the sortable heads.
public extension WaiverViewModel {
    /// The table as the sort and the search draw it, empty before an answer.
    var table: WaiverTable {
        model?.table(sort, query: query) ?? WaiverTable(gaining: [], rest: [], stash: [])
    }

    /// A head chosen: the same head turns it around, a new one starts highest first (a name A to Z).
    func sort(by key: WaiverSortKey) {
        sort = sort.next(key)
    }

    /// The search as typed.
    func find(_ query: String) {
        self.query = query
    }

    /// A position chosen (nil: every position, the page's answer): its rows read from the API with the
    /// position as the route's query, the last rows standing quieter meanwhile; only the latest choice's
    /// answer is kept; a failed read says the API's sentence, the last read standing; a refused token
    /// signs out (WaiverScreen.svelte choose, state.ts Narrowing).
    func choose(position next: WaiverPosition?, leagueID: String) async {
        position = next
        narrowed = nil
        problem = nil
        openRow = nil
        reading = next != nil
        latestNarrowing += 1
        let mine = latestNarrowing
        redraw()
        guard let next else {
            return
        }
        do {
            let answer = try await api.waivers(id: leagueID, position: next)
            guard mine == latestNarrowing else {
                return
            }
            narrowed = (answer, now)
            reading = false
            redraw()
        } catch where APIError.signsOut(error) {
            signedOut()
        } catch {
            guard mine == latestNarrowing else {
                return
            }
            reading = false
            if case let APIError.envelope(_, message) = error, !message.isEmpty {
                problem = message
            } else {
                problem = Words.InSeason.narrowingUnread
            }
        }
    }
}
